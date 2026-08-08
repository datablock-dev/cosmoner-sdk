<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/**
 * Verification of the HMAC signature Cosmoner sends with every webhook.
 *
 * Static rather than injected: verification needs no client, no credentials
 * and no network, so a receiver can call it without constructing a Cosmoner.
 */
final class WebhookSignature
{
    /** Header carrying the timestamp and signature of the request body. */
    public const SIGNATURE_HEADER = 'x-cosmoner-signature';

    /** Header carrying the delivery id, so receivers can dedupe replays. */
    public const DELIVERY_ID_HEADER = 'x-cosmoner-delivery-id';

    /** Header carrying the event type, for routing without parsing the body. */
    public const EVENT_TYPE_HEADER = 'x-cosmoner-event';

    /** How old a signature may be before it is rejected as a replay. */
    public const DEFAULT_TOLERANCE_SECONDS = 300;

    /**
     * Recomputes the signature for a body and reports whether it matches.
     *
     * `$payload` must be the raw request body exactly as received — an array
     * re-encoded with `json_encode` will not verify, because key order and
     * whitespace are part of what was signed.
     *
     * Returns false for every failure mode (malformed header, stale timestamp,
     * wrong secret) so callers needing only a yes/no do not have to catch. Use
     * {@see self::constructEvent()} when the reason matters.
     *
     * @param string $payload           Raw request body.
     * @param string $signature         Value of the `x-cosmoner-signature` header.
     * @param string $secret            The endpoint's signing secret.
     * @param int    $toleranceSeconds  Replay window; pass 0 to skip the age check.
     */
    public static function verify(
        string $payload,
        string $signature,
        string $secret,
        int $toleranceSeconds = self::DEFAULT_TOLERANCE_SECONDS,
    ): bool {
        if ($signature === '' || $secret === '') {
            return false;
        }

        $parsed = self::parseHeader($signature);
        if ($parsed === null) {
            return false;
        }

        [$timestamp, $provided] = $parsed;

        if ($toleranceSeconds > 0) {
            $age = abs(time() - $timestamp);
            if ($age > $toleranceSeconds) {
                return false;
            }
        }

        $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);

        return hash_equals($expected, $provided);
    }

    /**
     * Verifies a received request and returns its decoded event envelope.
     *
     * Throws rather than returning false, so an unverified payload cannot be
     * used by accident: there is no value to read unless the signature held.
     *
     * @return array<string, mixed> The decoded `{id, type, createdAt, data}` envelope.
     *
     * @throws WebhookSignatureError When the signature is missing, malformed,
     *                               stale, wrong, or the body is not JSON.
     */
    public static function constructEvent(
        string $payload,
        string $signature,
        string $secret,
        int $toleranceSeconds = self::DEFAULT_TOLERANCE_SECONDS,
    ): array {
        if ($signature === '') {
            throw new WebhookSignatureError('Missing ' . self::SIGNATURE_HEADER . ' header');
        }
        if ($secret === '') {
            throw new WebhookSignatureError('Signing secret is required');
        }
        if (self::parseHeader($signature) === null) {
            throw new WebhookSignatureError(
                'Malformed ' . self::SIGNATURE_HEADER . ' header — expected "t=<seconds>,v1=<hex>"',
            );
        }
        if (!self::verify($payload, $signature, $secret, $toleranceSeconds)) {
            throw new WebhookSignatureError(
                'Webhook signature verification failed — the payload was not signed with this '
                . 'secret, or it is outside the replay window',
            );
        }

        $decoded = json_decode($payload, true);
        if (!is_array($decoded)) {
            throw new WebhookSignatureError('Webhook payload is not valid JSON');
        }

        /** @var array<string, mixed> */
        return $decoded;
    }

    /**
     * Splits `t=<unix seconds>,v1=<hex>` into its parts, or null if malformed.
     *
     * @return array{0: int, 1: string}|null
     */
    private static function parseHeader(string $header): ?array
    {
        $parts = [];
        foreach (explode(',', $header) as $segment) {
            $pieces = explode('=', $segment, 2);
            if (count($pieces) === 2) {
                $parts[trim($pieces[0])] = $pieces[1];
            }
        }

        $timestamp = $parts['t'] ?? null;
        $provided = $parts['v1'] ?? null;

        // A numeric check is required: PHP would otherwise cast "abc" to 0 and
        // silently compare against a signature timestamped at the epoch.
        if ($timestamp === null || $provided === null || $provided === '') {
            return null;
        }
        if (preg_match('/^-?\d+$/', $timestamp) !== 1) {
            return null;
        }

        return [(int) $timestamp, $provided];
    }
}
