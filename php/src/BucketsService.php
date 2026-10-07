<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Lists and deletes a project's object storage buckets.
 *
 * There is no single-bucket read; filter the list instead.
 * The API returns more fields than the shape below declares.
 *
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
