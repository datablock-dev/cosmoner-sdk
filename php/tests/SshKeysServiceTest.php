<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class SshKeysServiceTest extends TestCase
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
    private function keyFixture(): array
    {
        return [
            'id' => 'key-1',
            'name' => 'laptop',
            'publicKey' => 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample user@laptop',
            'fingerprint' => 'SHA256:abc',
            'createdAt' => '2026-09-01T12:00:00.000Z',
            'updatedAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    public function testThrowsWhenNoProjectIdIsAvailable(): void
    {
        $scopeless = new Cosmoner('key-123', null, 'https://api.test.dev', 30.0, 0, $this->http);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('projectId is required');

        $scopeless->sshKeys->list();
    }

    public function testListsSshKeys(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->keyFixture()]]);

        $result = $this->client->sshKeys->list();

        $this->assertSame(['success' => true, 'data' => [$this->keyFixture()]], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame('https://api.test.dev/v1/projects/proj-1/ssh-keys', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->client->sshKeys->list('proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/ssh-keys', $this->http->requests[0]['url']);
    }
}
