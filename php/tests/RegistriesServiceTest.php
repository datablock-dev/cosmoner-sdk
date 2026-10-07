<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\HttpResponse;
use Cosmoner\Sdk\NotFoundError;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class RegistriesServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects/proj-1/storage/container-registry';

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
    private function registryFixture(): array
    {
        return [
            'id' => 'reg-1',
            'name' => 'app-builds',
            'provider' => 'COSMONER',
            'region' => 'eu-north-1',
            'endpoint' => 'registry.cosmoner.com',
            'status' => 'ACTIVE',
            'namespaceName' => 'acme',
            'repositories' => [
                [
                    'id' => 'repo-1',
                    'name' => 'web',
                    'fullPath' => 'registry.cosmoner.com/acme/web',
                    'visibility' => 'PRIVATE',
                ],
            ],
            'createdAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    public function testThrowsWhenRegistryIdIsEmptyOnGet(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('registryId is required');

        $this->client->registries->get('');
    }

    public function testRejectsInvalidInputWithoutSendingARequest(): void
    {
        try {
            $this->client->registries->get('');
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

        $scopeless->registries->list();
    }

    public function testListsRegistries(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->registryFixture()]]);

        $result = $this->client->registries->list();

        $this->assertSame(['success' => true, 'data' => [$this->registryFixture()]], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testFetchesARegistry(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->registryFixture()]);

        $result = $this->client->registries->get('reg-1');

        $this->assertSame($this->registryFixture(), $result['data']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/reg-1', $this->http->requests[0]['url']);
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->registryFixture()]);

        $this->client->registries->get('reg-1', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/storage/container-registry/reg-1',
            $this->http->requests[0]['url'],
        );
    }

    public function testMapsA404OntoNotFoundError(): void
    {
        $this->http->queueJson(404, [
            'success' => false,
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Registry not found'],
        ]);

        $this->expectException(NotFoundError::class);

        $this->client->registries->get('reg-missing');
    }

    public function testThrowsWhenRegistryIdIsEmptyOnDelete(): void
    {
        try {
            $this->client->registries->delete('');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('registryId is required', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testDeletesARegistry(): void
    {
        $this->http->queue(new HttpResponse(200, '{"success":true,"data":{}}'));

        $result = $this->client->registries->delete('reg-1');

        $this->assertSame(['success' => true, 'data' => []], $result);
        $this->assertSame('DELETE', $this->http->requests[0]['method']);
        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-1/storage/container-registry/reg-1',
            $this->http->requests[0]['url'],
        );
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testDeletesARegistryInAnotherProject(): void
    {
        $this->http->queue(new HttpResponse(200, '{"success":true,"data":{}}'));

        $this->client->registries->delete('reg-1', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/storage/container-registry/reg-1',
            $this->http->requests[0]['url'],
        );
    }

    /** @return array<string, mixed> */
    private function previewFixture(): array
    {
        return [
            'subtotal' => 1500,
            'tax' => 375,
            'creditApplied' => 0,
            'dueToday' => 1875,
            'monthly' => 1500,
            'currency' => 'USD',
            'nextBillingDate' => '2026-11-01T00:00:00.000Z',
        ];
    }

    public function testPreviewsARegistry(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->previewFixture()]);

        $result = $this->client->registries->preview();

        $this->assertSame(['success' => true, 'data' => $this->previewFixture()], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/preview', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testPreviewsARegistryInAnotherProject(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->previewFixture()]);

        $this->client->registries->preview('proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/storage/container-registry/preview',
            $this->http->requests[0]['url'],
        );
    }

    public function testListsProviders(): void
    {
        $providers = [[
            'value' => 'cosmoner',
            'label' => 'Cosmoner',
            'description' => 'Hosted next to your apps',
            'regions' => [['value' => 'eu-north-1', 'label' => 'Stockholm']],
        ]];
        $this->http->queueJson(200, ['success' => true, 'data' => $providers]);

        $result = $this->client->registries->providers();

        $this->assertSame(['success' => true, 'data' => $providers], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/providers', $this->http->requests[0]['url']);
    }

    public function testListsProvidersInAnotherProject(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->client->registries->providers('proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/storage/container-registry/providers',
            $this->http->requests[0]['url'],
        );
    }

    public function testCreatesARegistryWithOnlyTheRequiredFields(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['deployed' => true, 'id' => 'reg-1']]);

        $result = $this->client->registries->create(['name' => 'images', 'region' => 'eu-north-1']);

        $this->assertSame(['success' => true, 'data' => ['deployed' => true, 'id' => 'reg-1']], $result);
        $this->assertSame('POST', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertSame('{"name":"images","region":"eu-north-1"}', $this->http->requests[0]['body']);
    }

    public function testCreatesARegistryOnTheGivenProviderInAnotherProject(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['deployed' => true, 'id' => 'reg-1']]);

        $this->client->registries->create(
            ['name' => 'images', 'region' => 'eu-north-1', 'provider' => 'cosmoner'],
            'proj-2',
        );

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/storage/container-registry',
            $this->http->requests[0]['url'],
        );
        $this->assertSame(
            '{"name":"images","region":"eu-north-1","provider":"cosmoner"}',
            $this->http->requests[0]['body'],
        );
    }

    public function testRejectsACreateMissingARequiredFieldWithoutSendingARequest(): void
    {
        $valid = ['name' => 'images', 'region' => 'eu-north-1'];

        foreach (['name', 'region'] as $field) {
            try {
                $this->client->registries->create([...$valid, $field => '']);
                $this->fail("Expected an InvalidArgumentException for an empty {$field}");
            } catch (InvalidArgumentException $err) {
                $this->assertSame("{$field} is required", $err->getMessage());
            }
        }

        $this->assertSame(0, $this->http->callCount());
    }
}
