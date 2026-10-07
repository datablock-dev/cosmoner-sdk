<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Reads and deletes a project's container registries.
 *
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-type Repository array{
 *     id: string,
 *     name: string,
 *     fullPath: string,
 *     visibility: string,
 *     ...
 * }
 * @phpstan-type Registry array{
 *     id: string,
 *     name: string,
 *     provider: string,
 *     region: string,
 *     endpoint: ?string,
 *     status: string,
 *     namespaceName: ?string,
 *     repositories: list<Repository>,
 *     createdAt: string,
 *     ...
 * }
 */
class RegistriesService
{
    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists every container registry in the project with its repositories.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: list<Registry>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        /** @var array{success: true, data: list<Registry>} */
        return $this->transport->request('GET', $this->basePath($projectId));
    }

    /**
     * Fetches one container registry with its repositories.
     *
     * @return array{success: true, data: Registry}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function get(string $registryId, ?string $projectId = null): array
    {
        self::requireRegistryId($registryId);

        /** @var array{success: true, data: Registry} */
        return $this->transport->request('GET', $this->basePath($projectId) . "/{$registryId}");
    }

    /**
     * Permanently deletes a container registry with every repository and image in it.
     *
     * @return array{success: true, data: array{}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $registryId, ?string $projectId = null): array
    {
        self::requireRegistryId($registryId);

        /** @var array{success: true, data: array{}} */
        return $this->transport->request('DELETE', $this->basePath($projectId) . "/{$registryId}");
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/storage/container-registry';
    }

    /** Rejects an empty registry id before it becomes a malformed route. */
    private static function requireRegistryId(string $registryId): void
    {
        if ($registryId === '') {
            throw new InvalidArgumentException('registryId is required');
        }
    }
}
