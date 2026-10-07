<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\HttpResponse;
use Cosmoner\Sdk\NotFoundError;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class IamServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects/proj-1/iam';

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
    private function credentialFixture(): array
    {
        return [
            'iamUserName' => 'cosmoner-org1-ci',
            'label' => 'ci',
            'accessKeyId' => 'AKIAEXAMPLE',
            'createdAt' => '2026-09-01T12:00:00.000Z',
            'origin' => 'project',
            'registry' => null,
            'storage' => null,
        ];
    }

    public function testThrowsWhenIamUserNameIsEmptyOnGet(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('iamUserName is required');

        $this->client->iam->get('');
    }

    public function testRejectsInvalidInputWithoutSendingARequest(): void
    {
        try {
            $this->client->iam->get('');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException) {
            $this->assertSame(0, $this->http->callCount());
        }
    }

    public function testThrowsWhenNoProjectIdIsAvailable(): void
    {
        $scopeless = new Cosmoner('key-123', null, 'https://api.test.dev', 30.0, 0, $this->http);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('projectId is required');

        $scopeless->iam->list();
    }

    public function testListsCredentialsWithLoadErrors(): void
    {
        $data = [
            'credentials' => [$this->credentialFixture()],
            'errors' => ['Registry credentials could not be loaded'],
        ];
        $this->http->queueJson(200, ['success' => true, 'data' => $data]);

        $result = $this->client->iam->list();

        $this->assertSame(['success' => true, 'data' => $data], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testFetchesACredential(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->credentialFixture()]);

        $result = $this->client->iam->get('cosmoner-org1-ci');

        $this->assertSame($this->credentialFixture(), $result['data']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/cosmoner-org1-ci', $this->http->requests[0]['url']);
    }

    public function testUrlEncodesTheIamUserName(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->credentialFixture()]);

        $this->client->iam->get('ci/deploy');

        $this->assertSame(self::BASE . '/ci%2Fdeploy', $this->http->requests[0]['url']);
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => ['credentials' => [], 'errors' => []]]);

        $this->client->iam->list('proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/iam', $this->http->requests[0]['url']);
    }

    public function testMapsA404OntoNotFoundError(): void
    {
        $this->http->queueJson(404, [
            'success' => false,
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Credentials not found'],
        ]);

        $this->expectException(NotFoundError::class);

        $this->client->iam->get('missing');
    }

    public function testThrowsWhenIamUserNameIsEmptyOnDelete(): void
    {
        try {
            $this->client->iam->delete('');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('iamUserName is required', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testDeletesACredentialToleratingTheEmpty204(): void
    {
        $this->http->queue(new HttpResponse(204, ''));

        $this->client->iam->delete('cosmoner-org1-ci');

        $this->assertSame('DELETE', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/cosmoner-org1-ci', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testUrlEncodesTheIamUserNameOnDelete(): void
    {
        $this->http->queue(new HttpResponse(204, ''));

        $this->client->iam->delete('ci/deploy', 'proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/iam/ci%2Fdeploy', $this->http->requests[0]['url']);
    }
}
