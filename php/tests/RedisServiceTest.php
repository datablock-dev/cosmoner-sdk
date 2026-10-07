<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\HttpResponse;
use Cosmoner\Sdk\NotFoundError;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class RedisServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects/proj-1/redis';

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
    private function redisFixture(): array
    {
        return [
            'id' => 'redis-1',
            'name' => 'cache',
            'provider' => 'COSMONER',
            'engine' => 'REDIS',
            'engineVersion' => '7.4',
            'planSlug' => 'redis-256',
            'planType' => 'RAM',
            'memoryMb' => 256,
            'throughputOps' => null,
            'cloudProvider' => 'AWS',
            'region' => 'eu-north-1',
            'replication' => false,
            'dataPersistence' => 'NONE',
            'status' => 'ACTIVE',
            'host' => 'cache.redis.cosmoner.net',
            'port' => 6379,
            'createdAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    public function testThrowsWhenRedisIdIsEmptyOnGet(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('redisId is required');

        $this->client->redis->get('');
    }

    public function testRejectsInvalidInputWithoutSendingARequest(): void
    {
        try {
            $this->client->redis->get('');
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

        $scopeless->redis->list();
    }

    public function testListsRedisDatabases(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->redisFixture()]]);

        $result = $this->client->redis->list();

        $this->assertSame(['success' => true, 'data' => [$this->redisFixture()]], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testFetchesARedisDatabaseWithItsPassword(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [...$this->redisFixture(), 'password' => 's3cret']]);

        $result = $this->client->redis->get('redis-1');

        $this->assertSame('s3cret', $result['data']['password']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/redis-1', $this->http->requests[0]['url']);
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->client->redis->list('proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/redis', $this->http->requests[0]['url']);
    }

    public function testMapsA404OntoNotFoundError(): void
    {
        $this->http->queueJson(404, [
            'success' => false,
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Redis database not found'],
        ]);

        $this->expectException(NotFoundError::class);

        $this->client->redis->get('redis-missing');
    }

    public function testThrowsWhenRedisIdIsEmptyOnDelete(): void
    {
        try {
            $this->client->redis->delete('');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('redisId is required', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testDeletesARedisDatabase(): void
    {
        $this->http->queue(new HttpResponse(200, '{"success":true,"data":{}}'));

        $result = $this->client->redis->delete('redis-1');

        $this->assertSame(['success' => true, 'data' => []], $result);
        $this->assertSame('DELETE', $this->http->requests[0]['method']);
        $this->assertSame('https://api.test.dev/v1/projects/proj-1/redis/redis-1', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testDeletesARedisDatabaseInAnotherProject(): void
    {
        $this->http->queue(new HttpResponse(200, '{"success":true,"data":{}}'));

        $this->client->redis->delete('redis-1', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/redis/redis-1',
            $this->http->requests[0]['url'],
        );
    }

    /** @return array<string, mixed> */
    private function previewFixture(): array
    {
        return [
            'subtotal' => 1500,
            'tax' => 375,
            'creditApplied' => 0,
            'dueToday' => 1875,
            'monthly' => 1500,
            'currency' => 'USD',
            'nextBillingDate' => '2026-11-01T00:00:00.000Z',
        ];
    }

    public function testPreviewsAPlan(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->previewFixture()]);

        $result = $this->client->redis->preview('upstash-pay-as-you-go');

        $this->assertSame(['success' => true, 'data' => $this->previewFixture()], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/preview?planSlug=upstash-pay-as-you-go', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testPreviewsAPlanInAnotherProject(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->previewFixture()]);

        $this->client->redis->preview('fixed-250mb', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/redis/preview?planSlug=fixed-250mb',
            $this->http->requests[0]['url'],
        );
    }

    public function testRejectsAPreviewWithoutAPlanWithoutSendingARequest(): void
    {
        try {
            $this->client->redis->preview('');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('plan is required', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testCreatesARedisDatabaseWithOnlyTheRequiredFields(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['deployed' => true]]);

        $result = $this->client->redis->create(['name' => 'cache', 'plan' => 'fixed-250mb', 'region' => 'eu-west-1']);

        $this->assertSame(['success' => true, 'data' => ['deployed' => true]], $result);
        $this->assertSame('POST', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertSame(
            '{"name":"cache","planSlug":"fixed-250mb","region":"eu-west-1"}',
            $this->http->requests[0]['body'],
        );
    }

    public function testSendsPersistenceAsDataPersistence(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['deployed' => true]]);

        $this->client->redis->create([
            'name' => 'cache',
            'plan' => 'fixed-250mb',
            'region' => 'eu-west-1',
            'persistence' => 'AOF_EVERY_1_SECOND',
        ]);

        $this->assertSame(
            '{"name":"cache","planSlug":"fixed-250mb","region":"eu-west-1","dataPersistence":"AOF_EVERY_1_SECOND"}',
            $this->http->requests[0]['body'],
        );
    }

    public function testCreatesARedisDatabaseInAnotherProject(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['deployed' => true]]);

        $this->client->redis->create(
            ['name' => 'cache', 'plan' => 'fixed-250mb', 'region' => 'eu-west-1', 'persistence' => null],
            'proj-2',
        );

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/redis', $this->http->requests[0]['url']);
        $this->assertSame(
            '{"name":"cache","planSlug":"fixed-250mb","region":"eu-west-1"}',
            $this->http->requests[0]['body'],
        );
    }

    public function testRejectsACreateMissingARequiredFieldWithoutSendingARequest(): void
    {
        $valid = ['name' => 'cache', 'plan' => 'fixed-250mb', 'region' => 'eu-west-1'];

        foreach (['name', 'plan', 'region'] as $field) {
            try {
                $this->client->redis->create([...$valid, $field => '']);
                $this->fail("Expected an InvalidArgumentException for an empty {$field}");
            } catch (InvalidArgumentException $err) {
                $this->assertSame("{$field} is required", $err->getMessage());
            }
        }

        $this->assertSame(0, $this->http->callCount());
    }
}
