<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Read operations on a project's IAM credentials.
 *
 * These reads return the access key id only; a secret access key is returned
 * by the call that creates the credential and by no read afterwards.
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-type IamCredential array{
 *     iamUserName: string,
 *     label: ?string,
 *     accessKeyId: string,
 *     createdAt: ?string,
 *     origin: 'project'|'registry'|'bucket',
 *     registry: mixed,
 *     storage: mixed,
 *     ...
 * }
 */
class IamService
{
    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists every IAM credential in the project.
     *
     * Credentials come from several sources; one that cannot be read adds a
     * message to `errors` and the rest of the list is still returned.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: array{credentials: list<IamCredential>, errors: list<string>}}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        /** @var array{success: true, data: array{credentials: list<IamCredential>, errors: list<string>}} */
        return $this->transport->request('GET', $this->basePath($projectId));
    }

    /**
     * Fetches one IAM credential by its IAM user name.
     *
     * @return array{success: true, data: IamCredential}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function get(string $iamUserName, ?string $projectId = null): array
    {
        if ($iamUserName === '') {
            throw new InvalidArgumentException('iamUserName is required');
        }

        /** @var array{success: true, data: IamCredential} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . '/' . rawurlencode($iamUserName),
        );
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/iam';
    }
}
