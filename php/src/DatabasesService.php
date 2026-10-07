<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Reads and deletes a project's databases: dedicated clusters and shared tenants.
 * Prices and creates dedicated clusters.
 *
 * Sizes, engine versions and regions to create one with come from
 * `catalog->databases()`. The API returns more fields than the shapes below
 * declare.
 *
 * @phpstan-import-type CheckoutPreview from CatalogService
 * @phpstan-type DatabaseSummary array{
 *     kind: 'DEDICATED'|'LEGACY_POOLED',
 *     id: string,
 *     name: string,
 *     engine: string,
 *     version: ?string,
 *     region: ?string,
 *     status: string,
 *     plan: ?string,
 *     createdAt: string,
 *     dedicated?: array{numNodes: int, storageGb: ?int},
 *     pooled?: array{maxConnections: int, storageLimitMb: int},
 *     ...
 * }
 * @phpstan-type DedicatedDatabase array{
 *     id: string,
 *     name: string,
 *     engine: string,
 *     version: string,
 *     provider: string,
 *     region: string,
 *     size: string,
 *     numNodes: int,
 *     storageGb: ?int,
 *     status: string,
 *     host: ?string,
 *     port: ?int,
 *     defaultDb: ?string,
 *     defaultUser: ?string,
 *     createdAt: string,
 *     ...
 * }
 * @phpstan-type DedicatedDatabaseDetail array{
 *     id: string,
 *     name: string,
 *     engine: string,
 *     version: string,
 *     provider: string,
 *     region: string,
 *     size: string,
 *     numNodes: int,
 *     storageGb: ?int,
 *     status: string,
 *     host: ?string,
 *     port: ?int,
 *     defaultDb: ?string,
 *     defaultUser: ?string,
 *     connectionUri: string,
 *     createdAt: string,
 *     ...
 * }
 * @phpstan-type SharedDatabase array{
 *     id: string,
 *     clusterId: string,
 *     clusterName: string,
 *     dbName: string,
 *     dbUser: string,
 *     host: ?string,
 *     port: ?int,
 *     region: string,
 *     poolName: ?string,
 *     poolPort: ?int,
 *     poolMode: string,
 *     status: string,
 *     tier: string,
 *     maxConnections: int,
 *     storageLimitMb: int,
 *     createdAt: string,
 *     ...
 * }
 */
