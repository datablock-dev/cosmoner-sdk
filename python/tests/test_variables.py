import json

import pytest

from cosmoner import AsyncCosmoner, Cosmoner

BASE = "https://api.test.dev/v1/projects/proj-1/variables"

ACTOR = {"id": "user-1", "name": "Ada", "email": "ada@example.com"}

VARIABLE = {
    "id": "var-1",
    "name": "LOG_LEVEL",
    "description": "Verbosity",
    "value": "debug",
    "environment": "development",
    "createdBy": "user-1",
    "updatedBy": "user-1",
    "createdByUser": ACTOR,
    "updatedByUser": ACTOR,
    "createdAt": "2026-09-01T12:00:00.000Z",
    "updatedAt": "2026-09-01T12:00:00.000Z",
}


@pytest.fixture()
def client():
    """Provide a Cosmoner client configured for testing, with retries disabled."""
    return Cosmoner(
        api_key="key-123",
        project_id="proj-1",
        base_url="https://api.test.dev",
        max_retries=0,
    )


class TestVariablesValidation:
    """Tests for client-side argument validation."""

    def test_requires_a_variable_id_on_get(self, client):
        with pytest.raises(ValueError, match="variable_id is required"):
            client.variables.get("")

    def test_requires_a_variable_id_on_delete(self, client):
        with pytest.raises(ValueError, match="variable_id is required"):
            client.variables.delete("")

    def test_rejects_a_lowercase_name(self, client):
        with pytest.raises(ValueError, match="uppercase letters"):
            client.variables.create("log_level", "debug")

    def test_rejects_an_update_that_changes_nothing(self, client):
        with pytest.raises(ValueError, match="Provide a value or description"):
            client.variables.update("var-1")


class TestVariables:
    """Tests for the synchronous variables namespace."""

    def test_lists_variables_with_their_values(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [VARIABLE]})

        result = client.variables.list()

        assert result["data"][0]["value"] == "debug"
        assert httpx_mock.get_request().url.query == b""

    def test_scopes_a_list_to_one_environment(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}?environment=production", json={"success": True, "data": []}
        )

        client.variables.list(environment="production")

        assert httpx_mock.get_request().url.query == b"environment=production"

    def test_creates_a_variable(self, client, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": VARIABLE}
        )

        result = client.variables.create("LOG_LEVEL", "debug")

        assert result["data"]["name"] == "LOG_LEVEL"
        assert json.loads(httpx_mock.get_request().content) == {
            "name": "LOG_LEVEL",
            "value": "debug",
        }

    def test_updates_a_description_on_its_own(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/var-1", json={"success": True, "data": VARIABLE}
        )

        client.variables.update("var-1", description="How loud")

        request = httpx_mock.get_request()
        assert request.method == "PATCH"
        assert json.loads(request.content) == {"description": "How loud"}

    def test_deletes_a_variable_tolerating_the_empty_204(self, client, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/var-1", status_code=204)

        assert client.variables.delete("var-1") is None
        assert httpx_mock.get_request().method == "DELETE"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/variables",
            json={"success": True, "data": []},
        )

        client.variables.list(project_id="proj-2")


class TestAsyncVariables:
    """Tests for the asynchronous variables namespace."""

    async def test_lists_variables(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [VARIABLE]})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.variables.list()

        assert result["data"] == [VARIABLE]

    async def test_rejects_an_update_that_changes_nothing(self):
        async with AsyncCosmoner(
            api_key="key-123", project_id="proj-1", max_retries=0
        ) as client:
            with pytest.raises(ValueError, match="Provide a value or description"):
                await client.variables.update("var-1")
