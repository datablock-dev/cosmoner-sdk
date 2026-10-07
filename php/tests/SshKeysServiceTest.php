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

    public function testRejectsAnEmptyNameOrPublicKeyWithoutSendingARequest(): void
    {
        $cases = [
            'name is required' => fn () => $this->client->sshKeys->create('', 'ssh-ed25519 AAAA'),
            'publicKey is required' => fn () => $this->client->sshKeys->create('laptop', ''),
        ];

        foreach ($cases as $message => $call) {
            try {
                $call();
                $this->fail('Expected an InvalidArgumentException');
            } catch (InvalidArgumentException $err) {
                $this->assertSame($message, $err->getMessage());
            }
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testCreatesAnSshKey(): void
    {
        $created = $this->keyFixture();
        unset($created['updatedAt']);
        $this->http->queueJson(201, ['success' => true, 'data' => $created]);

        $result = $this->client->sshKeys->create('laptop', $created['publicKey']);

        $this->assertSame(['success' => true, 'data' => $created], $result);
        $this->assertSame('POST', $this->http->requests[0]['method']);
        $this->assertSame('https://api.test.dev/v1/projects/proj-1/ssh-keys', $this->http->requests[0]['url']);
        $this->assertSame(
            ['name' => 'laptop', 'publicKey' => $created['publicKey']],
            json_decode((string) $this->http->requests[0]['body'], true),
        );
    }

    public function testCreatesAnSshKeyInAnotherProject(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => $this->keyFixture()]);

        $this->client->sshKeys->create('laptop', 'ssh-ed25519 AAAA', 'proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/ssh-keys', $this->http->requests[0]['url']);
    }

    public function testThrowsWhenSshKeyIdIsEmptyOnDelete(): void
    {
        try {
            $this->client->sshKeys->delete('');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('sshKeyId is required', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testDeletesAnSshKeyAndReportsWhereItIsStillAuthorised(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => ['stillAuthorisedOn' => 2]]);

        $result = $this->client->sshKeys->delete('key-1');

        $this->assertSame(['success' => true, 'data' => ['stillAuthorisedOn' => 2]], $result);
        $this->assertSame('DELETE', $this->http->requests[0]['method']);
        $this->assertSame('https://api.test.dev/v1/projects/proj-1/ssh-keys/key-1', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testDeletesAnSshKeyInAnotherProject(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => ['stillAuthorisedOn' => 0]]);

        $this->client->sshKeys->delete('key-1', 'proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/ssh-keys/key-1', $this->http->requests[0]['url']);
    }
}
