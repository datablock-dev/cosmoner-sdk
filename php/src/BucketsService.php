<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/**
 * Read operations on a project's object storage buckets.
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
        $project = $this->config->resolveProjectId($projectId);

        /** @var array{success: true, data: list<Bucket>} */
        return $this->transport->request('GET', "/v1/projects/{$project}/storage/object-storage");
    }
}
