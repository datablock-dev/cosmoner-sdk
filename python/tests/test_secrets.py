import json

import pytest

from cosmoner import AsyncCosmoner, ConflictError, Cosmoner

BASE = "https://api.test.dev/v1/projects/proj-1/secrets"

ACTOR = {"id": "user-1", "name": "Ada", "email": "ada@example.com"}

SECRET = {
    "id": "sec-1",
    "name": "DB_PASSWORD",
    "description": "Primary database",
    "environment": "production",
    "version": 1,
    "createdBy": "user-1",
    "updatedBy": "user-1",
    "createdByUser": ACTOR,
    "updatedByUser": ACTOR,
    "createdAt": "2026-09-01T12:00:00.000Z",
    "updatedAt": "2026-09-01T12:00:00.000Z",
}

REVEALED = {**SECRET, "value": "hunter2", "maskedValue": "hu••••r2"}

USAGE = {
    "used": 5,
    "limit": 5,
    "freeLimit": 5,
    "packSize": 5,
    "paidPacks": 0,
    "packPrice": {"monthly": 500, "currency": "EUR"},
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


class TestSecretsValidation:
    """Tests for client-side argument validation."""

    def test_requires_a_secret_id_on_get(self, client):
        with pytest.raises(ValueError, match="secret_id is required"):
            client.secrets.get("")

    def test_requires_a_secret_id_on_update(self, client):
        with pytest.raises(ValueError, match="secret_id is required"):
            client.secrets.update("", "x")

    def test_requires_a_secret_id_on_delete(self, client):
        with pytest.raises(ValueError, match="secret_id is required"):
            client.secrets.delete("")

    def test_requires_a_secret_id_on_audit(self, client):
        with pytest.raises(ValueError, match="secret_id is required"):
            client.secrets.audit("")

    def test_rejects_a_lowercase_name(self, client):
        with pytest.raises(ValueError, match="uppercase letters"):
            client.secrets.create("db_password", "hunter2")

    def test_rejects_a_name_that_does_not_start_with_a_letter(self, client):
        with pytest.raises(ValueError, match="uppercase letters"):
            client.secrets.create("1_PASSWORD", "hunter2")

    def test_rejects_an_empty_value(self, client):
        with pytest.raises(ValueError, match="value is required"):
            client.secrets.create("DB_PASSWORD", "")

    def test_rejects_a_value_past_the_api_limit(self, client):
        with pytest.raises(ValueError, match="at most 10000 characters"):
            client.secrets.create("DB_PASSWORD", "x" * 10_001)

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.secrets.list()


class TestSecrets:
    """Tests for the synchronous secrets namespace."""

    def test_lists_secrets_without_a_query_string_by_default(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [SECRET]})

        result = client.secrets.list()

        assert result["data"] == [SECRET]
        assert httpx_mock.get_request().url.query == b""

    def test_never_receives_a_value_on_a_list(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [SECRET]})

        result = client.secrets.list()

        assert "value" not in result["data"][0]

    def test_scopes_a_list_to_one_environment(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}?environment=staging", json={"success": True, "data": []}
        )

        client.secrets.list(environment="staging")

        assert httpx_mock.get_request().url.query == b"environment=staging"

    def test_creates_a_secret_and_hands_back_the_plaintext_once(self, client, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": REVEALED}
        )

        result = client.secrets.create("DB_PASSWORD", "hunter2", environment="production")

        assert result["data"]["value"] == "hunter2"
        assert result["data"]["maskedValue"] == "hu••••r2"
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {
            "name": "DB_PASSWORD",
            "value": "hunter2",
            "environment": "production",
        }

    def test_updates_a_secret_by_id(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/sec-1",
            json={"success": True, "data": {**REVEALED, "version": 2}},
        )

        result = client.secrets.update("sec-1", "hunter3")

        assert result["data"]["version"] == 2
        request = httpx_mock.get_request()
        assert request.method == "PATCH"
        assert json.loads(request.content) == {"value": "hunter3"}

    def test_deletes_a_secret_tolerating_the_empty_204(self, client, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/sec-1", status_code=204)

        assert client.secrets.delete("sec-1") is None
        assert httpx_mock.get_request().method == "DELETE"

    def test_reads_usage(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/usage", json={"success": True, "data": USAGE}
        )

        result = client.secrets.usage()

        assert result["data"]["used"] == 5

    def test_reads_an_audit_trail(self, client, httpx_mock):
        entry = {
            "id": "log-1",
            "secretId": "sec-1",
            "action": "CREATED",
            "actorId": "user-1",
            "actor": ACTOR,
            "metadata": None,
            "createdAt": "2026-09-01T12:00:00.000Z",
        }
        httpx_mock.add_response(
            url=f"{BASE}/sec-1/audit", json={"success": True, "data": [entry]}
        )

        result = client.secrets.audit("sec-1")

        assert result["data"][0]["action"] == "CREATED"

    def test_surfaces_a_duplicate_name_as_a_conflict(self, client, httpx_mock):
        httpx_mock.add_response(
            url=BASE,
            status_code=409,
            json={
                "success": False,
                "error": {"code": "CONFLICT", "message": "Secret already exists"},
            },
        )

        with pytest.raises(ConflictError):
            client.secrets.create("DB_PASSWORD", "hunter2")

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/secrets",
            json={"success": True, "data": []},
        )

        client.secrets.list(project_id="proj-2")


class TestAsyncSecrets:
    """Tests for the asynchronous secrets namespace."""

    async def test_lists_secrets(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [SECRET]})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.secrets.list()

        assert result["data"] == [SECRET]

    async def test_deletes_a_secret_tolerating_the_empty_204(self, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/sec-1", status_code=204)

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            assert await client.secrets.delete("sec-1") is None

    async def test_rejects_a_lowercase_name(self):
        async with AsyncCosmoner(
            api_key="key-123", project_id="proj-1", max_retries=0
        ) as client:
            with pytest.raises(ValueError, match="uppercase letters"):
                await client.secrets.create("db_password", "hunter2")
