<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\AuthenticationError;
use Cosmoner\Sdk\ConflictError;
use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\CosmonerConnectionError;
use Cosmoner\Sdk\CosmonerError;
use Cosmoner\Sdk\CosmonerTimeoutError;
use Cosmoner\Sdk\InsufficientScopeError;
use Cosmoner\Sdk\NotFoundError;
use Cosmoner\Sdk\RateLimitError;
use Cosmoner\Sdk\ServerError;
use Cosmoner\Sdk\ValidationError;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class TransportTest extends TestCase
{
    private FakeHttpClient $http;

    protected function setUp(): void
    {
        $this->http = new FakeHttpClient();
    }

    /** Build a client backed by the fake HTTP client. */
    private function client(int $maxRetries = 0): Cosmoner
    {
        return new Cosmoner(
            'key-123',
            'proj-1',
            'https://api.test.dev',
            30.0,
            $maxRetries,
            $this->http,
        );
    }

    /**
     * Issue a representative POST through the transport.
     *
     * @return array<string, mixed>
     */
    private function send(Cosmoner $client): array
    {
        return $client->email->send('cred-1', 'user@test.com', 'Test', null, 'body');
    }

    public function testSendsAuthAndSdkHeaders(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->send($this->client());

        $headers = $this->http->requests[0]['headers'];
        $this->assertSame('Bearer key-123', $headers['Authorization']);
        $this->assertSame('application/json', $headers['Content-Type']);
        $this->assertStringStartsWith('cosmoner-php/', $headers['User-Agent']);
        $this->assertNotEmpty($headers['Idempotency-Key']);
    }

    public function testBuildsProjectScopedUrl(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->send($this->client());

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-1/email/send',
            $this->http->requests[0]['url'],
        );
    }

    public function testPerCallProjectIdOverridesDefault(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->client()->email->send(
            'cred-1',
            'user@test.com',
            'Test',
            null,
            'body',
            null,
            'proj-2',
        );

        $this->assertStringContainsString('proj-2', $this->http->requests[0]['url']);
    }

    public function testThrowsWhenNoProjectIdIsAvailable(): void
    {
        $client = new Cosmoner('key-123', null, 'https://api.test.dev', 30.0, 0, $this->http);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('projectId is required');

        $client->email->send('cred-1', 'user@test.com', 'Test', null, 'body');
    }

    public function testRetries429ThenSucceeds(): void
    {
        $this->http->queueJson(429)->queueJson(200, ['success' => true, 'data' => []]);

        $result = $this->send($this->client(maxRetries: 1));

        $this->assertTrue($result['success']);
        $this->assertSame(2, $this->http->callCount());
    }

    public function testGivesUpAfterMaxRetries(): void
    {
        $this->http->queueJson(429);

        $this->expectException(RateLimitError::class);

        try {
            $this->send($this->client(maxRetries: 1));
        } finally {
            $this->assertSame(2, $this->http->callCount());
        }
    }

    public function testDoesNotRetryAFailedWrite(): void
    {
        $this->http->queueJson(500);

        try {
            $this->send($this->client(maxRetries: 2));
            $this->fail('Should have thrown');
        } catch (ServerError) {
            $this->assertSame(1, $this->http->callCount());
        }
    }

    public function testReusesOneIdempotencyKeyAcrossRetries(): void
    {
        $this->http->queueJson(429)->queueJson(200, ['success' => true, 'data' => []]);

        $this->send($this->client(maxRetries: 1));

        $keys = array_column(array_column($this->http->requests, 'headers'), 'Idempotency-Key');
        $this->assertCount(1, array_unique($keys));
    }

    public function testPropagatesTransportFailures(): void
    {
        $this->http->queue(new CosmonerTimeoutError('timed out'));

        $this->expectException(CosmonerTimeoutError::class);

        $this->send($this->client());
    }

    public function testPropagatesConnectionFailures(): void
    {
        $this->http->queue(new CosmonerConnectionError('refused'));

        $this->expectException(CosmonerConnectionError::class);

        $this->send($this->client());
    }

    public function testThrowsOnNonJsonSuccessResponse(): void
    {
        $this->http->queue(new \Cosmoner\Sdk\HttpResponse(200, '<html>oops</html>'));

        $this->expectException(CosmonerError::class);
        $this->expectExceptionMessage('non-JSON');

        $this->send($this->client());
    }

    public function testHandlesErrorResponseWithMissingFields(): void
    {
        $this->http->queueJson(500, []);

        try {
            $this->send($this->client());
            $this->fail('Should have thrown');
        } catch (CosmonerError $err) {
            $this->assertSame(500, $err->status);
            $this->assertSame('UNKNOWN', $err->errorCode);
            $this->assertSame('Unknown error', $err->getMessage());
        }
    }

    public function testSurfacesValidationDetails(): void
    {
        $this->http->queueJson(422, [
            'success' => false,
            'error' => [
                'code' => 'VALIDATION_ERROR',
                'message' => 'Invalid input',
                'details' => ['to' => 'must be an email'],
            ],
        ]);

        try {
            $this->send($this->client());
            $this->fail('Should have thrown');
        } catch (CosmonerError $err) {
            $this->assertSame(['to' => 'must be an email'], $err->details);
        }
    }

    /** @param class-string<\Throwable> $expected */
    #[DataProvider('statusProvider')]
    public function testMapsStatusToErrorClass(int $status, string $expected): void
    {
        $this->http->queueJson($status);

        $this->expectException($expected);

        $this->send($this->client());
    }

    /** @return list<array{int, class-string<\Throwable>}> */
    public static function statusProvider(): array
    {
        return [
            [400, ValidationError::class],
            [401, AuthenticationError::class],
            [403, InsufficientScopeError::class],
            [404, NotFoundError::class],
            [409, ConflictError::class],
            [422, ValidationError::class],
            [429, RateLimitError::class],
            [500, ServerError::class],
            [503, ServerError::class],
        ];
    }
}
