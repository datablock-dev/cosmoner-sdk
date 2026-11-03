<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;
use stdClass;

/**
 * Email operations for a project.
 *
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-type EmailCredential array{
 *     id: string,
 *     label: ?string,
 *     fromAddress: ?string,
 *     smtpUsername: string,
 *     sentCount: int,
 *     lastUsedAt: ?string,
 *     ...
 * }
 * @phpstan-type NewEmailCredential array{
 *     id: string,
 *     label: string,
 *     fromAddress: string,
 *     smtpUsername: string,
 *     smtpPassword: string,
 *     sentCount: int,
 *     createdAt: string,
 *     ...
 * }
 * @phpstan-type EmailDnsRecord array{
 *     type: string,
 *     name: string,
 *     value: string,
 *     purpose: string,
 *     description: string,
 *     ...
 * }
 * @phpstan-type EmailDomain array{
 *     id: string,
 *     domainId: string,
 *     status: 'DNS_PENDING'|'ACTIVE'|'SUSPENDED',
 *     verifiedAt: ?string,
 *     domain: array{id: string, name: string, status: string, type: string, ...},
 *     credentials: list<EmailCredential>,
 *     dnsRecords: list<EmailDnsRecord>,
 *     createdAt: string,
 *     ...
 * }
 * @phpstan-type EmailDomainDetail array{
 *     id: string,
 *     domainId: string,
 *     status: 'DNS_PENDING'|'ACTIVE'|'SUSPENDED',
 *     verifiedAt: ?string,
 *     domain: array{id: string, name: string, status: string, type: string, ...},
 *     credentials: list<EmailCredential>,
 *     dnsRecords: list<EmailDnsRecord>,
 *     sending: array{identity: mixed, billingRequired: bool, ...},
 *     createdAt: string,
 *     ...
 * }
 * @phpstan-type EmailDomainVerification array{
 *     status: 'DNS_PENDING'|'ACTIVE'|'SUSPENDED',
 *     verifiedAt: ?string,
 *     records: list<array{
 *         type: string,
 *         name: string,
 *         value: string,
 *         purpose: string,
 *         description: string,
 *         verified: bool,
 *         error: ?string,
 *         ...
 *     }>,
 *     ...
 * }
 * @phpstan-type EmailLimits array{
 *     plan: 'PAY_AS_YOU_GO'|'STARTER'|'PRO'|'SCALE'|'BUSINESS',
 *     includedEmails: int,
 *     monthlyQuota: int,
 *     hourlyLimit: int,
 *     dailyLimit: int,
 *     sentThisMonth: int,
 *     sentLastDay: int,
 *     sentLastHour: int,
 *     periodStart: string,
 *     pausedUntil: ?string,
 *     pauseReason: 'HOURLY_LIMIT'|'DAILY_LIMIT'|'MONTHLY_QUOTA'|null,
 *     pendingRequest: ?array{id: string, requestedLimit: int, createdAt: string, ...},
 *     ...
 * }
 * @phpstan-type EmailTemplateRef array{
 *     id: string,
 *     version?: int,
 *     variables?: array<string, mixed>,
 * }
 * @phpstan-type SentEmail array{
 *     messageId: string,
 *     template?: array{id: string, alias: string, version: int},
 * }
 */
