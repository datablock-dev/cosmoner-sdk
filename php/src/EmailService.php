<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

class EmailService
{
    public function __construct(private readonly Cosmoner $client) {}

    /**
     * @param string             $credentialId SMTP credential ID.
     * @param string|string[]    $to           Recipient(s), max 50.
     * @param string             $subject      Email subject line.
     * @param string|null        $html         HTML body (at least one of html/text required).
     * @param string|null        $text         Plain text body.
     * @param string|string[]|null $replyTo    Reply-to address(es), max 5.
     *
     * @return array{success: true, data: array{messageId: string}}
     *
     * @throws CosmonerError On API errors.
     * @throws \InvalidArgumentException On invalid input.
     */
    public function send(
        string $credentialId,
        string|array $to,
        string $subject,
        ?string $html = null,
        ?string $text = null,
        string|array|null $replyTo = null,
    ): array {
        if ($html === null && $text === null) {
            throw new \InvalidArgumentException('Either html or text must be provided');
        }

        $url = sprintf('%s/v1/projects/%s/email/send', $this->client->baseUrl, $this->client->projectId);

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

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->client->apiKey,
            ],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_THROW_ON_ERROR),
        ]);

        $response = curl_exec($ch);
        $statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);

        if ($response === false) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new CosmonerError(0, 'CURL_ERROR', 'Request failed: ' . $error);
        }

        curl_close($ch);

        $body = json_decode($response, true);

        if ($statusCode >= 400) {
            $error = $body['error'] ?? [];
            throw new CosmonerError(
                $statusCode,
                $error['code'] ?? 'UNKNOWN',
                $error['message'] ?? 'Unknown error',
            );
        }

        return $body;
    }
}
