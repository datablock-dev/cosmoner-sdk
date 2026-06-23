<?php

declare(strict_types=1);

namespace Datablock\Sdk\Tests;

use Datablock\Sdk\Datablock;
use Datablock\Sdk\DatablockError;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class DatablockTest extends TestCase
{
    public function testInitializesWithValidParams(): void
    {
        $client = new Datablock('key-123', 'proj-1');

        $this->assertSame('key-123', $client->apiKey);
        $this->assertSame('proj-1', $client->projectId);
        $this->assertSame('https://api.datablock.dev', $client->baseUrl);
    }

    public function testUsesCustomBaseUrl(): void
    {
        $client = new Datablock('key-123', 'proj-1', 'https://custom.api.dev');

        $this->assertSame('https://custom.api.dev', $client->baseUrl);
    }

    public function testStripsTrailingSlashFromBaseUrl(): void
    {
        $client = new Datablock('key-123', 'proj-1', 'https://custom.api.dev/');

        $this->assertSame('https://custom.api.dev', $client->baseUrl);
    }

    public function testThrowsWhenApiKeyIsEmpty(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('apiKey is required');

        new Datablock('', 'proj-1');
    }

    public function testThrowsWhenProjectIdIsEmpty(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('projectId is required');

        new Datablock('key-123', '');
    }

    public function testExposesEmailService(): void
    {
        $client = new Datablock('key-123', 'proj-1');

        $this->assertInstanceOf(\Datablock\Sdk\EmailService::class, $client->email);
    }
}