class DatabasesService
{
    /** The engine `createDedicated()` uses when none is given. */
    public const DEFAULT_ENGINE = 'POSTGRESQL';

    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists a summary of every database in the project, of every kind.
     *
     * `kind` says which detail route describes each one: `DEDICATED` rows are
     * read with `getDedicated()`, `LEGACY_POOLED` rows with `getShared()`.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: list<DatabaseSummary>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        /** @var array{success: true, data: list<DatabaseSummary>} */
        return $this->transport->request('GET', $this->basePath($projectId));
    }

    /**
     * Lists the project's dedicated database clusters.
     *
     * @return array{success: true, data: list<DedicatedDatabase>}
     *
     * @throws CosmonerError On API errors.
     */
    public function listDedicated(?string $projectId = null): array
    {
        /** @var array{success: true, data: list<DedicatedDatabase>} */
        return $this->transport->request('GET', $this->basePath($projectId) . '/dedicated');
    }

    /**
     * Fetches one dedicated cluster, including its `connectionUri`.
     *
     * `connectionUri` is always present and is a full connection URI including
     * the password. It needs only the `databases:read` scope, so guard the key
     * accordingly.
     *
     * @return array{success: true, data: DedicatedDatabaseDetail}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function getDedicated(string $databaseId, ?string $projectId = null): array
    {
        self::requireDatabaseId($databaseId);

        /** @var array{success: true, data: DedicatedDatabaseDetail} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . "/dedicated/{$databaseId}",
        );
    }

    /**
     * Quotes the price of a dedicated cluster of the given size before it is created.
     *
     * Prices the monthly charge exactly. `dueToday` is an estimate for a project
     * that already has a subscription, because the real charge is prorated onto it.
     *
     * @param string $size A size slug from `catalog->databases()`.
     *
     * @return array{success: true, data: CheckoutPreview}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function previewDedicated(string $size, ?string $projectId = null): array
    {
        if ($size === '') {
            throw new InvalidArgumentException('size is required');
        }

        /** @var array{success: true, data: CheckoutPreview} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . '/dedicated/preview',
            null,
            ['slug' => $size],
        );
    }

    /**
     * Creates a dedicated database cluster, which starts `CREATING`.
     *
     * Charges the project's saved card immediately (a prorated invoice). When the
     * project cannot be billed the API refuses with a 402 —
     * `ORG_PAYMENT_METHOD_REQUIRED`, `BILLER_PAYMENT_METHOD_REQUIRED` or
     * `PAYMENT_REQUIRED` — before anything is created.
     *
     * The response carries no id: `listDedicated()` and match by name to find
     * the cluster.
     *
     * @param array{
     *     name: string,
     *     size: string,
     *     version: string,
     *     region: string,
     *     engine?: ?string,
     * } $params `size`, `version` and `region` come from `catalog->databases()`;
     *     `engine` defaults to `POSTGRESQL`.
     *
     * @return array{success: true, data: array{deployed: true}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function createDedicated(array $params, ?string $projectId = null): array
    {
        Params::check(
            $params,
            ['name', 'size', 'version', 'region', 'engine'],
            ['name', 'size', 'version', 'region'],
        );

        /** @var array{success: true, data: array{deployed: true}} */
        return $this->transport->request('POST', $this->basePath($projectId) . '/dedicated', [
            'name' => $params['name'],
            'engine' => $params['engine'] ?? self::DEFAULT_ENGINE,
            'version' => $params['version'],
            'slug' => $params['size'],
            'region' => $params['region'],
        ]);
    }

    /**
     * Lists the project's tenants on shared database clusters.
     *
     * @return array{success: true, data: list<SharedDatabase>}
     *
     * @throws CosmonerError On API errors.
     */
    public function listShared(?string $projectId = null): array
    {
        /** @var array{success: true, data: list<SharedDatabase>} */
        return $this->transport->request('GET', $this->basePath($projectId) . '/shared');
    }

    /**
     * Fetches one shared database tenant.
     *
     * @return array{success: true, data: SharedDatabase}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function getShared(string $tenantId, ?string $projectId = null): array
    {
        self::requireTenantId($tenantId);

        /** @var array{success: true, data: SharedDatabase} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . "/shared/{$tenantId}",
        );
    }

    /**
     * Permanently deletes a dedicated database cluster.
     *
     * @return array{success: true, data: array{}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function deleteDedicated(string $databaseId, ?string $projectId = null): array
    {
        self::requireDatabaseId($databaseId);

        /** @var array{success: true, data: array{}} */
        return $this->transport->request(
            'DELETE',
            $this->basePath($projectId) . "/dedicated/{$databaseId}",
        );
    }

    /**
     * Permanently deletes a shared database tenant.
     *
     * @return array{success: true, data: array{}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function deleteShared(string $tenantId, ?string $projectId = null): array
    {
        self::requireTenantId($tenantId);

        /** @var array{success: true, data: array{}} */
        return $this->transport->request(
            'DELETE',
            $this->basePath($projectId) . "/shared/{$tenantId}",
        );
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/databases';
    }

    /** Rejects an empty dedicated database id before it becomes a malformed route. */
    private static function requireDatabaseId(string $databaseId): void
    {
        if ($databaseId === '') {
            throw new InvalidArgumentException('databaseId is required');
        }
    }

    /** Rejects an empty shared tenant id before it becomes a malformed route. */
    private static function requireTenantId(string $tenantId): void
    {
        if ($tenantId === '') {
            throw new InvalidArgumentException('tenantId is required');
        }
    }
}
