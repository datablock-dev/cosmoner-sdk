<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\NotFoundError;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class HostingServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects/proj-1/hosting/shared';

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
    private function siteFixture(): array
    {
        return [
            'id' => 'site-1',
            'siteName' => 'blog',
            'phpVersion' => '8.3',
            'unixUser' => 'u_blog',
            'documentRoot' => '/var/www/u_blog/blog.cosmoner.com/public_html',
            'internalHostname' => 'blog.cosmoner.com',
            'url' => 'https://blog.cosmoner.com',
            'tier' => 'shared-xs',
            'sshEnabled' => false,
            'status' => 'ACTIVE',
            'sftpHost' => 'sftp.cosmoner.com',
            'sftpPort' => 2222,
            'createdAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    /** @return array<string, mixed> */
    private function accessFixture(): array
    {
        return [
            'username' => 'u_blog',
            'host' => 'sftp.cosmoner.com',
            'sftp' => ['port' => 2222],
            'ssh' => ['port' => 2222, 'enabled' => false],
        ];
    }

    public function testThrowsWhenSiteIdIsEmptyOnGet(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('siteId is required');

        $this->client->hosting->get('');
    }

    public function testThrowsWhenSiteIdIsEmptyOnAccess(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('siteId is required');

        $this->client->hosting->access('');
    }

    public function testRejectsInvalidInputWithoutSendingARequest(): void
    {
        try {
            $this->client->hosting->get('');
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

        $scopeless->hosting->list();
    }

    public function testListsSites(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->siteFixture()]]);

        $result = $this->client->hosting->list();

        $this->assertSame([$this->siteFixture()], $result['data']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
    }

    public function testFetchesASiteWithoutAQueryStringByDefault(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [...$this->siteFixture(), 'ready' => true]]);

        $result = $this->client->hosting->get('site-1');

        $this->assertTrue($result['data']['ready']);
        $this->assertSame(self::BASE . '/site-1', $this->http->requests[0]['url']);
    }

    public function testAsksForCredentialsWhenRequested(): void
    {
        $this->http->queueJson(200, [
            'success' => true,
            'data' => [...$this->siteFixture(), 'ready' => true, 'sftpPassword' => 's3cret'],
        ]);

        $result = $this->client->hosting->get('site-1', true);

        $this->assertSame('s3cret', $result['data']['sftpPassword']);
        $this->assertSame(self::BASE . '/site-1?credentials=true', $this->http->requests[0]['url']);
    }

    public function testFetchesAccessDetails(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->accessFixture()]);

        $result = $this->client->hosting->access('site-1');

        $this->assertSame($this->accessFixture(), $result['data']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/site-1/access', $this->http->requests[0]['url']);
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->client->hosting->list('proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/hosting/shared',
            $this->http->requests[0]['url'],
        );
    }

    public function testMapsA404OntoNotFoundError(): void
    {
        $this->http->queueJson(404, [
            'success' => false,
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Site not found'],
        ]);

        $this->expectException(NotFoundError::class);

        $this->client->hosting->get('site-missing');
    }
}
