import httpx
import pytest

from cosmoner import (
    AuthenticationError,
    Cosmoner,
    CosmonerConnectionError,
    CosmonerTimeoutError,
    InsufficientScopeError,
    NotFoundError,
    RateLimitError,
    ServerError,
    ValidationError,
)
from cosmoner._retry import RetryPolicy, parse_retry_after

URL = "https://api.test.dev/v1/projects/proj-1/email/send"


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    """Collapse retry backoff so the retry tests run instantly."""
    monkeypatch.setattr("cosmoner._transport.time.sleep", lambda _seconds: None)


def make_client(**overrides):
    """Build a client pointed at the mocked host."""
    params = {
        "api_key": "key-123",
        "project_id": "proj-1",
        "base_url": "https://api.test.dev",
    }
    params.update(overrides)
    return Cosmoner(**params)


def send(client):
    """Issue a representative POST through the transport."""
    return client.email.send(
        credential_id="cred-1", to="user@test.com", subject="Test", text="body"
    )


class TestRetryPolicy:
    """Unit tests for the retry decision logic."""

    def test_retries_429_even_for_writes(self):
        policy = RetryPolicy(max_retries=2)
        assert policy.should_retry(attempt=0, method="POST", status=429)

    def test_does_not_retry_5xx_for_writes_by_default(self):
        policy = RetryPolicy(max_retries=2)
        assert not policy.should_retry(attempt=0, method="POST", status=500)

    def test_retries_5xx_for_idempotent_methods(self):
        policy = RetryPolicy(max_retries=2)
        assert policy.should_retry(attempt=0, method="GET", status=500)

    def test_retries_writes_when_caller_opts_in(self):
        policy = RetryPolicy(max_retries=2)
        assert policy.should_retry(
            attempt=0, method="POST", status=500, retry_non_idempotent=True
        )

    def test_does_not_retry_transport_failure_for_writes(self):
        policy = RetryPolicy(max_retries=2)
        assert not policy.should_retry(attempt=0, method="POST", status=None)

    def test_does_not_retry_client_errors(self):
        policy = RetryPolicy(max_retries=2)
        assert not policy.should_retry(attempt=0, method="GET", status=404)

    def test_stops_at_max_retries(self):
        policy = RetryPolicy(max_retries=1)
        assert not policy.should_retry(attempt=1, method="GET", status=429)

    def test_disabled_when_max_retries_is_zero(self):
        policy = RetryPolicy(max_retries=0)
        assert not policy.should_retry(attempt=0, method="GET", status=429)

    def test_backoff_prefers_retry_after(self):
        policy = RetryPolicy(max_retries=2)
        assert policy.backoff_seconds(0, retry_after=3.0) == 3.0

    def test_backoff_is_capped(self):
        policy = RetryPolicy(max_retries=2)
        assert policy.backoff_seconds(0, retry_after=999.0) == 8.0

    def test_backoff_is_jittered_within_ceiling(self):
        policy = RetryPolicy(max_retries=5)
        assert 0 <= policy.backoff_seconds(2) <= 2.0

    def test_parse_retry_after_reads_seconds(self):
        assert parse_retry_after({"retry-after": "5"}) == 5.0

    def test_parse_retry_after_ignores_unparseable_values(self):
        assert parse_retry_after({"retry-after": "Wed, 21 Oct 2015 07:28:00 GMT"}) is None

    def test_parse_retry_after_returns_none_when_absent(self):
        assert parse_retry_after({}) is None


class TestTransportRetries:
    """Integration tests for retry behaviour against mocked HTTP."""

    def test_retries_429_then_succeeds(self, httpx_mock):
        httpx_mock.add_response(url=URL, status_code=429, json={})
        httpx_mock.add_response(url=URL, json={"success": True, "data": {}})

        result = send(make_client(max_retries=2))

        assert result == {"success": True, "data": {}}
        assert len(httpx_mock.get_requests()) == 2

    def test_gives_up_after_max_retries(self, httpx_mock):
        for _ in range(3):
            httpx_mock.add_response(url=URL, status_code=429, json={})

        with pytest.raises(RateLimitError):
            send(make_client(max_retries=2))

        assert len(httpx_mock.get_requests()) == 3

    def test_does_not_retry_a_failed_write(self, httpx_mock):
        httpx_mock.add_response(url=URL, status_code=500, json={})

        with pytest.raises(ServerError):
            send(make_client(max_retries=2))

        assert len(httpx_mock.get_requests()) == 1

    def test_reuses_one_idempotency_key_across_retries(self, httpx_mock):
        httpx_mock.add_response(url=URL, status_code=429, json={})
        httpx_mock.add_response(url=URL, json={"success": True, "data": {}})

        send(make_client(max_retries=2))

        keys = {r.headers["idempotency-key"] for r in httpx_mock.get_requests()}
        assert len(keys) == 1

    def test_maps_timeouts(self, httpx_mock):
        httpx_mock.add_exception(httpx.ReadTimeout("timed out"), url=URL)

        with pytest.raises(CosmonerTimeoutError):
            send(make_client(max_retries=0))

    def test_maps_connection_failures(self, httpx_mock):
        httpx_mock.add_exception(httpx.ConnectError("refused"), url=URL)

        with pytest.raises(CosmonerConnectionError):
            send(make_client(max_retries=0))


class TestErrorMapping:
    """Each status maps onto its specific exception subclass."""

    @pytest.mark.parametrize(
        ("status", "expected"),
        [
            (400, ValidationError),
            (401, AuthenticationError),
            (403, InsufficientScopeError),
            (404, NotFoundError),
            (422, ValidationError),
            (429, RateLimitError),
            (500, ServerError),
            (503, ServerError),
        ],
    )
    def test_maps_status_to_error_class(self, httpx_mock, status, expected):
        httpx_mock.add_response(url=URL, status_code=status, json={})

        with pytest.raises(expected):
            send(make_client(max_retries=0))

    def test_raises_on_non_json_success_response(self, httpx_mock):
        httpx_mock.add_response(url=URL, status_code=200, content=b"<html>oops</html>")

        with pytest.raises(Exception, match="non-JSON"):
            send(make_client(max_retries=0))
