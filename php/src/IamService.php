<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Creates, reads and deletes a project's IAM credentials.
 *
 * These reads return the access key id only; a secret access key is returned
 * by `create()` and by no read afterwards.
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
 * @phpstan-type IamStorageGrant array{access: string, bucketIds?: ?list<string>}
 * @phpstan-type IamRegistryGrant array{access: string, repositoryIds?: ?list<string>}
 * @phpstan-type NewIamCredential array{
 *     iamUserName: string,
 *     label: string,
 *     accessKeyId: string,
 *     secretAccessKey: string,
 *     createdAt: string,
 *     origin: 'project',
 *     storage: ?array{
 *         access: 'read'|'write',
 *         allBuckets: bool,
 *         buckets: list<array{bucketId: string, bucketName: string}>,
 *     },
 *     registry: ?array{
 *         access: 'pull'|'push',
 *         allRepositories: bool,
 *         repositories: list<array{repositoryId: string, repositoryName: string, registryId: string}>,
 *     },
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
        self::requireIamUserName($iamUserName);

        /** @var array{success: true, data: IamCredential} */
        return $this->transport->request('GET', $this->userPath($iamUserName, $projectId));
    }

    /**
     * Creates an access key for the project's object storage, container registry, or both.
     *
     * The response holds `secretAccessKey` exactly once: the API keeps no copy,
     * so store it now; it cannot be read again.
     *
     * @param array{label: string, storage?: ?IamStorageGrant, registry?: ?IamRegistryGrant} $params
     *     `label` is 1–20 characters. `storage.access` is `read` or `write`;
     *     `registry.access` is `pull` or `push`. At least one of `storage` and
     *     `registry` is required. Leaving out `bucketIds` or `repositoryIds`, or
     *     passing an empty list, grants every bucket or repository, including
     *     ones created later.
     *
     * @return array{success: true, data: NewIamCredential}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function create(array $params, ?string $projectId = null): array
    {
        Params::check($params, ['label', 'storage', 'registry'], ['label']);
        if (!isset($params['storage']) && !isset($params['registry'])) {
            throw new InvalidArgumentException('storage or registry is required');
        }

        $body = ['label' => $params['label']];
        if (isset($params['storage'])) {
            $body['storage'] = self::grant($params['storage'], 'storage', 'bucketIds');
        }
        if (isset($params['registry'])) {
            $body['registry'] = self::grant($params['registry'], 'registry', 'repositoryIds');
        }

        /** @var array{success: true, data: NewIamCredential} */
        return $this->transport->request('POST', $this->basePath($projectId), $body);
    }

    /**
     * Permanently deletes an IAM credential. The API answers 204, so there is nothing to return.
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $iamUserName, ?string $projectId = null): void
    {
        self::requireIamUserName($iamUserName);

        $this->transport->request('DELETE', $this->userPath($iamUserName, $projectId));
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/iam';
    }

    /** Builds one credential's route, URL-encoding the IAM user name. */
    private function userPath(string $iamUserName, ?string $projectId): string
    {
        return $this->basePath($projectId) . '/' . rawurlencode($iamUserName);
    }

    /**
     * Checks one half of a create and builds its body, sending the id list only when given.
     *
     * @param array<string, mixed> $grant
     *
     * @return array<string, mixed>
     *
     * @throws InvalidArgumentException On invalid input.
     */
    private static function grant(array $grant, string $name, string $idsKey): array
    {
        Params::check($grant, ['access', $idsKey], ['access'], "{$name}.");

        $body = ['access' => $grant['access']];
        if (isset($grant[$idsKey])) {
            $body[$idsKey] = $grant[$idsKey];
        }

        return $body;
    }

    /** Rejects an empty IAM user name before it becomes a malformed route. */
    private static function requireIamUserName(string $iamUserName): void
    {
        if ($iamUserName === '') {
            throw new InvalidArgumentException('iamUserName is required');
        }
    }
}
