<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\HttpResponse;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class BucketsServiceTest extends TestCase
{
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
    private function bucketFixture(): array
    {
        return [
            'id' => 'bucket-1',
            'name' => 'assets',
            'provider' => 'AWS',
            'region' => 'eu-north-1',
            'endpoint' => null,
            'publicAccess' => false,
            'versioning' => false,
            'status' => 'ACTIVE',
            'tier' => 'STARTER',
            'cdnEnabled' => false,
            'cdnDomain' => null,
            'createdAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    public function testThrowsWhenNoProjectIdIsAvailable(): void
    {
        $scopeless = new Cosmoner('key-123', null, 'https://api.test.dev', 30.0, 0, $this->http);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('projectId is required');

        $scopeless->buckets->list();
    }

    public function testListsBuckets(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->bucketFixture()]]);

        $result = $this->client->buckets->list();

        $this->assertSame(['success' => true, 'data' => [$this->bucketFixture()]], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-1/storage/object-storage',
            $this->http->requests[0]['url'],
        );
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->client->buckets->list('proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/storage/object-storage',
            $this->http->requests[0]['url'],
        );
    }

    public function testThrowsWhenBucketIdIsEmptyOnDelete(): void
    {
        try {
            $this->client->buckets->delete('');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('bucketId is required', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testDeletesABucket(): void
    {
        $this->http->queue(new HttpResponse(200, '{"success":true,"data":{}}'));

        $result = $this->client->buckets->delete('bucket-1');

        $this->assertSame(['success' => true, 'data' => []], $result);
        $this->assertSame('DELETE', $this->http->requests[0]['method']);
        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-1/storage/object-storage/bucket-1',
            $this->http->requests[0]['url'],
        );
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testDeletesABucketInAnotherProject(): void
    {
        $this->http->queue(new HttpResponse(200, '{"success":true,"data":{}}'));

        $this->client->buckets->delete('bucket-1', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/storage/object-storage/bucket-1',
            $this->http->requests[0]['url'],
        );
    }
}