class EmailService
{
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Sends a transactional email and returns the API envelope with its message id.
     *
     * Pass either `$subject` with at least one of `$html` or `$text`, or a
     * `$template`, which supplies all three. A template send needs a key with
     * `email-templates:read` as well as `email:write`, and its response names
     * the version it rendered under `data.template`.
     *
     * @param string                $credentialId SMTP credential ID.
     * @param string|string[]       $to           Recipient(s), max 50.
     * @param string|null           $subject      Email subject line; required unless sending a template.
     * @param string|null           $html         HTML body (at least one of html/text required).
     * @param string|null           $text         Plain text body.
     * @param string|string[]|null  $replyTo      Reply-to address(es), max 5.
     * @param string|null           $projectId    Overrides the client-level default project.
     * @param EmailTemplateRef|null $template     A stored template to send: `id` is its id or
     *                                            alias, `version` a positive integer (the
     *                                            published one when left out), `variables`
     *                                            the values for what it declares.
     *
     * @return array{success: true, data: SentEmail}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function send(
        string $credentialId,
        string|array $to,
        ?string $subject = null,
        ?string $html = null,
        ?string $text = null,
        string|array|null $replyTo = null,
        ?string $projectId = null,
        ?array $template = null,
    ): array {
        $payload = [
            'credentialId' => $credentialId,
            'to' => $to,
        ];

        if ($template !== null) {
            foreach (['subject' => $subject, 'html' => $html, 'text' => $text] as $field => $value) {
                if ($value !== null) {
                    throw new InvalidArgumentException("Omit {$field} when sending a template");
                }
            }
            $payload['template'] = self::templatePayload($template);
        } else {
            if ($subject === null) {
                throw new InvalidArgumentException('subject is required');
            }
            if ($html === null && $text === null) {
                throw new InvalidArgumentException('Either html or text must be provided');
            }
            $payload['subject'] = $subject;
            if ($html !== null) {
                $payload['html'] = $html;
            }
            if ($text !== null) {
                $payload['text'] = $text;
            }
        }

        if ($replyTo !== null) {
            $payload['replyTo'] = $replyTo;
        }

        $project = $this->config->resolveProjectId($projectId);

        /** @var array{success: true, data: SentEmail} */
        return $this->transport->request('POST', "/v1/projects/{$project}/email/send", $payload);
    }

    /**
     * Lists the project's email domains with their SMTP credentials and DNS records.
     *
     * Credentials carry no passwords.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: list<EmailDomain>}
     *
     * @throws CosmonerError On API errors.
     */
    public function listDomains(?string $projectId = null): array
    {
        $project = $this->config->resolveProjectId($projectId);

        /** @var array{success: true, data: list<EmailDomain>} */
        return $this->transport->request('GET', "/v1/projects/{$project}/email");
    }

