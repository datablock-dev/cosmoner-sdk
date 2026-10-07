<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\NotFoundError;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class DomainsServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects/proj-1/domains';

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
    private function domainFixture(): array
    {
        return [
            'id' => 'dom-1',
            'name' => 'example.com',
            'type' => 'EXTERNAL',
            'status' => 'ACTIVE',
            'registrar' => null,
            'expiresAt' => null,
            'autoRenew' => true,
            'dnsRecords' => [
                [
                    'id' => 'rec-1',
                    'type' => 'A',
                    'name' => '@',
                    'value' => '203.0.113.10',
                    'ttl' => 300,
                    'priority' => null,
                ],
            ],
            'verificationRecord' => null,
            'createdAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    public function testThrowsWhenDomainIsEmptyOnGet(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('domain is required');

        $this->client->domains->get('');
    }

    public function testRejectsInvalidInputWithoutSendingARequest(): void
    {
        try {
            $this->client->domains->get('');
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

        $scopeless->domains->list();
    }

    public function testListsDomains(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->domainFixture()]]);

        $result = $this->client->domains->list();

        $this->assertSame(['success' => true, 'data' => [$this->domainFixture()]], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testFetchesADomainById(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->domainFixture()]);

        $result = $this->client->domains->get('dom-1');

        $this->assertSame($this->domainFixture(), $result['data']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/dom-1', $this->http->requests[0]['url']);
    }

    public function testFetchesADomainByName(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->domainFixture()]);

        $this->client->domains->get('example.com');

        $this->assertSame(self::BASE . '/example.com', $this->http->requests[0]['url']);
    }

    public function testUrlEncodesTheDomainReference(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->domainFixture()]);

        $this->client->domains->get('ci/deploy example.com');

        $this->assertSame(self::BASE . '/ci%2Fdeploy%20example.com', $this->http->requests[0]['url']);
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->domainFixture()]);

        $this->client->domains->get('example.com', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/domains/example.com',
            $this->http->requests[0]['url'],
        );
    }

    public function testMapsA404OntoNotFoundError(): void
    {
        $this->http->queueJson(404, [
            'success' => false,
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Domain not found'],
        ]);

        $this->expectException(NotFoundError::class);

        $this->client->domains->get('missing.example');
    }
}
