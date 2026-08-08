<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\NotFoundError;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class WebhooksServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects/proj-1/webhooks';

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

    /** @return array<string, mixed> */
    private function endpointFixture(): array
    {
        return [
            'id' => 'ep-1',
            'name' => 'Billing receiver',
            'description' => null,
            'url' => 'https://example.com/hooks',
            'events' => ['email.delivered'],
            'enabled' => true,
            'secretHint' => 'cdef',
            'consecutiveFailures' => 0,
            'disabledAt' => null,
            'disabledReason' => null,
            'lastSuccessAt' => null,
            'lastFailureAt' => null,
            'createdAt' => '2026-08-08T12:00:00.000Z',
            'updatedAt' => '2026-08-08T12:00:00.000Z',
        ];
    }

    public function testThrowsWhenEndpointIdIsEmptyOnGet(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('endpointId is required');

        $this->client->webhooks->get('');
    }

    public function testThrowsWhenDeliveryIdIsEmptyOnReplay(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('deliveryId is required');

        $this->client->webhooks->replayDelivery('ep-1', '');
    }

    public function testThrowsWhenNameIsEmptyOnCreate(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('name is required');

        $this->client->webhooks->create('', 'https://e.com', ['email.sent']);
    }

    public function testThrowsWhenUrlIsEmptyOnCreate(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('url is required');

        $this->client->webhooks->create('Hooks', '', ['email.sent']);
    }

    public function testThrowsWhenNoEventsGivenOnCreate(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('At least one event is required');

        $this->client->webhooks->create('Hooks', 'https://e.com', []);
    }

    public function testThrowsWhenClearingEveryEventOnUpdate(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('At least one event is required');

        $this->client->webhooks->update('ep-1', null, null, []);
    }

    public function testThrowsWhenNoProjectIdIsAvailable(): void
    {
        $scopeless = new Cosmoner('key-123', null, 'https://api.test.dev', 30.0, 0, $this->http);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('projectId is required');

        $scopeless->webhooks->list();
    }

    public function testListsEndpoints(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->endpointFixture()]]);

        $result = $this->client->webhooks->list();

        $this->assertSame([$this->endpointFixture()], $result['data']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
    }

    public function testFetchesOneEndpointWithStats(): void
    {
        $stats = ['succeeded' => 12, 'failed' => 1, 'pending' => 0];
        $this->http->queueJson(200, [
            'success' => true,
            'data' => ['endpoint' => $this->endpointFixture(), 'stats' => $stats],
        ]);

        $result = $this->client->webhooks->get('ep-1');

        $this->assertSame($stats, $result['data']['stats']);
        $this->assertSame(self::BASE . '/ep-1', $this->http->requests[0]['url']);
    }

    public function testCreatesAnEndpointAndSurfacesTheOneTimeSecret(): void
    {
        $this->http->queueJson(201, [
            'success' => true,
            'data' => $this->endpointFixture() + ['secret' => 'whsec_full_value'],
        ]);

        $result = $this->client->webhooks->create(
            'Billing receiver',
            'https://example.com/hooks',
            ['email.delivered', 'email.bounced'],
            'Receipts',
        );

        $this->assertSame('whsec_full_value', $result['data']['secret']);
        $this->assertSame('POST', $this->http->requests[0]['method']);
        $this->assertSame([
            'name' => 'Billing receiver',
            'url' => 'https://example.com/hooks',
            'events' => ['email.delivered', 'email.bounced'],
            'description' => 'Receipts',
        ], $this->sentBody());
    }

    public function testOmitsDescriptionWhenNotGiven(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => []]);

        $this->client->webhooks->create('Hooks', 'https://e.com', ['email.sent']);

        $this->assertArrayNotHasKey('description', $this->sentBody());
    }

    public function testUpdatesOnlyTheFieldsGiven(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->endpointFixture()]);

        $this->client->webhooks->update('ep-1', enabled: false);

        $this->assertSame('PATCH', $this->http->requests[0]['method']);
        // Untouched fields must not be sent — the API treats present keys as edits.
        // Named arguments are required to leave $description at its sentinel.
        $this->assertSame(['enabled' => false], $this->sentBody());
    }

    public function testSendsAnExplicitNullToClearTheDescription(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->endpointFixture()]);

        $this->client->webhooks->update('ep-1', description: null);

        $this->assertSame(['description' => null], $this->sentBody());
    }

    public function testDeletesAnEndpoint(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => null]);

        $this->client->webhooks->delete('ep-1');

        $this->assertSame('DELETE', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/ep-1', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testResumesAPausedEndpoint(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->endpointFixture()]);

        $this->client->webhooks->resume('ep-1');

        $this->assertSame('POST', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/ep-1/resume', $this->http->requests[0]['url']);
    }

    public function testRotatesTheSigningSecret(): void
    {
        $this->http->queueJson(200, [
            'success' => true,
            'data' => ['id' => 'ep-1', 'secret' => 'whsec_rotated'],
        ]);

        $result = $this->client->webhooks->rotateSecret('ep-1');

        $this->assertSame('whsec_rotated', $result['data']['secret']);
        $this->assertSame(self::BASE . '/ep-1/rotate-secret', $this->http->requests[0]['url']);
    }

    public function testSendsATestEventWithAnExplicitType(): void
    {
        $this->http->queueJson(200, [
            'success' => true,
            'data' => ['outcome' => 'SUCCEEDED', 'delivery' => []],
        ]);

        $result = $this->client->webhooks->test('ep-1', 'email.bounced');

        $this->assertSame('SUCCEEDED', $result['data']['outcome']);
        $this->assertSame(['eventType' => 'email.bounced'], $this->sentBody());
    }

    public function testSendsNoBodyWhenTheTestEventTypeIsOmitted(): void
    {
        $this->http->queueJson(200, [
            'success' => true,
            'data' => ['outcome' => 'SUCCEEDED', 'delivery' => []],
        ]);

        $this->client->webhooks->test('ep-1');

        // An empty array would encode as "[]", which the API rejects where it
        // expects an object — so no body is sent at all.
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testPassesDeliveryFiltersAsQueryParameters(): void
    {
        $this->http->queueJson(200, [
            'success' => true,
            'data' => ['deliveries' => [], 'nextCursor' => null],
        ]);

        $this->client->webhooks->listDeliveries('ep-1', 'FAILED', 'email.bounced', 50, 'dlv-9');

        $url = $this->http->requests[0]['url'];
        $this->assertStringStartsWith(self::BASE . '/ep-1/deliveries?', $url);

        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $this->assertSame([
            'status' => 'FAILED',
            'eventType' => 'email.bounced',
            'limit' => '50',
            'cursor' => 'dlv-9',
        ], $query);
    }

    public function testOmitsAbsentDeliveryFilters(): void
    {
        $this->http->queueJson(200, [
            'success' => true,
            'data' => ['deliveries' => [], 'nextCursor' => null],
        ]);

        $this->client->webhooks->listDeliveries('ep-1');

        $this->assertSame(self::BASE . '/ep-1/deliveries', $this->http->requests[0]['url']);
    }

    public function testReplaysADelivery(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['id' => 'dlv-2']]);

        $result = $this->client->webhooks->replayDelivery('ep-1', 'dlv-1');

        $this->assertSame('dlv-2', $result['data']['id']);
        $this->assertSame(
            self::BASE . '/ep-1/deliveries/dlv-1/replay',
            $this->http->requests[0]['url'],
        );
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->client->webhooks->list('proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/webhooks',
            $this->http->requests[0]['url'],
        );
    }

    public function testMapsA404OntoNotFoundError(): void
    {
        $this->http->queueJson(404, [
            'success' => false,
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Webhook endpoint not found'],
        ]);

        $this->expectException(NotFoundError::class);

        $this->client->webhooks->get('ep-missing');
    }

    public function testSendsAuthAndIdempotencyHeadersOnWrites(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => []]);

        $this->client->webhooks->create('Hooks', 'https://e.com', ['email.sent']);

        $headers = $this->http->requests[0]['headers'];
        $this->assertSame('Bearer key-123', $headers['Authorization']);
        $this->assertNotEmpty($headers['Idempotency-Key']);
    }

    public function testExposesVerifyOnTheNamespace(): void
    {
        $this->assertFalse($this->client->webhooks->verify('{}', 'garbage', 'secret'));
    }
}
