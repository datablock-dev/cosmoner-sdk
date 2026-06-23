<?php

declare(strict_types=1);

namespace Datablock\Sdk\Tests;

use Datablock\Sdk\Datablock;
use Datablock\Sdk\EmailService;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class EmailServiceTest extends TestCase
{
    private Datablock $client;

    protected function setUp(): void
    {
        $this->client = new Datablock('key-123', 'proj-1', 'https://api.test.dev');
    }

    public function testThrowsWhenNeitherHtmlNorTextProvided(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Either html or text must be provided');

        $this->client->email->send('cred-1', 'user@test.com', 'Hello');
    }

    public function testThrowsWhenBothHtmlAndTextAreNull(): void
    {
        $this->expectException(InvalidArgumentException::class);

        $this->client->email->send('cred-1', 'user@test.com', 'Hello', null, null);
    }

    public function testDoesNotThrowValidationErrorForArrayRecipients(): void
    {
        try {
            $this->client->email->send(
                'cred-1',
                ['a@test.com', 'b@test.com'],
                'Hello',
                '<h1>Hi</h1>',
            );
        } catch (InvalidArgumentException $e) {
            $this->fail('Should not throw validation error for array recipients');
        } catch (\Exception) {
            // Expected — curl fails with no real server
        }

        $this->assertTrue(true);
    }
}
