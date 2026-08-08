<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Config;
use Cosmoner\Sdk\Cosmoner;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class CosmonerTest extends TestCase
{
    public function testInitializesWithValidParams(): void
    {
        $client = new Cosmoner('key-123', 'proj-1');

        $this->assertSame('key-123', $client->apiKey);
        $this->assertSame('proj-1', $client->projectId);
        $this->assertSame('https://api.cosmoner.com', $client->baseUrl);
    }

    public function testUsesCustomBaseUrl(): void
    {
        $client = new Cosmoner('key-123', 'proj-1', 'https://custom.api.dev');

        $this->assertSame('https://custom.api.dev', $client->baseUrl);
    }

    public function testStripsTrailingSlashFromBaseUrl(): void
    {
        $client = new Cosmoner('key-123', 'proj-1', 'https://custom.api.dev/');

        $this->assertSame('https://custom.api.dev', $client->baseUrl);
    }

    public function testThrowsWhenApiKeyIsEmpty(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('apiKey is required');

        new Cosmoner('', 'proj-1');
    }

    public function testThrowsWhenProjectIdIsEmpty(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('projectId is required');

        new Cosmoner('key-123', '');
    }

    public function testProjectIdIsOptional(): void
    {
        $client = new Cosmoner('key-123');

        $this->assertNull($client->projectId);
    }

    public function testAppliesDefaultTimeoutAndRetries(): void
    {
        $client = new Cosmoner('key-123', 'proj-1');

        $this->assertSame(30.0, $client->timeout);
        $this->assertSame(2, $client->maxRetries);
    }

    public function testAcceptsCustomTimeoutAndRetries(): void
    {
        $client = new Cosmoner('key-123', 'proj-1', Config::DEFAULT_BASE_URL, 5.0, 0);

        $this->assertSame(5.0, $client->timeout);
        $this->assertSame(0, $client->maxRetries);
    }

    public function testRejectsNonPositiveTimeout(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('timeout must be greater than 0');

        new Cosmoner('key-123', 'proj-1', Config::DEFAULT_BASE_URL, 0.0);
    }

    public function testRejectsNegativeRetries(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('maxRetries cannot be negative');

        new Cosmoner('key-123', 'proj-1', Config::DEFAULT_BASE_URL, 30.0, -1);
    }

    public function testExposesEmailService(): void
    {
        $client = new Cosmoner('key-123', 'proj-1');

        $this->assertInstanceOf(\Cosmoner\Sdk\EmailService::class, $client->email);
    }
}
