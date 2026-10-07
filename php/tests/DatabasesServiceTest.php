<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\NotFoundError;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class DatabasesServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects/proj-1/databases';

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
    private function summaryFixture(): array
    {
        return [
            'kind' => 'DEDICATED',
            'id' => 'db-1',
            'name' => 'main',
            'engine' => 'POSTGRES',
            'version' => '16',
            'region' => 'eu-north-1',
            'status' => 'ACTIVE',
            'plan' => 'db-s-1vcpu-1gb',
            'createdAt' => '2026-09-01T12:00:00.000Z',
            'dedicated' => ['numNodes' => 1, 'storageGb' => 10],
        ];
    }

    /** @return array<string, mixed> */
    private function dedicatedFixture(): array
    {
        return [
            'id' => 'db-1',
            'name' => 'main',
            'engine' => 'POSTGRES',
            'version' => '16',
            'provider' => 'COSMONER',
            'region' => 'eu-north-1',
            'size' => 'db-s-1vcpu-1gb',
            'numNodes' => 1,
            'storageGb' => 10,
            'status' => 'ACTIVE',
            'host' => 'main.db.cosmoner.net',
            'port' => 5432,
            'defaultDb' => 'app',
            'defaultUser' => 'app',
            'createdAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    /** @return array<string, mixed> */
    private function sharedFixture(): array
    {
        return [
            'id' => 'tenant-1',
            'clusterId' => 'cluster-1',
            'clusterName' => 'shared-eu-1',
            'dbName' => 'acme_app',
            'dbUser' => 'acme_app',
            'host' => 'shared-eu-1.db.cosmoner.net',
            'port' => 5432,
            'region' => 'eu-north-1',
            'poolName' => 'acme_app',
            'poolPort' => 6432,
            'poolMode' => 'TRANSACTION',
            'status' => 'ACTIVE',
            'tier' => 'STARTER',
            'maxConnections' => 3,
            'storageLimitMb' => 512,
            'createdAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    public function testThrowsWhenDatabaseIdIsEmptyOnGetDedicated(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('databaseId is required');

        $this->client->databases->getDedicated('');
    }

    public function testThrowsWhenTenantIdIsEmptyOnGetShared(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('tenantId is required');

        $this->client->databases->getShared('');
    }

    public function testRejectsInvalidInputWithoutSendingARequest(): void
    {
        $calls = [
            fn () => $this->client->databases->getDedicated(''),
            fn () => $this->client->databases->getShared(''),
        ];

        foreach ($calls as $call) {
            try {
                $call();
                $this->fail('Expected an InvalidArgumentException');
            } catch (InvalidArgumentException) {
                // Expected.
            }
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testThrowsWhenNoProjectIdIsAvailable(): void
    {
        $scopeless = new Cosmoner('key-123', null, 'https://api.test.dev', 30.0, 0, $this->http);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('projectId is required');

        $scopeless->databases->list();
    }

    public function testListsEveryKindOfDatabase(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->summaryFixture()]]);

        $result = $this->client->databases->list();

        $this->assertSame(['success' => true, 'data' => [$this->summaryFixture()]], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testListsDedicatedDatabases(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->dedicatedFixture()]]);

        $result = $this->client->databases->listDedicated();

        $this->assertSame([$this->dedicatedFixture()], $result['data']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/dedicated', $this->http->requests[0]['url']);
    }

    public function testFetchesADedicatedDatabaseWithItsConnectionUri(): void
    {
        $uri = 'postgresql://app:s3cret@main.db.cosmoner.net:5432/app';
        $this->http->queueJson(200, [
            'success' => true,
            'data' => [...$this->dedicatedFixture(), 'connectionUri' => $uri],
        ]);

        $result = $this->client->databases->getDedicated('db-1');

        $this->assertSame($uri, $result['data']['connectionUri']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/dedicated/db-1', $this->http->requests[0]['url']);
    }

    public function testListsSharedDatabases(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->sharedFixture()]]);

        $result = $this->client->databases->listShared();

        $this->assertSame([$this->sharedFixture()], $result['data']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/shared', $this->http->requests[0]['url']);
    }

    public function testFetchesASharedDatabase(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->sharedFixture()]);

        $result = $this->client->databases->getShared('tenant-1');

        $this->assertSame($this->sharedFixture(), $result['data']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/shared/tenant-1', $this->http->requests[0]['url']);
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->client->databases->listDedicated('proj-2');
        $this->client->databases->getShared('tenant-1', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/databases/dedicated',
            $this->http->requests[0]['url'],
        );
        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/databases/shared/tenant-1',
            $this->http->requests[1]['url'],
        );
    }

    public function testMapsA404OntoNotFoundError(): void
    {
        $this->http->queueJson(404, [
            'success' => false,
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Database not found'],
        ]);

        $this->expectException(NotFoundError::class);

        $this->client->databases->getDedicated('db-missing');
    }
}