    /**
     * Fetches one email domain, adding its `sending` status to the list shape.
     *
     * `sending.billingRequired` is true while the organization cannot be billed
     * for sending; `sending.identity` is null when the status could not be read.
     *
     * @return array{success: true, data: EmailDomainDetail}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function getDomain(string $emailDomainId, ?string $projectId = null): array
    {
        self::requireEmailDomainId($emailDomainId);

        $project = $this->config->resolveProjectId($projectId);

        /** @var array{success: true, data: EmailDomainDetail} */
        return $this->transport->request('GET', "/v1/projects/{$project}/email/{$emailDomainId}");
    }

    /**
     * Sets up email on a domain already in the project (see `domains`).
     *
     * The domain starts `DNS_PENDING`: publish its `dnsRecords`, then call
     * `verifyDomain()`. Refused with a 409 when email is already set up on it.
     *
     * @param string $domainId The project domain's id, not its name.
     *
     * @return array{success: true, data: EmailDomain}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function createDomain(string $domainId, ?string $projectId = null): array
    {
        if ($domainId === '') {
            throw new InvalidArgumentException('domainId is required');
        }

        $project = $this->config->resolveProjectId($projectId);

        /** @var array{success: true, data: EmailDomain} */
        return $this->transport->request('POST', "/v1/projects/{$project}/email", ['domainId' => $domainId]);
    }

    /**
     * Sets up email on a domain whose DNS is managed elsewhere.
     *
     * Also adds the domain to the project as `PENDING`. Refused with a 409 when
     * the project already has the domain — use `createDomain()` for that — or the
     * name cannot be used here.
     *
     * @return array{success: true, data: EmailDomain}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function createExternalDomain(string $domainName, ?string $projectId = null): array
    {
        if ($domainName === '') {
            throw new InvalidArgumentException('domainName is required');
        }

        $project = $this->config->resolveProjectId($projectId);

        /** @var array{success: true, data: EmailDomain} */
        return $this->transport->request(
            'POST',
            "/v1/projects/{$project}/email/external",
            ['domainName' => $domainName],
        );
    }

    /**
     * Checks an email domain's DNS records and reports each one.
     *
     * When every record resolves the domain goes `ACTIVE`. The first activation
     * puts the project's email plan on its subscription, so it is refused with a
     * 402 when the project cannot be billed.
     *
     * @return array{success: true, data: EmailDomainVerification}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function verifyDomain(string $emailDomainId, ?string $projectId = null): array
    {
        self::requireEmailDomainId($emailDomainId);

        $project = $this->config->resolveProjectId($projectId);

        /** @var array{success: true, data: EmailDomainVerification} */
        return $this->transport->request('POST', "/v1/projects/{$project}/email/{$emailDomainId}/verify");
    }

    /**
     * Reads the project's email plan, sending limits and usage so far.
     *
     * `pausedUntil` and `pauseReason` are set while sending is paused for
     * hitting a limit; `pendingRequest` is a limit increase awaiting review.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: EmailLimits}
     *
     * @throws CosmonerError On API errors.
     */
    public function limits(?string $projectId = null): array
    {
        $project = $this->config->resolveProjectId($projectId);

        /** @var array{success: true, data: EmailLimits} */
        return $this->transport->request('GET', "/v1/projects/{$project}/email/limits");
    }

    /**
     * Permanently deletes an email domain. The API answers 204, so there is nothing to return.
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function deleteDomain(string $emailDomainId, ?string $projectId = null): void
    {
        self::requireEmailDomainId($emailDomainId);

        $project = $this->config->resolveProjectId($projectId);

        $this->transport->request('DELETE', "/v1/projects/{$project}/email/{$emailDomainId}");
    }

    /**
     * Creates an SMTP credential that sends from one address on an email domain.
     *
     * The response holds `smtpPassword` exactly once: the API keeps only a hash,
     * so store it now; it cannot be read again.
     *
     * @param array{label: string, fromAddress: string} $params
     *     `fromAddress` must be an address on the email domain.
     *
     * @return array{success: true, data: NewEmailCredential}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function createCredential(string $emailDomainId, array $params, ?string $projectId = null): array
    {
        self::requireEmailDomainId($emailDomainId);
        Params::check($params, ['label', 'fromAddress'], ['label', 'fromAddress']);

        $project = $this->config->resolveProjectId($projectId);

        /** @var array{success: true, data: NewEmailCredential} */
        return $this->transport->request(
            'POST',
            "/v1/projects/{$project}/email/{$emailDomainId}/credentials",
            ['label' => $params['label'], 'fromAddress' => $params['fromAddress']],
        );
    }

    /**
     * Permanently deletes an SMTP credential. The API answers 204, so there is nothing to return.
     *
     * Anything still sending with the credential stops working.
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function deleteCredential(string $emailDomainId, string $credentialId, ?string $projectId = null): void
    {
        self::requireEmailDomainId($emailDomainId);
        if ($credentialId === '') {
            throw new InvalidArgumentException('credentialId is required');
        }

        $project = $this->config->resolveProjectId($projectId);

        $this->transport->request(
            'DELETE',
            "/v1/projects/{$project}/email/{$emailDomainId}/credentials/{$credentialId}",
        );
    }

    /** Rejects an empty email domain id before it becomes a malformed route. */
    private static function requireEmailDomainId(string $emailDomainId): void
    {
        if ($emailDomainId === '') {
            throw new InvalidArgumentException('emailDomainId is required');
        }
    }

    /**
     * Checks a template reference and copies only the fields the API takes.
     *
     * @param array<string, mixed> $template
     *
     * @return array<string, mixed>
     *
     * @throws InvalidArgumentException On invalid input.
     */
    private static function templatePayload(array $template): array
    {
        Params::check($template, ['id', 'version', 'variables'], ['id'], 'template.');
        if (!is_string($template['id'])) {
            throw new InvalidArgumentException('template.id must be a string');
        }

        $ref = ['id' => $template['id']];
        $version = $template['version'] ?? null;
        if ($version !== null) {
            if (!is_int($version) || $version < 1) {
                throw new InvalidArgumentException('template.version must be a positive integer');
            }
            $ref['version'] = $version;
        }
        $variables = $template['variables'] ?? null;
        if ($variables !== null) {
            if (!is_array($variables)) {
                throw new InvalidArgumentException('template.variables must be an array');
            }
            // json_encode([]) emits "[]", which the API refuses as variables,
            // so an empty stdClass stands in for "{}".
            $ref['variables'] = $variables === [] ? new stdClass() : $variables;
        }

        return $ref;
    }
}
