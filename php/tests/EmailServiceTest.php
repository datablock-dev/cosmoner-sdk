<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class EmailServiceTest extends TestCase
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

    /** Decode the JSON body of the recorded request. */
    private function sentBody(): array
    {
        return json_decode($this->http->requests[0]['body'], true);
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

    public function testSendsEmailSuccessfully(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => ['messageId' => 'msg-abc']]);

        $result = $this->client->email->send('cred-1', 'user@test.com', 'Test', null, 'Hello world');

        $this->assertSame(['success' => true, 'data' => ['messageId' => 'msg-abc']], $result);
        $this->assertSame('POST', $this->http->requests[0]['method']);
    }

    public function testSendsCorrectPayloadWithAllFields(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => ['messageId' => 'msg-def']]);

        $this->client->email->send(
            'cred-1',
            ['a@test.com', 'b@test.com'],
            'Test',
            '<h1>Hi</h1>',
            'Hi',
            'reply@test.com',
        );

        $body = $this->sentBody();
        $this->assertSame('cred-1', $body['credentialId']);
        $this->assertSame(['a@test.com', 'b@test.com'], $body['to']);
        $this->assertSame('Test', $body['subject']);
        $this->assertSame('<h1>Hi</h1>', $body['html']);
        $this->assertSame('Hi', $body['text']);
        $this->assertSame('reply@test.com', $body['replyTo']);
    }

    public function testOmitsOptionalFieldsWhenNull(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => ['messageId' => 'msg-ghi']]);

        $this->client->email->send('cred-1', 'user@test.com', 'Test', null, 'body');

        $body = $this->sentBody();
        $this->assertArrayNotHasKey('html', $body);
        $this->assertArrayNotHasKey('replyTo', $body);
    }

    public function testAcceptsArrayRecipients(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => ['messageId' => 'msg-jkl']]);

        $result = $this->client->email->send(
            'cred-1',
            ['a@test.com', 'b@test.com'],
            'Hello',
            '<h1>Hi</h1>',
        );

        $this->assertTrue($result['success']);
    }
}
