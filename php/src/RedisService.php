<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Prices, creates, reads and deletes a project's Redis databases.
 *
 * Plans and regions to create one with come from `catalog`.
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-import-type CheckoutPreview from CatalogService
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
     * Quotes the price of a Redis database on the given plan before it is created.
     *
     * Prices the monthly charge exactly. `dueToday` is an estimate for a project
     * that already has a subscription, because the real charge is prorated onto it.
     *
     * @param string $plan A plan slug from `catalog->redisPlans()`.
     *
     * @return array{success: true, data: CheckoutPreview}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function preview(string $plan, ?string $projectId = null): array
    {
        if ($plan === '') {
            throw new InvalidArgumentException('plan is required');
        }

        /** @var array{success: true, data: CheckoutPreview} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . '/preview',
            null,
            ['planSlug' => $plan],
        );
    }

    /**
     * Creates a Redis database, which starts `CREATING`.
     *
     * Charges the project's saved card immediately (a prorated invoice). When the
     * project cannot be billed the API refuses with a 402 —
     * `ORG_PAYMENT_METHOD_REQUIRED`, `BILLER_PAYMENT_METHOD_REQUIRED` or
     * `PAYMENT_REQUIRED` — before anything is created.
     *
     * The response carries no id: `list()` and match by name to find the database.
     *
     * @param array{
     *     name: string,
     *     plan: string,
     *     region: string,
     *     persistence?: ?string,
     * } $params `plan` and `region` are slugs from `catalog`; `persistence` is one
     *     of `NONE`, `AOF_EVERY_WRITE`, `AOF_EVERY_1_SECOND`,
     *     `SNAPSHOT_EVERY_1_HOUR`, `SNAPSHOT_EVERY_6_HOURS` or
     *     `SNAPSHOT_EVERY_12_HOURS`.
     *
     * @return array{success: true, data: array{deployed: true}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function create(array $params, ?string $projectId = null): array
    {
        Params::check($params, ['name', 'plan', 'region', 'persistence'], ['name', 'plan', 'region']);

        $body = [
            'name' => $params['name'],
            'planSlug' => $params['plan'],
            'region' => $params['region'],
        ];
        if (isset($params['persistence'])) {
            $body['dataPersistence'] = $params['persistence'];
        }

        /** @var array{success: true, data: array{deployed: true}} */
        return $this->transport->request('POST', $this->basePath($projectId), $body);
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
