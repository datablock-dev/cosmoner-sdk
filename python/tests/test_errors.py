import pytest

from cosmoner import (
    AsyncCosmoner,
    Cosmoner,
    CosmonerError,
    InsufficientScopeError,
    RateLimitError,
)
from cosmoner.errors import error_from_response

APPS = "https://api.test.dev/v1/projects/proj-1/apps"

DOCS_URL = "https://cosmoner.com/docs#insufficient_scope"


def envelope(**extra):
    """An error envelope as the API sends it, with ``extra`` merged into ``error``."""
    return {
        "success": False,
        "error": {
            "code": "INSUFFICIENT_SCOPE",
            "message": "API key does not have apps:write permission",
            **extra,
        },
    }


class TestDocsUrl:
    """The ``docsUrl`` an error envelope may carry is exposed as ``docs_url``."""

    def test_exposes_the_link_when_the_api_sends_one(self):
        err = error_from_response(403, envelope(docsUrl=DOCS_URL))

        assert isinstance(err, InsufficientScopeError)
        assert err.docs_url == DOCS_URL

    def test_is_none_when_the_api_sends_none(self):
        assert error_from_response(403, envelope()).docs_url is None

    @pytest.mark.parametrize("value", [42, None, {"href": DOCS_URL}, [DOCS_URL]])
    def test_ignores_a_non_string_link(self, value):
        assert error_from_response(403, envelope(docsUrl=value)).docs_url is None

    def test_is_none_on_a_body_that_is_not_an_envelope(self):
        assert error_from_response(502, "<html>Bad gateway</html>").docs_url is None

    def test_carries_the_link_onto_a_rate_limit_error(self):
        err = error_from_response(429, envelope(code="RATE_LIMITED", docsUrl=DOCS_URL))

        assert isinstance(err, RateLimitError)
        assert err.docs_url == DOCS_URL

    def test_does_not_change_the_message(self):
        err = error_from_response(403, envelope(docsUrl=DOCS_URL))

        assert str(err) == "API key does not have apps:write permission"

    def test_defaults_to_none_on_a_hand_built_error(self):
        assert CosmonerError(500, "INTERNAL", "fail").docs_url is None

    def test_reaches_the_raised_error(self, httpx_mock):
        httpx_mock.add_response(
            url=APPS, status_code=403, json=envelope(docsUrl=DOCS_URL)
        )
        client = Cosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        )

        with pytest.raises(InsufficientScopeError) as caught:
            client.apps.list()

        assert caught.value.docs_url == DOCS_URL


class TestAsyncDocsUrl:
    """The async client raises the same link."""

    async def test_reaches_the_raised_error(self, httpx_mock):
        httpx_mock.add_response(
            url=APPS, status_code=403, json=envelope(docsUrl=DOCS_URL)
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(InsufficientScopeError) as caught:
                await client.apps.list()

        assert caught.value.docs_url == DOCS_URL
