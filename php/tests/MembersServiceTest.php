<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class MembersServiceTest extends TestCase
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
    private function membersFixture(): array
    {
        return [
            'orgId' => 'proj-1',
            'currentUserId' => 'user-1',
            'billerUserId' => 'user-1',
            'pendingBillerUserId' => null,
            'members' => [
                [
                    'id' => 'mem-1',
                    'userId' => 'user-1',
                    'role' => 'owner',
                    'createdAt' => '2026-09-01T12:00:00.000Z',
                    'user' => ['name' => 'Ada', 'email' => 'ada@acme.test', 'image' => null],
                ],
            ],
            'pendingInvitations' => [
                [
                    'id' => 'inv-1',
                    'email' => 'bob@acme.test',
                    'role' => 'member',
                    'expiresAt' => '2026-10-01T12:00:00.000Z',
                ],
            ],
        ];
    }

    public function testThrowsWhenNoProjectIdIsAvailable(): void
    {
        $scopeless = new Cosmoner('key-123', null, 'https://api.test.dev', 30.0, 0, $this->http);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('projectId is required');

        $scopeless->members->list();
    }

    public function testListsMembersAndInvitations(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->membersFixture()]);

        $result = $this->client->members->list();

        $this->assertSame(['success' => true, 'data' => $this->membersFixture()], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame('https://api.test.dev/v1/projects/proj-1/members', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->membersFixture()]);

        $this->client->members->list('proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/members', $this->http->requests[0]['url']);
    }
}
