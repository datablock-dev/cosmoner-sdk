import pytest

from cosmoner import AsyncCosmoner, Cosmoner, CosmonerError, RateLimitError


class TestCosmoner:
    """Tests for client initialization."""

    def test_initializes_with_valid_params(self):
        client = Cosmoner(api_key="key-123", project_id="proj-1")
        assert client.api_key == "key-123"
        assert client.project_id == "proj-1"
        assert client.base_url == "https://api.cosmoner.com"

    def test_uses_custom_base_url(self):
        client = Cosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://custom.api.dev",
        )
        assert client.base_url == "https://custom.api.dev"

    def test_strips_trailing_slash_from_base_url(self):
        client = Cosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://custom.api.dev/",
        )
        assert client.base_url == "https://custom.api.dev"

    def test_raises_when_api_key_is_empty(self):
        with pytest.raises(ValueError, match="api_key is required"):
            Cosmoner(api_key="", project_id="proj-1")

    def test_raises_when_project_id_is_empty(self):
        with pytest.raises(ValueError, match="project_id is required"):
            Cosmoner(api_key="key-123", project_id="")

    def test_project_id_is_optional(self):
        client = Cosmoner(api_key="key-123")
        assert client.project_id is None

    def test_exposes_email_service(self):
        client = Cosmoner(api_key="key-123", project_id="proj-1")
        assert hasattr(client, "email")
        assert callable(client.email.send)

    def test_applies_default_timeout_and_retries(self):
        client = Cosmoner(api_key="key-123", project_id="proj-1")
        assert client.timeout == 30.0
        assert client.max_retries == 2

    def test_accepts_custom_timeout_and_retries(self):
        client = Cosmoner(
            api_key="key-123", project_id="proj-1", timeout=5.0, max_retries=0
        )
        assert client.timeout == 5.0
        assert client.max_retries == 0

    def test_rejects_non_positive_timeout(self):
        with pytest.raises(ValueError, match="timeout must be greater than 0"):
            Cosmoner(api_key="key-123", project_id="proj-1", timeout=0)

    def test_rejects_negative_retries(self):
        with pytest.raises(ValueError, match="max_retries cannot be negative"):
            Cosmoner(api_key="key-123", project_id="proj-1", max_retries=-1)

    def test_closes_via_context_manager(self):
        with Cosmoner(api_key="key-123", project_id="proj-1") as client:
            assert client.api_key == "key-123"


class TestAsyncCosmoner:
    """Tests for the async client, which mirrors the sync one."""

    def test_initializes_with_valid_params(self):
        client = AsyncCosmoner(api_key="key-123", project_id="proj-1")
        assert client.api_key == "key-123"
        assert client.project_id == "proj-1"
        assert client.base_url == "https://api.cosmoner.com"

    def test_exposes_email_service(self):
        client = AsyncCosmoner(api_key="key-123", project_id="proj-1")
        assert callable(client.email.send)

    def test_raises_when_api_key_is_empty(self):
        with pytest.raises(ValueError, match="api_key is required"):
            AsyncCosmoner(api_key="", project_id="proj-1")

    async def test_closes_via_async_context_manager(self):
        async with AsyncCosmoner(api_key="key-123", project_id="proj-1") as client:
            assert client.api_key == "key-123"


class TestCosmonerError:
    """Tests for the custom error class."""

    def test_stores_status_code_and_message(self):
        err = CosmonerError(status=422, code="VALIDATION_ERROR", message="Invalid input")
        assert err.status == 422
        assert err.code == "VALIDATION_ERROR"
        assert str(err) == "Invalid input"

    def test_is_instance_of_exception(self):
        err = CosmonerError(status=500, code="INTERNAL", message="fail")
        assert isinstance(err, Exception)

    def test_subclasses_remain_catchable_as_base_error(self):
        err = RateLimitError(429, "RATE_LIMITED", "slow down")
        assert isinstance(err, CosmonerError)
