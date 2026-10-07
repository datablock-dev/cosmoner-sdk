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

    /** @return array<string, mixed> */
    private function previewFixture(): array
    {
        return [
            'subtotal' => 600,
            'tax' => null,
            'creditApplied' => 0,
            'dueToday' => 600,
            'monthly' => 600,
            'currency' => 'USD',
            'nextBillingDate' => '2026-11-01T00:00:00.000Z',
        ];
    }

    public function testPreviewsASizeOnTheDefaultProvider(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->previewFixture()]);

        $result = $this->client->servers->preview(['size' => 's-1vcpu-1gb']);

        $this->assertSame(['success' => true, 'data' => $this->previewFixture()], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(
            self::BASE . '/preview?provider=digitalocean&slug=s-1vcpu-1gb',
            $this->http->requests[0]['url'],
        );
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testPreviewsOnAnotherProviderInAnotherProject(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->previewFixture()]);

        $this->client->servers->preview(['size' => 'cx22', 'provider' => 'hetzner'], 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/servers/preview?provider=hetzner&slug=cx22',
            $this->http->requests[0]['url'],
        );
    }

    public function testRejectsAPreviewWithoutASizeWithoutSendingARequest(): void
    {
        try {
            $this->client->servers->preview(['size' => '']);
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('size is required', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testCreatesAServerWithOnlyTheRequiredFields(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['deployed' => true]]);

        $result = $this->client->servers->create(['name' => 'web-1', 'size' => 's-1vcpu-1gb', 'region' => 'fra1']);

        $this->assertSame(['success' => true, 'data' => ['deployed' => true]], $result);
        $this->assertSame('POST', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertSame(
            '{"name":"web-1","slug":"s-1vcpu-1gb","provider":"digitalocean","region":"fra1"}',
            $this->http->requests[0]['body'],
        );
    }

    public function testCreatesAServerWithEveryOption(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['deployed' => true]]);

        $this->client->servers->create([
            'name' => 'web-1',
            'size' => 's-1vcpu-1gb',
            'region' => 'fra1',
            'image' => 'wordpress-20-04',
            'sshKeyIds' => ['key-1', 'key-2'],
            'provider' => 'hetzner',
        ]);

        $this->assertSame(
            '{"name":"web-1","slug":"s-1vcpu-1gb","provider":"hetzner","region":"fra1",'
            . '"template":"wordpress-20-04","sshKeyIds":["key-1","key-2"]}',
            $this->http->requests[0]['body'],
        );
    }

    public function testLeavesOutOptionsSetToNull(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['deployed' => true]]);

        $this->client->servers->create([
            'name' => 'web-1',
            'size' => 's-1vcpu-1gb',
            'region' => 'fra1',
            'image' => null,
            'sshKeyIds' => null,
            'provider' => null,
        ]);

        $this->assertSame(
            '{"name":"web-1","slug":"s-1vcpu-1gb","provider":"digitalocean","region":"fra1"}',
            $this->http->requests[0]['body'],
        );
    }

    public function testCreatesAServerInAnotherProject(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['deployed' => true]]);

        $this->client->servers->create(['name' => 'web-1', 'size' => 's-1vcpu-1gb', 'region' => 'fra1'], 'proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/servers', $this->http->requests[0]['url']);
    }

    public function testRejectsACreateMissingARequiredFieldWithoutSendingARequest(): void
    {
        $valid = ['name' => 'web-1', 'size' => 's-1vcpu-1gb', 'region' => 'fra1'];

        foreach (['name', 'size', 'region'] as $field) {
            try {
                $this->client->servers->create([...$valid, $field => '']);
                $this->fail("Expected an InvalidArgumentException for an empty {$field}");
            } catch (InvalidArgumentException $err) {
                $this->assertSame("{$field} is required", $err->getMessage());
            }
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testRejectsAnUnknownCreateFieldWithoutSendingARequest(): void
    {
        try {
            $this->client->servers->create(['name' => 'web-1', 'size' => 's', 'region' => 'fra1', 'ssh_key_ids' => []]);
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('Unknown field "ssh_key_ids"', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }
}
