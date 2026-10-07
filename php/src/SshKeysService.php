<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/**
 * Read operations on a project's SSH keys.
 *
 * The API returns more fields than the shape below declares.
 *
 * @phpstan-type SshKey array{
 *     id: string,
 *     name: string,
 *     publicKey: string,
 *     fingerprint: string,
 *     createdAt: string,
 *     updatedAt: string,
 *     ...
 * }
 */
class SshKeysService
{
    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists every SSH key in the project.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: list<SshKey>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        $project = $this->config->resolveProjectId($projectId);

        /** @var array{success: true, data: list<SshKey>} */
        return $this->transport->request('GET', "/v1/projects/{$project}/ssh-keys");
    }
}
