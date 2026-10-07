<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/**
 * The sizes, plans and regions paid resources are ordered with.
 *
 * Account-level: unlike every other namespace these routes are not scoped to a
 * project, so they ignore the client-level default project and work on a
 * client without one.
 *
 * Also declares the price quotes every `preview` method returns, which the
 * project-scoped namespaces import. Quote amounts are integers in the
 * currency's minor units (cents for USD); catalog prices are in dollars.
 *
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-type CheckoutPreview array{
 *     subtotal: int,
 *     tax: ?int,
 *     creditApplied: int,
 *     dueToday: int,
 *     monthly: int,
 *     currency: string,
 *     nextBillingDate: string,
 *     ...
 * }
 * @phpstan-type PlanChangePreview array{
 *     subtotal: int,
 *     tax: ?int,
 *     creditApplied: int,
 *     dueToday: int,
 *     monthly: int,
 *     currency: string,
 *     nextBillingDate: string,
 *     direction: 'upgrade'|'downgrade',
 *     creditBack: int,
 *     currentMonthly: int,
 *     ...
 * }
 * @phpstan-type ServerSize array{
 *     slug: string,
 *     description: string,
 *     vcpus: int,
 *     memoryMb: int,
 *     diskGb: int,
 *     transferTb: int|float,
 *     priceMonthly: int,
 *     priceHourly: int|float,
 *     ...
 * }
 * @phpstan-type CatalogRegion array{slug: string, name: string, features?: list<string>, ...}
 * @phpstan-type RedisPlan array{
 *     slug: string,
 *     name: string,
 *     provider: string,
 *     engine: string,
 *     planType: string,
 *     memoryMb: int,
 *     throughputOps: ?int,
 *     cpuMilli: ?int,
 *     supportsReplication: bool,
 *     supportsPersistence: bool,
 *     priceMonthly: int|float,
 *     ...
 * }
 * @phpstan-type RedisRegion array{
 *     slug: string,
 *     name: string,
 *     cloudProvider: string,
 *     providers: list<string>,
 *     planTypes: list<string>,
 *     ...
 * }
 * @phpstan-type DatabaseSize array{
 *     slug: string,
 *     description: string,
 *     nodeClass: string,
 *     vcpus: int,
 *     memoryMb: int,
 *     diskGb: int,
 *     priceMonthly: int|float,
 *     numNodes: int,
 *     ...
 * }
 * @phpstan-type DatabaseCatalog array{
 *     provider: string,
 *     sizes: list<DatabaseSize>,
 *     engines: list<array{engine: string, versions: list<string>, ...}>,
 *     regions: list<CatalogRegion>,
 *     storage: mixed,
 *     ...
 * }
 * @phpstan-type AppSize array{
 *     name: string,
 *     slug: string,
 *     tier_slug: string,
 *     cpu_type: string,
 *     cpus: int|string,
 *     memory_bytes: int|string,
 *     bandwidth_allowance_gib?: int|string,
 *     usd_per_month: string,
 *     ...
 * }
 */
class CatalogService
{
    /** Binds the namespace to the client's transport; no project is resolved here. */
    public function __construct(
        private readonly Transport $transport,
    ) {
    }

    /**
     * Lists server sizes; `priceMonthly` is in whole dollars.
     *
     * @return array{success: true, data: list<ServerSize>}
     *
     * @throws CosmonerError On API errors.
     */
    public function serverSizes(): array
    {
        /** @var array{success: true, data: list<ServerSize>} */
        return $this->transport->request('GET', '/v1/catalog/servers/sizes');
    }

    /**
     * Lists the regions servers can be created in.
     *
     * @return array{success: true, data: list<CatalogRegion>}
     *
     * @throws CosmonerError On API errors.
     */
    public function serverRegions(): array
    {
        /** @var array{success: true, data: list<CatalogRegion>} */
        return $this->transport->request('GET', '/v1/catalog/servers/regions');
    }

    /**
     * Lists the one-click images a server can be created from.
     *
     * @return array{success: true, data: array<int, array<string, mixed>>}
     *
     * @throws CosmonerError On API errors.
     */
    public function serverImages(): array
    {
        /** @var array{success: true, data: array<int, array<string, mixed>>} */
        return $this->transport->request('GET', '/v1/catalog/servers/1-clicks');
    }

    /**
     * Lists Redis plans; `priceMonthly` is in dollars.
     *
     * @return array{success: true, data: list<RedisPlan>}
     *
     * @throws CosmonerError On API errors.
     */
    public function redisPlans(): array
    {
        /** @var array{success: true, data: list<RedisPlan>} */
        return $this->transport->request('GET', '/v1/catalog/redis/plans');
    }

    /**
     * Lists the regions Redis can be created in, with the plan types each offers.
     *
     * @return array{success: true, data: list<RedisRegion>}
     *
     * @throws CosmonerError On API errors.
     */
    public function redisRegions(): array
    {
        /** @var array{success: true, data: list<RedisRegion>} */
        return $this->transport->request('GET', '/v1/catalog/redis/regions');
    }

    /**
     * Lists dedicated database sizes, engines with their versions, and regions.
     *
     * Size prices are in dollars.
     *
     * @return array{success: true, data: DatabaseCatalog}
     *
     * @throws CosmonerError On API errors.
     */
    public function databases(): array
    {
        /** @var array{success: true, data: DatabaseCatalog} */
        return $this->transport->request('GET', '/v1/catalog/databases');
    }

    /**
     * Lists app sizes, under the API's own snake_case keys.
     *
     * `usd_per_month` is a string of dollars.
     *
     * @return array{success: true, data: list<AppSize>}
     *
     * @throws CosmonerError On API errors.
     */
    public function appSizes(): array
    {
        /** @var array{success: true, data: list<AppSize>} */
        return $this->transport->request('GET', '/v1/catalog/apps/sizes');
    }

    /**
     * Lists the regions apps can be created in.
     *
     * @return array{success: true, data: list<array{slug: string, label: string, ...}>}
     *
     * @throws CosmonerError On API errors.
     */
    public function appRegions(): array
    {
        /** @var array{success: true, data: list<array{slug: string, label: string, ...}>} */
        return $this->transport->request('GET', '/v1/catalog/apps/regions');
    }
}
