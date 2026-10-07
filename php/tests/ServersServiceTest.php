<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\HttpResponse;
use Cosmoner\Sdk\NotFoundError;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class ServersServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects/proj-1/servers';

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
    private function serverFixture(): array
    {
        return [
            'id' => 'srv-1',
            'name' => 'web-1',
            'type' => 'LAMP',
            'provider' => 'DIGITAL_OCEAN',
            'region' => 'fra1',
            'instanceType' => 's-1vcpu-1gb',
            'image' => null,
            'status' => 'RUNNING',
            'ipAddress' => '203.0.113.10',
            'hostname' => 'web-1.cosmoner.net',
            'phpVersion' => '8.3',
            'pgVersion' => null,
            'pgDatabase' => null,
            'pgUsername' => null,
            'sshUser' => 'cosmoner',
            'createdAt' => '2026-09-01T12:00:00.000Z',
            'updatedAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    public function testThrowsWhenServerIdIsEmptyOnGet(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('serverId is required');

        $this->client->servers->get('');
    }

    public function testRejectsInvalidInputWithoutSendingARequest(): void
    {
        try {
            $this->client->servers->get('');
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

        $scopeless->servers->list();
    }

    public function testListsServers(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->serverFixture()]]);

        $result = $this->client->servers->list();

        $this->assertSame(['success' => true, 'data' => [$this->serverFixture()]], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testFetchesAServerWithItsSshKeys(): void
    {
        $sshKeys = [['id' => 'key-1', 'name' => 'laptop', 'fingerprint' => 'SHA256:abc']];
        $this->http->queueJson(200, ['success' => true, 'data' => [...$this->serverFixture(), 'sshKeys' => $sshKeys]]);

        $result = $this->client->servers->get('srv-1');

        $this->assertSame($sshKeys, $result['data']['sshKeys']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/srv-1', $this->http->requests[0]['url']);
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->serverFixture()]);

        $this->client->servers->get('srv-1', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/servers/srv-1',
            $this->http->requests[0]['url'],
        );
    }

    public function testMapsA404OntoNotFoundError(): void
    {
        $this->http->queueJson(404, [
            'success' => false,
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Server not found'],
        ]);

        $this->expectException(NotFoundError::class);

        $this->client->servers->get('srv-missing');
    }

    public function testThrowsWhenServerIdIsEmptyOnDelete(): void
    {
        try {
            $this->client->servers->delete('');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('serverId is required', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testDeletesAServer(): void
    {
        $this->http->queue(new HttpResponse(200, '{"success":true,"data":{}}'));

        $result = $this->client->servers->delete('srv-1');

        $this->assertSame(['success' => true, 'data' => []], $result);
        $this->assertSame('DELETE', $this->http->requests[0]['method']);
        $this->assertSame('https://api.test.dev/v1/projects/proj-1/servers/srv-1', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testDeletesAServerInAnotherProject(): void
    {
        $this->http->queue(new HttpResponse(200, '{"success":true,"data":{}}'));

        $this->client->servers->delete('srv-1', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/servers/srv-1',
            $this->http->requests[0]['url'],
        );
    }
}
