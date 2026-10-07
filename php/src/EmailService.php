<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

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
     * @param string               $credentialId SMTP credential ID.
     * @param string|string[]      $to           Recipient(s), max 50.
     * @param string               $subject      Email subject line.
     * @param string|null          $html         HTML body (at least one of html/text required).
     * @param string|null          $text         Plain text body.
     * @param string|string[]|null $replyTo      Reply-to address(es), max 5.
     * @param string|null          $projectId    Overrides the client-level default project.
     *
     * @return array{success: true, data: array{messageId: string}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function send(
        string $credentialId,
        string|array $to,
        string $subject,
        ?string $html = null,
        ?string $text = null,
        string|array|null $replyTo = null,
        ?string $projectId = null,
    ): array {
        if ($html === null && $text === null) {
            throw new InvalidArgumentException('Either html or text must be provided');
        }

        $payload = [
            'credentialId' => $credentialId,
            'to' => $to,
            'subject' => $subject,
        ];

        if ($html !== null) {
            $payload['html'] = $html;
        }
        if ($text !== null) {
            $payload['text'] = $text;
        }
        if ($replyTo !== null) {
            $payload['replyTo'] = $replyTo;
        }

        $project = $this->config->resolveProjectId($projectId);

        /** @var array{success: true, data: array{messageId: string}} */
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
}
