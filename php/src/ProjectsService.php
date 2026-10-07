<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Read operations on the projects the key can reach.
 *
 * Account-level: unlike every other namespace these routes are not scoped to a
 * project, so they ignore the client-level default project.
 *
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-type ProjectCounts array{
 *     servers: int,
 *     domains: int,
 *     members: int,
 *     apps: int,
 *     objectStorages: int,
 *     containerRegistries: int,
 *     databaseClusters: int,
 * }
 * @phpstan-type Project array{
 *     id: string,
 *     name: string,
 *     slug: string,
 *     billingEmail: ?string,
 *     blockedAt: ?string,
 *     blockedReason: ?string,
 *     _count: ProjectCounts,
 *     ...
 * }
 */
class ProjectsService
{
    /** Binds the namespace to the client's transport; no project is resolved here. */
    public function __construct(
        private readonly Transport $transport,
    ) {
    }

    /**
     * Lists every project the key can reach, with per-resource counts.
     *
     * @return array{success: true, data: list<Project>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(): array
    {
        /** @var array{success: true, data: list<Project>} */
        return $this->transport->request('GET', '/v1/projects');
    }

    /**
     * Fetches one project by id or slug.
     *
     * @param string $project Project id or slug; the client-level default is not used.
     *
     * @return array{success: true, data: Project}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function get(string $project): array
    {
        if ($project === '') {
            throw new InvalidArgumentException('project is required');
        }

        /** @var array{success: true, data: Project} */
        return $this->transport->request('GET', '/v1/projects/' . rawurlencode($project));
    }
}
