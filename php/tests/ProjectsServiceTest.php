<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\NotFoundError;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class ProjectsServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects';

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
    private function projectFixture(): array
    {
        return [
            'id' => 'proj-2',
            'name' => 'Acme',
            'slug' => 'acme',
            'billingEmail' => 'billing@acme.test',
            'blockedAt' => null,
            'blockedReason' => null,
            '_count' => [
                'servers' => 1,
                'domains' => 2,
                'members' => 3,
                'apps' => 4,
                'objectStorages' => 0,
                'containerRegistries' => 1,
                'databaseClusters' => 0,
            ],
        ];
    }

    public function testThrowsWhenProjectIsEmptyOnGet(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('project is required');

        $this->client->projects->get('');
    }

    public function testRejectsInvalidInputWithoutSendingARequest(): void
    {
        try {
            $this->client->projects->get('');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException) {
            $this->assertSame(0, $this->http->callCount());
        }
    }

    public function testListsProjectsWithoutUsingTheDefaultProject(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->projectFixture()]]);

        $result = $this->client->projects->list();

        $this->assertSame(['success' => true, 'data' => [$this->projectFixture()]], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testListsProjectsOnAClientWithNoDefaultProject(): void
    {
        $scopeless = new Cosmoner('key-123', null, 'https://api.test.dev', 30.0, 0, $this->http);
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $scopeless->projects->list();

        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
    }

    public function testFetchesTheNamedProjectRatherThanTheDefault(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->projectFixture()]);

        $result = $this->client->projects->get('acme');

        $this->assertSame('acme', $result['data']['slug']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/acme', $this->http->requests[0]['url']);
    }

    public function testUrlEncodesTheProjectReference(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->projectFixture()]);

        $this->client->projects->get('acme web');

        $this->assertSame(self::BASE . '/acme%20web', $this->http->requests[0]['url']);
    }

    public function testMapsA404OntoNotFoundError(): void
    {
        $this->http->queueJson(404, [
            'success' => false,
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Project not found'],
        ]);

        $this->expectException(NotFoundError::class);

        $this->client->projects->get('missing');
    }
}
