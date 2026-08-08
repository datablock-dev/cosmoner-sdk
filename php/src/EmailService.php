<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/** Email operations for a project. */
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
}
