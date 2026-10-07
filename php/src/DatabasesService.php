<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Read operations on a project's databases: dedicated clusters and shared tenants.
 *
 * The API returns more fields than the shapes below declare.
 *
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
        if ($databaseId === '') {
            throw new InvalidArgumentException('databaseId is required');
        }

        /** @var array{success: true, data: DedicatedDatabaseDetail} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . "/dedicated/{$databaseId}",
        );
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
        if ($tenantId === '') {
            throw new InvalidArgumentException('tenantId is required');
        }

        /** @var array{success: true, data: SharedDatabase} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . "/shared/{$tenantId}",
        );
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/databases';
    }
}
