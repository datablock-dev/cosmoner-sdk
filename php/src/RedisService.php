<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Reads and deletes a project's Redis databases.
 *
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-type Redis array{
 *     id: string,
 *     name: string,
 *     provider: string,
 *     engine: string,
 *     engineVersion: ?string,
 *     planSlug: string,
 *     planType: string,
 *     memoryMb: int,
 *     throughputOps: ?int,
 *     cloudProvider: string,
 *     region: string,
 *     replication: bool,
 *     dataPersistence: string,
 *     status: string,
 *     host: ?string,
 *     port: ?int,
 *     createdAt: string,
 *     ...
 * }
 * @phpstan-type RedisDetail array{
 *     id: string,
 *     name: string,
 *     provider: string,
 *     engine: string,
 *     engineVersion: ?string,
 *     planSlug: string,
 *     planType: string,
 *     memoryMb: int,
 *     throughputOps: ?int,
 *     cloudProvider: string,
 *     region: string,
 *     replication: bool,
 *     dataPersistence: string,
 *     status: string,
 *     host: ?string,
 *     port: ?int,
 *     password: string,
 *     createdAt: string,
 *     ...
 * }
 */
class RedisService
{
    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists every Redis database in the project.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: list<Redis>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        /** @var array{success: true, data: list<Redis>} */
        return $this->transport->request('GET', $this->basePath($projectId));
    }

    /**
     * Fetches one Redis database, including its plaintext `password`.
     *
     * `password` is always present. It needs only the `redis:read` scope, so
     * guard the key accordingly.
     *
     * @return array{success: true, data: RedisDetail}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function get(string $redisId, ?string $projectId = null): array
    {
        self::requireRedisId($redisId);

        /** @var array{success: true, data: RedisDetail} */
        return $this->transport->request('GET', $this->basePath($projectId) . "/{$redisId}");
    }

    /**
     * Permanently deletes a Redis database.
     *
     * @return array{success: true, data: array{}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $redisId, ?string $projectId = null): array
    {
        self::requireRedisId($redisId);

        /** @var array{success: true, data: array{}} */
        return $this->transport->request('DELETE', $this->basePath($projectId) . "/{$redisId}");
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/redis';
    }

    /** Rejects an empty Redis id before it becomes a malformed route. */
    private static function requireRedisId(string $redisId): void
    {
        if ($redisId === '') {
            throw new InvalidArgumentException('redisId is required');
        }
    }
}
