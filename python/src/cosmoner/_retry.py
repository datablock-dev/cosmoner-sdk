"""Retry policy governing which failed requests are safe to send again."""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Mapping, Optional

# Methods the HTTP spec defines as idempotent: replaying one cannot create a
# second side effect, so they are safe to retry after a timeout or a 5xx.
IDEMPOTENT_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "PUT", "DELETE"})

BACKOFF_BASE_SECONDS = 0.5
BACKOFF_CAP_SECONDS = 8.0


@dataclass(frozen=True)
class RetryPolicy:
    """Decides whether a given failure should be retried, and how long to wait."""

    max_retries: int

    def should_retry(
        self,
        *,
        attempt: int,
        method: str,
        status: Optional[int],
        retry_non_idempotent: bool = False,
    ) -> bool:
        """
        Returns whether another attempt is warranted.

        A ``status`` of ``None`` means the request failed at the transport layer
        and never reached the API.

        429 is always retryable regardless of method: the request was rejected
        before it was processed, so replaying it cannot duplicate a side effect.
        Timeouts and 5xx are different — the API may well have completed the work
        before failing to answer, so those are only retried for idempotent
        methods, or when the caller opts in because the request carries an
        idempotency key the server honours.
        """
        if attempt >= self.max_retries:
            return False

        if status == 429:
            return True

        is_retryable_failure = status is None or status >= 500
        if not is_retryable_failure:
            return False

        return method.upper() in IDEMPOTENT_METHODS or retry_non_idempotent

    def backoff_seconds(self, attempt: int, retry_after: Optional[float] = None) -> float:
        """
        Returns the delay before the next attempt.

        A server-supplied ``Retry-After`` wins outright. Otherwise the delay is
        exponential with full jitter, which spreads a thundering herd of clients
        that all got rate limited in the same window.
        """
        if retry_after is not None and retry_after >= 0:
            return min(retry_after, BACKOFF_CAP_SECONDS)

        ceiling = min(BACKOFF_BASE_SECONDS * (2**attempt), BACKOFF_CAP_SECONDS)
        return random.uniform(0, ceiling)


def parse_retry_after(headers: Mapping[str, str]) -> Optional[float]:
    """
    Reads a ``Retry-After`` header expressed in seconds.

    The API does not currently send this header; it is honoured so the SDK
    starts respecting it the moment the platform adds it. The HTTP-date form is
    ignored deliberately — it is rare in practice and jittered backoff is a
    perfectly good fallback.
    """
    raw = headers.get("retry-after") or headers.get("Retry-After")
    if raw is None:
        return None

    try:
        return float(raw)
    except (TypeError, ValueError):
        return None
