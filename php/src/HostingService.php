<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Prices, creates, reads and deletes a project's shared hosting sites, and
 * manages the site image each one runs and whether it can send email.
 *
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-import-type CheckoutPreview from CatalogService
 * @phpstan-type HostingImageBuild array{
 *     phpVersion: string,
 *     tag: ?string,
 *     digest: ?string,
 *     ...
 * }
 * @phpstan-type HostingImageStatus array{
 *     current: HostingImageBuild,
 *     updatedAt: ?string,
 *     update: ?array{
 *         phpVersion: string,
 *         tag: string,
 *         digest: string,
 *         builtAt: ?string,
 *         critical: bool,
 *         knownExploited: bool,
 *         cves: list<string>,
 *         phpPatch: ?string,
 *         phpRelease: bool,
 *         ...
 *     },
 *     forcedUpdate: ?array{deadline: string, ...},
 *     rollback: ?array{phpVersion: string, tag: ?string, digest: ?string, until: string, ...},
 *     php: array{
 *         version: string,
 *         securitySupportEnds: ?string,
 *         deprecated: bool,
 *         offered: list<string>,
 *         ...
 *     },
 *     ...
 * }
 * @phpstan-type HostingMailStatus array{
 *     available: bool,
 *     enabled: bool,
 *     fromAddress: ?string,
 *     credentialId: ?string,
 *     emailDomainId: ?string,
 *     domains: list<array{id: string, name: string, ...}>,
 *     ...
 * }
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

    /**
     * Reads which build of the site image a site runs and what it can move to.
     *
     * `current` is the build it runs; `update` a newer patched build of its PHP
     * version, or null when it is up to date; `forcedUpdate` the deadline after
     * which a critical or known-exploited fix is applied automatically;
     * `rollback` the build it can return to until `until`; and `php.offered` the
     * versions `setPhpVersion()` accepts. A tag and digest are null only for a
     * site created before images were pinned that has not changed since.
     *
     * @return array{success: true, data: HostingImageStatus}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function image(string $siteId, ?string $projectId = null): array
    {
        self::requireSiteId($siteId);

        /** @var array{success: true, data: HostingImageStatus} */
        return $this->transport->request('GET', $this->basePath($projectId) . "/{$siteId}/image");
    }

    /**
     * Moves a site to the newest patched build of its PHP version.
     *
     * The site restarts before this returns, which interrupts it for a few
     * seconds; `rollbackImage()` restores the previous build for 7 days. A site
     * that already runs the newest build fails with `ConflictError`.
     *
     * @return array{success: true, data: HostingImageStatus} The status afterwards.
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function updateImage(string $siteId, ?string $projectId = null): array
    {
        self::requireSiteId($siteId);

        /** @var array{success: true, data: HostingImageStatus} */
        return $this->transport->request('POST', $this->basePath($projectId) . "/{$siteId}/image/update");
    }

    /**
     * Returns a site to the build it ran before its last change, PHP version included.
     *
     * Accepted until `rollback.until` in `image()`, 7 days after the change. The
     * site restarts before this returns. A rollback cannot itself be rolled back,
     * and rolling back a forced security update only postpones it.
     *
     * @return array{success: true, data: HostingImageStatus} The status afterwards.
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function rollbackImage(string $siteId, ?string $projectId = null): array
    {
        self::requireSiteId($siteId);

        /** @var array{success: true, data: HostingImageStatus} */
        return $this->transport->request('POST', $this->basePath($projectId) . "/{$siteId}/image/rollback");
    }

    /**
     * Moves a site to another PHP version, onto its newest patched build.
     *
     * The site restarts before this returns, and `rollbackImage()` restores the
     * previous version for 7 days.
     *
     * @param string $phpVersion One of `php.offered` from `image()`; the API owns that list.
     *
     * @return array{success: true, data: HostingImageStatus} The status afterwards.
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function setPhpVersion(string $siteId, string $phpVersion, ?string $projectId = null): array
    {
        self::requireSiteId($siteId);
        if ($phpVersion === '') {
            throw new InvalidArgumentException('phpVersion is required');
        }

        /** @var array{success: true, data: HostingImageStatus} */
        return $this->transport->request(
            'PATCH',
            $this->basePath($projectId) . "/{$siteId}/php-version",
            ['phpVersion' => $phpVersion],
        );
    }

    /**
     * Reads whether a site's PHP `mail()` sends, and as whom.
     *
     * `domains` lists the project's verified email domains it could send from.
     *
     * @return array{success: true, data: HostingMailStatus}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function mail(string $siteId, ?string $projectId = null): array
    {
        self::requireSiteId($siteId);

        /** @var array{success: true, data: HostingMailStatus} */
        return $this->transport->request('GET', $this->basePath($projectId) . "/{$siteId}/mail");
    }

    /**
     * Lets a site's PHP `mail()` send as `<localPart>@<domain>`.
     *
     * It sends through a new SMTP credential on the verified email domain, and
     * every email is billed on the project's email plan. Called again with
     * another address, it replaces the site's credential. Needs `email:write` as
     * well as `hosting:write`.
     *
     * @param array{emailDomainId: string, localPart: string} $params
     *     `emailDomainId` is one of `domains` from `mail()`; `localPart` is the
     *     part before the @, such as `wordpress`.
     *
     * @return array{success: true, data: HostingMailStatus} The status afterwards.
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function enableMail(string $siteId, array $params, ?string $projectId = null): array
    {
        self::requireSiteId($siteId);
        Params::check($params, ['emailDomainId', 'localPart'], ['emailDomainId', 'localPart']);

        /** @var array{success: true, data: HostingMailStatus} */
        return $this->transport->request(
            'PUT',
            $this->basePath($projectId) . "/{$siteId}/mail",
            ['emailDomainId' => $params['emailDomainId'], 'localPart' => $params['localPart']],
        );
    }

    /**
     * Stops a site sending email and deletes its SMTP credential.
     *
     * Afterwards `mail()` returns `false`. Needs `email:write` as well as
     * `hosting:write`.
     *
     * @return array{success: true, data: HostingMailStatus} The status afterwards.
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function disableMail(string $siteId, ?string $projectId = null): array
    {
        self::requireSiteId($siteId);

        /** @var array{success: true, data: HostingMailStatus} */
        return $this->transport->request('DELETE', $this->basePath($projectId) . "/{$siteId}/mail");
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
