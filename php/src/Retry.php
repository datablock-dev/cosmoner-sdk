<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/** Retry policy governing which failed requests are safe to send again. */
final class Retry
{
    /**
     * Methods the HTTP spec defines as idempotent: replaying one cannot create
     * a second side effect, so they are safe to retry after a timeout or a 5xx.
     */
    private const IDEMPOTENT_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'];

    private const BACKOFF_BASE_SECONDS = 0.5;
    private const BACKOFF_CAP_SECONDS = 8.0;

    public function __construct(private readonly int $maxRetries) {}

    /**
     * Decides whether a failure should be retried.
     *
     * A `$status` of null means the request failed at the transport layer and
     * never reached the API.
     *
     * 429 is always retryable regardless of method: the request was rejected
     * before it was processed, so replaying it cannot duplicate a side effect.
     * Timeouts and 5xx are different — the API may well have completed the work
     * before failing to answer, so those are only retried for idempotent
     * methods, or when the caller opts in because the request carries an
     * idempotency key the server honours.
     */
    public function shouldRetry(
        int $attempt,
        string $method,
        ?int $status,
        bool $retryNonIdempotent = false,
    ): bool {
        if ($attempt >= $this->maxRetries) {
            return false;
        }

        if ($status === 429) {
            return true;
        }

        $isRetryableFailure = $status === null || $status >= 500;
        if (!$isRetryableFailure) {
            return false;
        }

        return in_array(strtoupper($method), self::IDEMPOTENT_METHODS, true) || $retryNonIdempotent;
    }

    /**
     * Returns the delay before the next attempt, in seconds.
     *
     * A server-supplied `Retry-After` wins outright. Otherwise the delay is
     * exponential with full jitter, which spreads a thundering herd of clients
     * that all got rate limited in the same window.
     */
    public function backoffSeconds(int $attempt, ?float $retryAfter = null): float
    {
        if ($retryAfter !== null && $retryAfter >= 0) {
            return min($retryAfter, self::BACKOFF_CAP_SECONDS);
        }

        $ceiling = min(self::BACKOFF_BASE_SECONDS * (2 ** $attempt), self::BACKOFF_CAP_SECONDS);

        return (mt_rand() / mt_getrandmax()) * $ceiling;
    }

    /**
     * Reads a `Retry-After` header expressed in seconds.
     *
     * The API does not currently send this header; it is honoured so the SDK
     * starts respecting it the moment the platform adds it. The HTTP-date form
     * is ignored deliberately — it is rare in practice and jittered backoff is
     * a perfectly good fallback.
     *
     * @param array<string, string> $headers Lowercased response headers.
     */
    public static function parseRetryAfter(array $headers): ?float
    {
        $raw = $headers['retry-after'] ?? null;

        if ($raw === null || !is_numeric($raw)) {
            return null;
        }

        return (float) $raw;
    }
}
