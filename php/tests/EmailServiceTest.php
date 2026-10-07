<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\NotFoundError;
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

    /**
     * Decode the JSON body of the recorded request.
     *
     * @return array<string, mixed>
     */
    private function sentBody(): array
    {
        return json_decode((string) $this->http->requests[0]['body'], true);
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

        $this->client->email->send(
            'cred-1',
            ['a@test.com', 'b@test.com'],
            'Hello',
            '<h1>Hi</h1>',
        );

        $this->assertSame(['a@test.com', 'b@test.com'], $this->sentBody()['to']);
    }

    /** @return array<string, mixed> */
    private function emailDomainFixture(): array
    {
        return [
            'id' => 'ed-1',
            'domainId' => 'dom-1',
            'status' => 'ACTIVE',
            'verifiedAt' => '2026-09-01T12:00:00.000Z',
            'domain' => ['id' => 'dom-1', 'name' => 'example.com', 'status' => 'ACTIVE', 'type' => 'EXTERNAL'],
            'credentials' => [
                [
                    'id' => 'cred-1',
                    'label' => 'app',
                    'fromAddress' => 'hello@example.com',
                    'smtpUsername' => 'smtp-abc',
                    'sentCount' => 12,
                    'lastUsedAt' => null,
                ],
            ],
            'dnsRecords' => [
                [
                    'type' => 'TXT',
                    'name' => 'cosmoner1._domainkey.example.com',
                    'value' => 'v=DKIM1; k=rsa; p=abc',
                    'purpose' => 'DKIM',
                    'description' => 'Signs outgoing mail',
                ],
            ],
            'createdAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    public function testThrowsWhenEmailDomainIdIsEmptyOnGetDomain(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('emailDomainId is required');

        $this->client->email->getDomain('');
    }

    public function testRejectsAnEmptyEmailDomainIdWithoutSendingARequest(): void
    {
        try {
            $this->client->email->getDomain('');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException) {
            $this->assertSame(0, $this->http->callCount());
        }
    }

    public function testThrowsWhenNoProjectIdIsAvailableOnListDomains(): void
    {
        $scopeless = new Cosmoner('key-123', null, 'https://api.test.dev', 30.0, 0, $this->http);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('projectId is required');

        $scopeless->email->listDomains();
    }

    public function testListsEmailDomains(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->emailDomainFixture()]]);

        $result = $this->client->email->listDomains();

        $this->assertSame(['success' => true, 'data' => [$this->emailDomainFixture()]], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame('https://api.test.dev/v1/projects/proj-1/email', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testFetchesAnEmailDomainWithItsSendingStatus(): void
    {
        $sending = ['identity' => null, 'billingRequired' => false];
        $this->http->queueJson(200, [
            'success' => true,
            'data' => [...$this->emailDomainFixture(), 'sending' => $sending],
        ]);

        $result = $this->client->email->getDomain('ed-1');

        $this->assertSame($sending, $result['data']['sending']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame('https://api.test.dev/v1/projects/proj-1/email/ed-1', $this->http->requests[0]['url']);
    }

    public function testTargetsAnotherProjectPerCallOnGetDomain(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->emailDomainFixture()]);

        $this->client->email->getDomain('ed-1', 'proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/email/ed-1', $this->http->requests[0]['url']);
    }

    public function testMapsA404OntoNotFoundErrorOnGetDomain(): void
    {
        $this->http->queueJson(404, [
            'success' => false,
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Email domain not found'],
        ]);

        $this->expectException(NotFoundError::class);

        $this->client->email->getDomain('ed-missing');
    }
}
