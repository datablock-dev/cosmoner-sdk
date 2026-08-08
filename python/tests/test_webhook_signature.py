import hashlib
import hmac
import json
import time

import pytest

from cosmoner import (
    DEFAULT_TOLERANCE_SECONDS,
    SIGNATURE_HEADER,
    WebhookSignatureError,
    construct_event,
    verify_webhook_signature,
)

SECRET = "whsec_0123456789abcdef"
BODY = json.dumps(
    {
        "id": "dlv_1",
        "type": "email.delivered",
        "createdAt": "2026-08-08T12:00:00.000Z",
        "data": {"messageId": "msg-1"},
    }
)


def sign(body, secret=SECRET, timestamp=None):
    """Build the header the platform would send for a body at a given time."""
    timestamp = int(time.time()) if timestamp is None else timestamp
    signed = f"{timestamp}.".encode() + (body.encode() if isinstance(body, str) else body)
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


class TestVerifyWebhookSignature:
    """Tests for the boolean verification helper."""

    def test_accepts_a_signature_from_the_same_secret(self):
        assert verify_webhook_signature(BODY, sign(BODY), SECRET) is True

    def test_accepts_a_raw_body_passed_as_bytes(self):
        payload = BODY.encode()
        assert verify_webhook_signature(payload, sign(payload), SECRET) is True

    def test_rejects_a_body_modified_after_signing(self):
        tampered = BODY.replace("msg-1", "msg-2")
        assert verify_webhook_signature(tampered, sign(BODY), SECRET) is False

    def test_rejects_a_signature_from_another_secret(self):
        assert verify_webhook_signature(BODY, sign(BODY, "whsec_theirs"), SECRET) is False

    def test_rejects_a_signature_older_than_the_tolerance(self):
        stale = int(time.time()) - (DEFAULT_TOLERANCE_SECONDS + 60)
        assert verify_webhook_signature(BODY, sign(BODY, SECRET, stale), SECRET) is False

    def test_rejects_a_timestamp_far_in_the_future(self):
        future = int(time.time()) + (DEFAULT_TOLERANCE_SECONDS + 60)
        assert verify_webhook_signature(BODY, sign(BODY, SECRET, future), SECRET) is False

    def test_accepts_a_stale_signature_when_the_age_check_is_disabled(self):
        stale = int(time.time()) - 86_400
        assert (
            verify_webhook_signature(
                BODY, sign(BODY, SECRET, stale), SECRET, tolerance_seconds=0
            )
            is True
        )

    def test_honours_a_custom_tolerance(self):
        stale = int(time.time()) - 100
        header = sign(BODY, SECRET, stale)

        assert (
            verify_webhook_signature(BODY, header, SECRET, tolerance_seconds=60) is False
        )
        assert (
            verify_webhook_signature(BODY, header, SECRET, tolerance_seconds=300) is True
        )

    @pytest.mark.parametrize(
        "header",
        ["", "t=1754654400", "v1=abc123", "t=not-a-number,v1=abc123", "just-a-digest"],
        ids=["empty", "missing-v1", "missing-timestamp", "non-numeric", "unstructured"],
    )
    def test_rejects_malformed_headers(self, header):
        assert verify_webhook_signature(BODY, header, SECRET) is False

    def test_rejects_a_digest_of_the_wrong_length(self):
        header = f"t={int(time.time())},v1=deadbeef"
        assert verify_webhook_signature(BODY, header, SECRET) is False

    def test_rejects_an_empty_secret(self):
        assert verify_webhook_signature(BODY, sign(BODY), "") is False

    def test_accepts_a_signature_exactly_at_the_tolerance_boundary(self):
        boundary = int(time.time()) - DEFAULT_TOLERANCE_SECONDS
        assert (
            verify_webhook_signature(BODY, sign(BODY, SECRET, boundary), SECRET) is True
        )


class TestConstructEvent:
    """Tests for the raising variant that returns the parsed envelope."""

    def test_returns_the_parsed_envelope(self):
        event = construct_event(BODY, sign(BODY), SECRET)

        assert event == {
            "id": "dlv_1",
            "type": "email.delivered",
            "createdAt": "2026-08-08T12:00:00.000Z",
            "data": {"messageId": "msg-1"},
        }

    def test_raises_when_the_signature_does_not_match(self):
        with pytest.raises(WebhookSignatureError):
            construct_event(BODY, sign("something else"), SECRET)

    def test_names_the_header_when_it_is_missing(self):
        with pytest.raises(WebhookSignatureError, match=SIGNATURE_HEADER):
            construct_event(BODY, "", SECRET)

    def test_distinguishes_a_malformed_header_from_a_failed_comparison(self):
        with pytest.raises(WebhookSignatureError, match="Malformed"):
            construct_event(BODY, "garbage", SECRET)

    def test_raises_when_the_secret_is_missing(self):
        with pytest.raises(WebhookSignatureError, match="Signing secret is required"):
            construct_event(BODY, sign(BODY), "")

    def test_raises_when_a_signed_body_is_not_json(self):
        not_json = "this is signed but not json"

        with pytest.raises(WebhookSignatureError, match="not valid JSON"):
            construct_event(not_json, sign(not_json), SECRET)

    def test_carries_the_sdk_error_code(self):
        with pytest.raises(WebhookSignatureError) as excinfo:
            construct_event(BODY, "garbage", SECRET)

        assert excinfo.value.code == "WEBHOOK_SIGNATURE_INVALID"
