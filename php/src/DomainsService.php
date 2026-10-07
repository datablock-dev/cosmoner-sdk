<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Read operations on a project's domains and their DNS records.
 *
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-type DnsRecord array{
 *     id: string,
 *     type: string,
 *     name: string,
 *     value: string,
 *     ttl: int,
 *     priority: ?int,
 *     ...
 * }
 * @phpstan-type Domain array{
 *     id: string,
 *     name: string,
 *     type: 'PURCHASED'|'MIGRATED'|'EXTERNAL',
 *     status: string,
 *     registrar: ?string,
 *     expiresAt: ?string,
 *     autoRenew: bool,
 *     dnsRecords: list<DnsRecord>,
 *     verificationRecord: array{type: string, name: string, value: string}|null,
 *     createdAt: string,
 *     ...
 * }
 */
class DomainsService
{
    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists every domain in the project with its DNS records.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: list<Domain>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        /** @var array{success: true, data: list<Domain>} */
        return $this->transport->request('GET', $this->basePath($projectId));
    }

    /**
     * Fetches one domain by its id or its name, such as `example.com`.
     *
     * @return array{success: true, data: Domain}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function get(string $domain, ?string $projectId = null): array
    {
        if ($domain === '') {
            throw new InvalidArgumentException('domain is required');
        }

        /** @var array{success: true, data: Domain} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . '/' . rawurlencode($domain),
        );
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/domains';
    }
}
