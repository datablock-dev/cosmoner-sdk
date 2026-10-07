<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Reads, renames and deletes the projects the key can reach.
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
 * @phpstan-type UpdatedProject array{
 *     id: string,
 *     name: string,
 *     slug: string,
 *     billingEmail: ?string,
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
        self::requireProject($project);

        /** @var array{success: true, data: Project} */
        return $this->transport->request('GET', '/v1/projects/' . rawurlencode($project));
    }

    /**
     * Renames a project. Owners and admins only; anyone else gets a 403.
     *
     * Refused with a 409 when the caller already has a project of that name.
     *
     * @param string              $project Project id or slug; the client-level default is not used.
     * @param array{name: string} $params  `name` is 1–100 characters.
     *
     * @return array{success: true, data: UpdatedProject}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function update(string $project, array $params): array
    {
        self::requireProject($project);
        Params::check($params, ['name'], ['name']);

        /** @var array{success: true, data: UpdatedProject} */
        return $this->transport->request(
            'PATCH',
            '/v1/projects/' . rawurlencode($project),
            ['name' => $params['name']],
        );
    }

    /**
     * Permanently deletes a project. Owner only, and irreversible.
     *
     * Refused with a 409 while the project still holds resources (servers, apps,
     * databases, …): delete those first.
     *
     * @param string $project Project id or slug; the client-level default is not used.
     *
     * @return array{success: true, data: null}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $project): array
    {
        self::requireProject($project);

        /** @var array{success: true, data: null} */
        return $this->transport->request('DELETE', '/v1/projects/' . rawurlencode($project));
    }

    /** Rejects an empty project reference before it becomes a malformed route. */
    private static function requireProject(string $project): void
    {
        if ($project === '') {
            throw new InvalidArgumentException('project is required');
        }
    }
}
