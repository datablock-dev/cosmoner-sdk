<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Reads, adds, verifies and deletes a project's domains and their DNS records.
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
 * @phpstan-type VerificationRecord array{type: string, name: string, value: string}
 * @phpstan-type NewDomain array{
 *     id: string,
 *     name: string,
 *     type: 'EXTERNAL',
 *     status: string,
 *     verificationRecord: VerificationRecord,
 *     createdAt: string,
 *     ...
 * }
 * @phpstan-type DomainVerification array{
 *     status: 'ACTIVE'|'PENDING',
 *     verified: bool,
 *     record: mixed,
 *     error?: string,
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
        self::requireDomain($domain);

        /** @var array{success: true, data: Domain} */
        return $this->transport->request('GET', $this->domainPath($domain, $projectId));
    }

    /**
     * Adds a domain you already own, to be verified by a DNS TXT record.
     *
     * The domain is always added as `EXTERNAL`; buying one is not part of the
     * SDK. Publish the returned `verificationRecord` at your DNS provider, then
     * call `verify()`.
     *
     * @param string $name The domain name, such as `example.com`.
     *
     * @return array{success: true, data: NewDomain}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function create(string $name, ?string $projectId = null): array
    {
        if ($name === '') {
            throw new InvalidArgumentException('name is required');
        }

        /** @var array{success: true, data: NewDomain} */
        return $this->transport->request(
            'POST',
            $this->basePath($projectId),
            ['name' => $name, 'type' => 'EXTERNAL'],
        );
    }

    /**
     * Checks a domain's verification TXT record, by its id or its name.
     *
     * Answers with the domain's `status` (`ACTIVE` or `PENDING`), whether it
     * is `verified`, the `record` looked for, and an `error` when one occurred.
     *
     * @return array{success: true, data: DomainVerification}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function verify(string $domain, ?string $projectId = null): array
    {
        self::requireDomain($domain);

        /** @var array{success: true, data: DomainVerification} */
        return $this->transport->request('POST', $this->domainPath($domain, $projectId) . '/verify');
    }

    /**
     * Permanently removes a domain from the project, by its id or its name.
     *
     * The API refuses with a 409 while an app or an email domain still uses it.
     *
     * @return array{success: true, data: array{id: string}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $domain, ?string $projectId = null): array
    {
        self::requireDomain($domain);

        /** @var array{success: true, data: array{id: string}} */
        return $this->transport->request('DELETE', $this->domainPath($domain, $projectId));
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/domains';
    }

    /** Builds one domain's route, URL-encoding the id or name a person typed. */
    private function domainPath(string $domain, ?string $projectId): string
    {
        return $this->basePath($projectId) . '/' . rawurlencode($domain);
    }

    /** Rejects an empty domain reference before it becomes a malformed route. */
    private static function requireDomain(string $domain): void
    {
        if ($domain === '') {
            throw new InvalidArgumentException('domain is required');
        }
    }
}
