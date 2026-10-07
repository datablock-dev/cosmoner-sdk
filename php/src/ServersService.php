<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Prices, creates, reads and deletes a project's servers.
 *
 * Sizes, regions and one-click images to create one with come from `catalog`.
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-import-type CheckoutPreview from CatalogService
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
    /** The provider `preview()` and `create()` use when none is given. */
    public const DEFAULT_PROVIDER = 'digitalocean';

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
        self::requireServerId($serverId);

        /** @var array{success: true, data: ServerDetail} */
        return $this->transport->request('GET', $this->basePath($projectId) . "/{$serverId}");
    }

    /**
     * Quotes the price of a server of the given size before it is created.
     *
     * Prices the monthly charge exactly. `dueToday` is an estimate for a project
     * that already has a subscription, because the real charge is prorated onto it.
     *
     * @param array{size: string, provider?: ?string} $params `size` is a slug from
     *     `catalog->serverSizes()`; `provider` defaults to `digitalocean`.
     *
     * @return array{success: true, data: CheckoutPreview}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function preview(array $params, ?string $projectId = null): array
    {
        Params::check($params, ['size', 'provider'], ['size']);

        /** @var array{success: true, data: CheckoutPreview} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . '/preview',
            null,
            ['provider' => $params['provider'] ?? self::DEFAULT_PROVIDER, 'slug' => $params['size']],
        );
    }

    /**
     * Creates a server, which starts `PROVISIONING`.
     *
     * Charges the project's saved card immediately (a prorated invoice). When the
     * project cannot be billed the API refuses with a 402 —
     * `ORG_PAYMENT_METHOD_REQUIRED`, `BILLER_PAYMENT_METHOD_REQUIRED` or
     * `PAYMENT_REQUIRED` — before anything is created.
     *
     * The response carries no id: `list()` and match by name to find the server.
     *
     * @param array{
     *     name: string,
     *     size: string,
     *     region: string,
     *     image?: ?string,
     *     sshKeyIds?: ?list<string>,
     *     provider?: ?string,
     * } $params `size` and `region` are slugs from `catalog`; `image` is a
     *     one-click image slug; `provider` defaults to `digitalocean`.
     *
     * @return array{success: true, data: array{deployed: true}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function create(array $params, ?string $projectId = null): array
    {
        Params::check(
            $params,
            ['name', 'size', 'region', 'image', 'sshKeyIds', 'provider'],
            ['name', 'size', 'region'],
        );

        $body = [
            'name' => $params['name'],
            'slug' => $params['size'],
            'provider' => $params['provider'] ?? self::DEFAULT_PROVIDER,
            'region' => $params['region'],
        ];
        if (isset($params['image'])) {
            $body['template'] = $params['image'];
        }
        if (isset($params['sshKeyIds'])) {
            $body['sshKeyIds'] = $params['sshKeyIds'];
        }

        /** @var array{success: true, data: array{deployed: true}} */
        return $this->transport->request('POST', $this->basePath($projectId), $body);
    }

    /**
     * Permanently deletes a server.
     *
     * @return array{success: true, data: array{}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $serverId, ?string $projectId = null): array
    {
        self::requireServerId($serverId);

        /** @var array{success: true, data: array{}} */
        return $this->transport->request('DELETE', $this->basePath($projectId) . "/{$serverId}");
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/servers';
    }

    /** Rejects an empty server id before it becomes a malformed route. */
    private static function requireServerId(string $serverId): void
    {
        if ($serverId === '') {
            throw new InvalidArgumentException('serverId is required');
        }
    }
}
