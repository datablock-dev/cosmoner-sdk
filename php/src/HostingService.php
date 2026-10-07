<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Prices, creates, reads and deletes a project's shared hosting sites.
 *
 * @phpstan-import-type CheckoutPreview from CatalogService
 */
class HostingService
{
    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists every hosting site in the project that has not been deprovisioned.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: array<int, array<string, mixed>>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        /** @var array{success: true, data: array<int, array<string, mixed>>} */
        return $this->transport->request('GET', $this->basePath($projectId));
    }

    /**
     * Fetches one site, with its `sftpPassword` when `$credentials` is true.
     *
     * The password needs only the `hosting:read` scope, so guard the key accordingly.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function get(string $siteId, bool $credentials = false, ?string $projectId = null): array
    {
        self::requireSiteId($siteId);

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . "/{$siteId}",
            null,
            // http_build_query() would send a bare `true` as "1".
            $credentials ? ['credentials' => 'true'] : [],
        );
    }

    /**
     * Fetches the host, port and username for SFTP and SSH.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function access(string $siteId, ?string $projectId = null): array
    {
        self::requireSiteId($siteId);

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request('GET', $this->basePath($projectId) . "/{$siteId}/access");
    }

    /**
     * Lists the monthly price of each hosting tier, in minor units (cents for USD).
     *
     * @return array{success: true, data: list<array{tier: string, monthly: int, currency: string, ...}>}
     *
     * @throws CosmonerError On API errors.
     */
    public function prices(?string $projectId = null): array
    {
        /** @var array{success: true, data: list<array{tier: string, monthly: int, currency: string, ...}>} */
        return $this->transport->request('GET', $this->basePath($projectId) . '/prices');
    }

    /**
     * Quotes the price of a site on the given tier before it is created.
     *
     * Prices the monthly charge exactly. `dueToday` is an estimate for a project
     * that already has a subscription, because the real charge is prorated onto it.
     *
     * @param array{tier: string, extraStorageGb?: ?int} $params `tier` is one from
     *     `prices()`; `extraStorageGb` defaults to 0.
     *
     * @return array{success: true, data: CheckoutPreview}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function preview(array $params, ?string $projectId = null): array
    {
        Params::check($params, ['tier', 'extraStorageGb'], ['tier']);

        /** @var array{success: true, data: CheckoutPreview} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . '/preview',
            null,
            ['tier' => $params['tier'], 'extraStorageGb' => $params['extraStorageGb'] ?? 0],
        );
    }

    /**
     * Creates a hosting site, optionally with a MySQL database.
     *
     * Charges the project's saved card immediately (a prorated invoice). When the
     * project cannot be billed the API refuses with a 402 —
     * `ORG_PAYMENT_METHOD_REQUIRED`, `BILLER_PAYMENT_METHOD_REQUIRED` or
     * `PAYMENT_REQUIRED` — before anything is created.
     *
     * A database that cannot be created does not undo the site: the response
     * then carries `databaseError` instead of `database`.
     *
     * @param array{
     *     siteName: string,
     *     tier?: ?string,
     *     phpVersion?: ?string,
     *     database?: ?string,
     *     extraStorageGb?: ?int,
     * } $params `database` names a database to create with the site. Options
     *     left out take the API's defaults.
     *
     * @return array{success: true, data: array{
     *     tenantId: string,
     *     status: string,
     *     database?: array{id: string, name: string, status: 'PROVISIONING'|'ACTIVE'|'ERROR', ...},
     *     databaseError?: string,
     *     ...
     * }}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function create(array $params, ?string $projectId = null): array
    {
        Params::check(
            $params,
            ['siteName', 'tier', 'phpVersion', 'database', 'extraStorageGb'],
            ['siteName'],
        );

        $body = ['siteName' => $params['siteName']];
        foreach (['tier', 'phpVersion'] as $key) {
            if (isset($params[$key])) {
                $body[$key] = $params[$key];
            }
        }
        if (isset($params['database'])) {
            $body['database'] = ['name' => $params['database']];
        }
        if (isset($params['extraStorageGb'])) {
            $body['extraStorageGb'] = $params['extraStorageGb'];
        }

        /**
         * @var array{success: true, data: array{
         *     tenantId: string,
         *     status: string,
         *     database?: array{id: string, name: string, status: 'PROVISIONING'|'ACTIVE'|'ERROR', ...},
         *     databaseError?: string,
         *     ...
         * }}
         */
        return $this->transport->request('POST', $this->basePath($projectId), $body);
    }

    /**
     * Permanently deletes a hosting site.
     *
     * @return array{success: true, data: array{}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $siteId, ?string $projectId = null): array
    {
        self::requireSiteId($siteId);

        /** @var array{success: true, data: array{}} */
        return $this->transport->request('DELETE', $this->basePath($projectId) . "/{$siteId}");
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/hosting/shared';
    }

    /** Rejects an empty site id before it becomes a malformed route. */
    private static function requireSiteId(string $siteId): void
    {
        if ($siteId === '') {
            throw new InvalidArgumentException('siteId is required');
        }
    }
}
