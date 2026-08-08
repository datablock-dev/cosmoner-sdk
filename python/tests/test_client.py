import pytest

from cosmoner import Cosmoner, CosmonerError


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

    def test_exposes_email_service(self):
        client = Cosmoner(api_key="key-123", project_id="proj-1")
        assert hasattr(client, "email")
        assert callable(client.email.send)


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
