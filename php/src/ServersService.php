<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Read operations on a project's servers.
 *
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-type Server array{
 *     id: string,
 *     name: string,
 *     type: 'LAMP'|'POSTGRES',
 *     provider: string,
 *     region: string,
 *     instanceType: string,
 *     image: ?string,
 *     status: 'PROVISIONING'|'RUNNING'|'STOPPED'|'ERROR'|'TERMINATED',
 *     ipAddress: ?string,
 *     hostname: ?string,
 *     phpVersion: ?string,
 *     pgVersion: ?string,
 *     pgDatabase: ?string,
 *     pgUsername: ?string,
 *     sshUser: ?string,
 *     createdAt: string,
 *     updatedAt: string,
 *     ...
 * }
 * @phpstan-type ServerSshKey array{id: string, name: string, fingerprint: string, ...}
 * @phpstan-type ServerDetail array{
 *     id: string,
 *     name: string,
 *     type: 'LAMP'|'POSTGRES',
 *     provider: string,
 *     region: string,
 *     instanceType: string,
 *     image: ?string,
 *     status: 'PROVISIONING'|'RUNNING'|'STOPPED'|'ERROR'|'TERMINATED',
 *     ipAddress: ?string,
 *     hostname: ?string,
 *     phpVersion: ?string,
 *     pgVersion: ?string,
 *     pgDatabase: ?string,
 *     pgUsername: ?string,
 *     sshUser: ?string,
 *     sshKeys: list<ServerSshKey>,
 *     createdAt: string,
 *     updatedAt: string,
 *     ...
 * }
 */
class ServersService
{
    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists every server in the project.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: list<Server>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        /** @var array{success: true, data: list<Server>} */
        return $this->transport->request('GET', $this->basePath($projectId));
    }

    /**
     * Fetches one server together with the SSH keys installed on it.
     *
     * @return array{success: true, data: ServerDetail}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function get(string $serverId, ?string $projectId = null): array
    {
        if ($serverId === '') {
            throw new InvalidArgumentException('serverId is required');
        }

        /** @var array{success: true, data: ServerDetail} */
        return $this->transport->request('GET', $this->basePath($projectId) . "/{$serverId}");
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/servers';
    }
}
