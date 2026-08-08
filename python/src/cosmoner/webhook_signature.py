"""Verification of the HMAC signature Cosmoner sends with every webhook."""

from __future__ import annotations

import hmac
import json
import time
from hashlib import sha256
from typing import Any, NamedTuple

from .errors import WebhookSignatureError

#: Header carrying the timestamp and signature of the request body.
SIGNATURE_HEADER = "x-cosmoner-signature"
#: Header carrying the delivery id, so receivers can dedupe replays.
DELIVERY_ID_HEADER = "x-cosmoner-delivery-id"
#: Header carrying the event type, for routing without parsing the body.
EVENT_TYPE_HEADER = "x-cosmoner-event"

#: How old a signature may be before it is rejected as a replay.
DEFAULT_TOLERANCE_SECONDS = 300


class _ParsedSignature(NamedTuple):
    """The two fields carried by the signature header."""

    timestamp: int
    v1: str


def _parse_signature_header(header: str) -> _ParsedSignature | None:
    """Splits ``t=<unix seconds>,v1=<hex>`` into its parts, or None if malformed."""
    parts: dict[str, str] = {}
    for segment in header.split(","):
        key, separator, value = segment.partition("=")
        if separator:
            parts[key.strip()] = value

    raw_timestamp = parts.get("t")
    v1 = parts.get("v1")
    if not raw_timestamp or not v1:
        return None

    try:
        timestamp = int(raw_timestamp)
    except ValueError:
        return None

    return _ParsedSignature(timestamp, v1)


def _expected_digest(body: bytes, secret: str, timestamp: int) -> str:
    """Recomputes the hex digest the platform would have sent for this body."""
    signed = str(timestamp).encode("utf-8") + b"." + body
    return hmac.new(secret.encode("utf-8"), signed, sha256).hexdigest()


def _as_bytes(payload: str | bytes) -> bytes:
    """Normalizes a raw body to the bytes that were actually signed."""
    return payload.encode("utf-8") if isinstance(payload, str) else payload


def verify_webhook_signature(
    payload: str | bytes,
    signature: str,
    secret: str,
    *,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
) -> bool:
    """Recomputes the signature for a body and reports whether it matches.

    ``payload`` must be the raw request body exactly as received — a dict
    re-serialized with ``json.dumps`` will not verify, because key order and
    whitespace are part of what was signed.

    Returns False for every failure mode (malformed header, stale timestamp,
    wrong secret) so callers needing only a yes/no do not have to catch. Use
    :func:`construct_event` when the reason matters. Pass
    ``tolerance_seconds=0`` to skip the age check.
    """
    if not signature or not secret:
        return False

    parsed = _parse_signature_header(signature)
    if parsed is None:
        return False

    if tolerance_seconds > 0:
        age = abs(int(time.time()) - parsed.timestamp)
        if age > tolerance_seconds:
            return False

    expected = _expected_digest(_as_bytes(payload), secret, parsed.timestamp)
    return hmac.compare_digest(expected, parsed.v1)


def construct_event(
    payload: str | bytes,
    signature: str,
    secret: str,
    *,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
) -> dict[str, Any]:
    """Verifies a received request and returns its parsed event envelope.

    Raises :class:`~cosmoner.errors.WebhookSignatureError` rather than
    returning False, so an unverified payload cannot be used by accident:
    there is no value to read unless the signature held.
    """
    if not signature:
        raise WebhookSignatureError(f"Missing {SIGNATURE_HEADER} header")
    if not secret:
        raise WebhookSignatureError("Signing secret is required")
    if _parse_signature_header(signature) is None:
        raise WebhookSignatureError(
            f'Malformed {SIGNATURE_HEADER} header — expected "t=<seconds>,v1=<hex>"'
        )
    if not verify_webhook_signature(
        payload, signature, secret, tolerance_seconds=tolerance_seconds
    ):
        raise WebhookSignatureError(
            "Webhook signature verification failed — the payload was not signed "
            "with this secret, or it is outside the replay window"
        )

    try:
        event: dict[str, Any] = json.loads(_as_bytes(payload))
    except ValueError as exc:
        raise WebhookSignatureError("Webhook payload is not valid JSON") from exc

    return event
