<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class InvoicesServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects/proj-1/billing/invoices';

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
    private function invoiceFixture(): array
    {
        return [
            'id' => 'in_1',
            'number' => 'DB-0001',
            'created' => '2026-02-01T09:15:00.000Z',
            'amountDue' => 4900,
            'currency' => 'USD',
            'status' => 'paid',
            'hostedInvoiceUrl' => 'https://invoices.test/in_1',
            'invoicePdfUrl' => 'https://invoices.test/in_1/pdf',
            'project' => null,
        ];
    }

    public function testListsAPageWithNoQueryByDefault(): void
    {
        $page = ['data' => [$this->invoiceFixture()], 'hasMore' => false, 'nextCursor' => null];
        $this->http->queueJson(200, ['success' => true, 'data' => $page]);

        $result = $this->client->invoices->list();

        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame($page, $result['data']);
    }

    public function testSendsTheFiltersAndCursor(): void
    {
        $this->http->queueJson(200, [
            'success' => true,
            'data' => ['data' => [], 'hasMore' => false, 'nextCursor' => null],
        ]);

        $this->client->invoices->list(
            status: 'open',
            createdGte: '2026-01-01',
            createdLte: '2026-06-30',
            limit: 50,
            startingAfter: 'in_9',
        );

        $url = $this->http->requests[0]['url'];
        $this->assertStringStartsWith(self::BASE . '?', $url);

        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $this->assertSame([
            'status' => 'open',
            'created_gte' => '2026-01-01',
            'created_lte' => '2026-06-30',
            'limit' => '50',
            'starting_after' => 'in_9',
        ], $query);
    }

    public function testExportsWithoutPaging(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->invoiceFixture()]]);

        $result = $this->client->invoices->export(status: 'paid', createdGte: '2026-01-01');

        $this->assertSame(
            self::BASE . '/export?status=paid&created_gte=2026-01-01',
            $this->http->requests[0]['url'],
        );
        $this->assertSame('in_1', $result['data'][0]['id']);
    }

    public function testReadsOneInvoice(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->invoiceFixture()]);

        $result = $this->client->invoices->get('in_1');

        $this->assertSame(self::BASE . '/in_1', $this->http->requests[0]['url']);
        $this->assertSame('https://invoices.test/in_1/pdf', $result['data']['invoicePdfUrl']);
    }

    public function testEncodesTheInvoiceIdAsOneSegment(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->invoiceFixture()]);

        $this->client->invoices->get('in/../x');

        $this->assertSame(self::BASE . '/in%2F..%2Fx', $this->http->requests[0]['url']);
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->invoiceFixture()]);

        $this->client->invoices->get('in_1', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/billing/invoices/in_1',
            $this->http->requests[0]['url'],
        );
    }

    public function testRejectsAnEmptyInvoiceId(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('invoiceId is required');

        $this->client->invoices->get('');
    }
}
