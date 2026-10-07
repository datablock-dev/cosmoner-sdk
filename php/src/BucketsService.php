<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Prices, creates, lists and deletes a project's object storage buckets.
 *
 * There is no single-bucket read; filter the list instead.
 * The API returns more fields than the shape below declares.
 *
 * @phpstan-import-type CheckoutPreview from CatalogService
 * @phpstan-type Bucket array{
 *     id: string,
 *     name: string,
 *     provider: string,
 *     region: string,
 *     endpoint: ?string,
 *     publicAccess: bool,
 *     versioning: bool,
 *     status: string,
 *     tier: string,
 *     cdnEnabled: bool,
 *     cdnDomain: ?string,
 *     createdAt: string,
 *     ...
 * }
 */
class BucketsService
{
    /** The only storage provider buckets are created on. */
    public const PROVIDER = 'AWS_S3';

    /** The tier `preview()` quotes when none is given. */
    public const DEFAULT_TIER = 'STARTER';

    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists every object storage bucket in the project.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: list<Bucket>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        /** @var array{success: true, data: list<Bucket>} */
        return $this->transport->request('GET', $this->basePath($projectId));
    }

    /**
     * Quotes the price of a bucket on the given tier before it is created.
     *
     * Covers the tier fee only: CDN traffic is metered and not included.
     * Prices the monthly charge exactly. `dueToday` is an estimate for a project
     * that already has a subscription, because the real charge is prorated onto it.
     *
     * @param string|null $tier Defaults to `STARTER`.
     *
     * @return array{success: true, data: CheckoutPreview}
     *
     * @throws CosmonerError On API errors.
     */
    public function preview(?string $tier = null, ?string $projectId = null): array
    {
        /** @var array{success: true, data: CheckoutPreview} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . '/preview',
            null,
            ['provider' => self::PROVIDER, 'tier' => $tier ?? self::DEFAULT_TIER],
        );
    }

    /**
     * Creates a bucket. Names are unique per project.
     *
     * Charges the project's saved card immediately (a prorated invoice). When the
     * project cannot be billed the API refuses with a 402 —
     * `ORG_PAYMENT_METHOD_REQUIRED`, `BILLER_PAYMENT_METHOD_REQUIRED` or
     * `PAYMENT_REQUIRED` — before anything is created.
     *
     * @param array{
     *     name: string,
     *     region: string,
     *     tier?: ?string,
     *     publicAccess?: ?bool,
     *     versioning?: ?bool,
     *     cdnEnabled?: ?bool,
     * } $params Options left out take the API's defaults.
     *
     * @return array{success: true, data: array{deployed: true}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function create(array $params, ?string $projectId = null): array
    {
        Params::check(
            $params,
            ['name', 'region', 'tier', 'publicAccess', 'versioning', 'cdnEnabled'],
            ['name', 'region'],
        );

        $body = ['name' => $params['name'], 'provider' => self::PROVIDER, 'region' => $params['region']];
        foreach (['tier', 'publicAccess', 'versioning', 'cdnEnabled'] as $key) {
            if (isset($params[$key])) {
                $body[$key] = $params[$key];
            }
        }

        /** @var array{success: true, data: array{deployed: true}} */
        return $this->transport->request('POST', $this->basePath($projectId), $body);
    }

    /**
     * Permanently deletes a bucket, every object in it and its access credentials.
     *
     * @return array{success: true, data: array{}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $bucketId, ?string $projectId = null): array
    {
        if ($bucketId === '') {
            throw new InvalidArgumentException('bucketId is required');
        }

        /** @var array{success: true, data: array{}} */
        return $this->transport->request('DELETE', $this->basePath($projectId) . "/{$bucketId}");
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/storage/object-storage';
    }
}
