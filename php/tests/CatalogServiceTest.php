<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\NotFoundError;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class CatalogServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/catalog';

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
     * Every catalog method, keyed by name, with the route it reads.
     *
     * @return array<string, array{string, string}>
     */
    public static function routes(): array
    {
        return [
            'serverSizes' => ['serverSizes', '/servers/sizes'],
            'serverRegions' => ['serverRegions', '/servers/regions'],
            'serverImages' => ['serverImages', '/servers/1-clicks'],
            'redisPlans' => ['redisPlans', '/redis/plans'],
            'redisRegions' => ['redisRegions', '/redis/regions'],
            'databases' => ['databases', '/databases'],
            'appSizes' => ['appSizes', '/apps/sizes'],
            'appRegions' => ['appRegions', '/apps/regions'],
        ];
    }

    #[DataProvider('routes')]
    public function testReadsTheRouteWithoutUsingTheDefaultProject(string $method, string $route): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $result = $this->client->catalog->{$method}();

        $this->assertSame(['success' => true, 'data' => []], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . $route, $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    #[DataProvider('routes')]
    public function testWorksOnAClientWithNoDefaultProject(string $method, string $route): void
    {
        $scopeless = new Cosmoner('key-123', null, 'https://api.test.dev', 30.0, 0, $this->http);
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $scopeless->catalog->{$method}();

        $this->assertSame(self::BASE . $route, $this->http->requests[0]['url']);
    }

    public function testReturnsServerSizes(): void
    {
        $sizes = [[
            'slug' => 's-1vcpu-1gb',
            'description' => 'Basic',
            'vcpus' => 1,
            'memoryMb' => 1024,
            'diskGb' => 25,
            'transferTb' => 1,
            'priceMonthly' => 6,
            'priceHourly' => 0.00893,
        ]];
        $this->http->queueJson(200, ['success' => true, 'data' => $sizes]);

        $result = $this->client->catalog->serverSizes();

        $this->assertSame(['success' => true, 'data' => $sizes], $result);
    }

    public function testReturnsTheDatabaseCatalog(): void
    {
        $catalog = [
            'provider' => 'DIGITAL_OCEAN',
            'sizes' => [[
                'slug' => 'db-s-1vcpu-1gb',
                'description' => 'Basic',
                'nodeClass' => 'basic',
                'vcpus' => 1,
                'memoryMb' => 1024,
                'diskGb' => 10,
                'priceMonthly' => 15,
                'numNodes' => 1,
            ]],
            'engines' => [['engine' => 'POSTGRESQL', 'versions' => ['16', '17']]],
            'regions' => [['slug' => 'fra1', 'name' => 'Frankfurt 1', 'features' => []]],
            'storage' => null,
        ];
        $this->http->queueJson(200, ['success' => true, 'data' => $catalog]);

        $result = $this->client->catalog->databases();

        $this->assertSame(['success' => true, 'data' => $catalog], $result);
    }

    public function testReturnsAppSizesUnderTheApisOwnKeys(): void
    {
        $sizes = [[
            'name' => 'Basic XXS',
            'slug' => 'basic-xxs',
            'tier_slug' => 'basic',
            'cpu_type' => 'SHARED',
            'cpus' => '1',
            'memory_bytes' => '536870912',
            'usd_per_month' => '5.00',
        ]];
        $this->http->queueJson(200, ['success' => true, 'data' => $sizes]);

        $result = $this->client->catalog->appSizes();

        $this->assertSame(['success' => true, 'data' => $sizes], $result);
    }

    public function testMapsA404OntoNotFoundError(): void
    {
        $this->http->queueJson(404, [
            'success' => false,
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Not found'],
        ]);

        $this->expectException(NotFoundError::class);

        $this->client->catalog->redisPlans();
    }
}
