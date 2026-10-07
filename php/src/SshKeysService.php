<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Lists, adds and deletes a project's SSH keys.
 *
 * The API returns more fields than the shapes below declare.
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
 * @phpstan-type NewSshKey array{
 *     id: string,
 *     name: string,
 *     publicKey: string,
 *     fingerprint: string,
 *     createdAt: string,
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
        /** @var array{success: true, data: list<SshKey>} */
        return $this->transport->request('GET', $this->basePath($projectId));
    }

    /**
     * Adds a public key to the project and returns it with its fingerprint.
     *
     * @param string $publicKey The public half only, such as `ssh-ed25519 AAAA… user@host`.
     *
     * @return array{success: true, data: NewSshKey}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function create(string $name, string $publicKey, ?string $projectId = null): array
    {
        if ($name === '') {
            throw new InvalidArgumentException('name is required');
        }
        if ($publicKey === '') {
            throw new InvalidArgumentException('publicKey is required');
        }

        /** @var array{success: true, data: NewSshKey} */
        return $this->transport->request(
            'POST',
            $this->basePath($projectId),
            ['name' => $name, 'publicKey' => $publicKey],
        );
    }

    /**
     * Permanently deletes an SSH key from the project.
     *
     * Deleting does not remove the key from servers it was already installed
     * on: it stays authorised there, and `stillAuthorisedOn` counts those
     * servers.
     *
     * @return array{success: true, data: array{stillAuthorisedOn: int}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $sshKeyId, ?string $projectId = null): array
    {
        if ($sshKeyId === '') {
            throw new InvalidArgumentException('sshKeyId is required');
        }

        /** @var array{success: true, data: array{stillAuthorisedOn: int}} */
        return $this->transport->request('DELETE', $this->basePath($projectId) . "/{$sshKeyId}");
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/ssh-keys';
    }
}
