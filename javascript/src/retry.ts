/** Retry policy governing which failed requests are safe to send again. */

/**
 * Methods the HTTP spec defines as idempotent: replaying one cannot create a
 * second side effect, so they are safe to retry after a timeout or a 5xx.
 */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;

/** Inputs to a single retry decision. */
export interface RetryDecision {
  attempt: number;
  method: string;
  /** `null` when the request failed at the transport layer and never reached the API. */
  status: number | null;
  retryNonIdempotent?: boolean;
}

/**
 * Decides whether a failure should be retried.
 *
 * 429 is always retryable regardless of method: the request was rejected
 * before it was processed, so replaying it cannot duplicate a side effect.
 * Timeouts and 5xx are different — the API may well have completed the work
 * before failing to answer, so those are only retried for idempotent methods,
 * or when the caller opts in because the request carries an idempotency key
 * the server honours.
 */
export function shouldRetry(maxRetries: number, decision: RetryDecision): boolean {
  const { attempt, method, status, retryNonIdempotent = false } = decision;

  if (attempt >= maxRetries) return false;
  if (status === 429) return true;

  const isRetryableFailure = status === null || status >= 500;
  if (!isRetryableFailure) return false;

  return IDEMPOTENT_METHODS.has(method.toUpperCase()) || retryNonIdempotent;
}

/**
 * Returns the delay before the next attempt, in milliseconds.
 *
 * A server-supplied `Retry-After` wins outright. Otherwise the delay is
 * exponential with full jitter, which spreads a thundering herd of clients
 * that all got rate limited in the same window.
 */
export function backoffMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, BACKOFF_CAP_MS);
  }

  const ceiling = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
  return Math.random() * ceiling;
}

/**
 * Reads a `Retry-After` header expressed in seconds.
 *
 * The API does not currently send this header; it is honoured so the SDK
 * starts respecting it the moment the platform adds it. The HTTP-date form is
 * ignored deliberately — it is rare in practice and jittered backoff is a
 * perfectly good fallback.
 */
export function parseRetryAfter(headers?: Headers): number | undefined {
  const raw = headers?.get("retry-after");
  if (raw === null || raw === undefined) return undefined;

  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** Resolves after the given delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
