<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\ConflictError;
use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\HttpResponse;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class SecretsServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects/proj-1/secrets';

    private Cosmoner $client;
    private FakeHttpClient $http;

    protected function setUp(): void
    {
        $this->http = new FakeHttpClient();
        $this->client = new Cosmoner(
            'key-123',
            'proj-1',
            'https://api.test.dev',
            30.0,
            0,
            $this->http,
        );
    }

    /** @return array<string, mixed> */
    private function actorFixture(): array
    {
        return ['id' => 'user-1', 'name' => 'Ada', 'email' => 'ada@example.com'];
    }

    /** @return array<string, mixed> */
    private function secretFixture(): array
    {
        return [
            'id' => 'sec-1',
            'name' => 'DB_PASSWORD',
            'description' => 'Primary database',
            'environment' => 'production',
            'version' => 1,
            'createdBy' => 'user-1',
            'updatedBy' => 'user-1',
            'createdByUser' => $this->actorFixture(),
            'updatedByUser' => $this->actorFixture(),
            'createdAt' => '2026-09-01T12:00:00.000Z',
            'updatedAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    /** @return array<string, mixed> */
    private function decodedBody(int $index = 0): array
    {
        /** @var array<string, mixed> */
        return (array) json_decode((string) $this->http->requests[$index]['body'], true);
    }

    public function testThrowsWhenSecretIdIsEmptyOnGet(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('secretId is required');
        $this->client->secrets->get('');
    }

    public function testThrowsWhenSecretIdIsEmptyOnDelete(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('secretId is required');
        $this->client->secrets->delete('');
    }

    public function testRejectsALowercaseNameWithoutSendingARequest(): void
    {
        try {
            $this->client->secrets->create('db_password', 'hunter2');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertStringContainsString('uppercase letters', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testRejectsAnEmptyValueWithoutSendingARequest(): void
    {
        try {
            $this->client->secrets->create('DB_PASSWORD', '');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('value is required', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testRejectsAValuePastTheApiLimit(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('value must be at most 10000 characters');
        $this->client->secrets->create('DB_PASSWORD', str_repeat('x', 10001));
    }

    public function testListsSecretsWithoutAQueryStringByDefault(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->secretFixture()]]);

        $result = $this->client->secrets->list();

        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertArrayNotHasKey('value', $result['data'][0]);
    }

    public function testScopesAListToOneEnvironment(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->client->secrets->list('staging');

        $this->assertSame(self::BASE . '?environment=staging', $this->http->requests[0]['url']);
    }

    public function testCreatesASecretAndHandsBackThePlaintextOnce(): void
    {
        $revealed = $this->secretFixture() + ['value' => 'hunter2', 'maskedValue' => 'hu••••r2'];
        $this->http->queueJson(201, ['success' => true, 'data' => $revealed]);

        $result = $this->client->secrets->create('DB_PASSWORD', 'hunter2', null, 'production');

        $this->assertSame('hunter2', $result['data']['value']);
        $this->assertSame('POST', $this->http->requests[0]['method']);
        $this->assertSame(
            ['name' => 'DB_PASSWORD', 'value' => 'hunter2', 'environment' => 'production'],
            $this->decodedBody(),
        );
    }

    public function testUpdatesASecretById(): void
    {
        $revealed = $this->secretFixture() + ['value' => 'hunter3', 'maskedValue' => 'hu••••r3'];
        $this->http->queueJson(200, ['success' => true, 'data' => $revealed]);

        $this->client->secrets->update('sec-1', 'hunter3');

        $this->assertSame('PATCH', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/sec-1', $this->http->requests[0]['url']);
        $this->assertSame(['value' => 'hunter3'], $this->decodedBody());
    }

    public function testDeletesASecretToleratingTheEmpty204(): void
    {
        $this->http->queue(new HttpResponse(204, ''));

        $this->client->secrets->delete('sec-1');

        $this->assertSame('DELETE', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/sec-1', $this->http->requests[0]['url']);
    }

    public function testReadsUsage(): void
    {
        $this->http->queueJson(200, [
            'success' => true,
            'data' => [
                'used' => 5,
                'limit' => 5,
                'freeLimit' => 5,
                'packSize' => 5,
                'paidPacks' => 0,
                'packPrice' => ['monthly' => 500, 'currency' => 'EUR'],
            ],
        ]);

        $result = $this->client->secrets->usage();

        $this->assertSame(5, $result['data']['used']);
        $this->assertSame(self::BASE . '/usage', $this->http->requests[0]['url']);
    }

    public function testReadsAnAuditTrail(): void
    {
        $this->http->queueJson(200, [
            'success' => true,
            'data' => [[
                'id' => 'log-1',
                'secretId' => 'sec-1',
                'action' => 'CREATED',
                'actorId' => 'user-1',
                'actor' => $this->actorFixture(),
                'metadata' => null,
                'createdAt' => '2026-09-01T12:00:00.000Z',
            ]],
        ]);

        $result = $this->client->secrets->audit('sec-1');

        $this->assertSame('CREATED', $result['data'][0]['action']);
        $this->assertSame(self::BASE . '/sec-1/audit', $this->http->requests[0]['url']);
    }

    public function testSurfacesADuplicateNameAsAConflictError(): void
    {
        $this->http->queueJson(409, [
            'success' => false,
            'error' => ['code' => 'CONFLICT', 'message' => 'Secret already exists'],
        ]);

        $this->expectException(ConflictError::class);
        $this->client->secrets->create('DB_PASSWORD', 'hunter2');
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->client->secrets->list(null, 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/secrets',
            $this->http->requests[0]['url'],
        );
    }
}
