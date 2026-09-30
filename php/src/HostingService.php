<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/** Read operations on a project's shared hosting sites. */
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
