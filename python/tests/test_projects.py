import json

import pytest

from cosmoner import AsyncCosmoner, Cosmoner, NotFoundError

BASE = "https://api.test.dev/v1/projects"

PROJECT = {
    "id": "proj-1",
    "name": "Acme",
    "slug": "acme",
    "billingEmail": "billing@acme.test",
    "blockedAt": None,
    "blockedReason": None,
    "_count": {
        "servers": 1,
        "domains": 2,
        "members": 3,
        "apps": 4,
        "objectStorages": 0,
        "containerRegistries": 1,
        "databaseClusters": 0,
    },
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


class TestProjectsValidation:
    """Tests for client-side argument validation."""

    def test_requires_a_project_on_get(self, client):
        with pytest.raises(ValueError, match="project is required"):
            client.projects.get("")


class TestProjects:
    """Tests for account-level project reads via mocked HTTP."""

    def test_lists_projects_without_the_client_default_project(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [PROJECT]})

        result = client.projects.list()

        assert result["data"] == [PROJECT]
        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert str(request.url) == BASE

    def test_fetches_a_project_by_slug_ignoring_the_client_default(
        self, client, httpx_mock
    ):
        httpx_mock.add_response(
            url=f"{BASE}/acme", json={"success": True, "data": PROJECT}
        )

        result = client.projects.get("acme")

        assert result["data"] == PROJECT
        assert str(httpx_mock.get_request().url) == f"{BASE}/acme"

    def test_works_on_a_client_without_a_default_project(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": []})
        scopeless = Cosmoner(
            api_key="key-123", base_url="https://api.test.dev", max_retries=0
        )

        result = scopeless.projects.list()

        assert result["data"] == []

    def test_maps_a_404_onto_not_found_error(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/missing",
            status_code=404,
            json={
                "success": False,
                "error": {"code": "NOT_FOUND", "message": "Project not found"},
            },
        )

        with pytest.raises(NotFoundError):
            client.projects.get("missing")


class TestAsyncProjects:
    """Tests for the async projects namespace."""

    async def test_lists_projects(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [PROJECT]})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.projects.list()

        assert result["data"] == [PROJECT]

    async def test_fetches_a_project(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/proj-9", json={"success": True, "data": PROJECT}
        )

        async with AsyncCosmoner(
            api_key="key-123", base_url="https://api.test.dev", max_retries=0
        ) as client:
            result = await client.projects.get("proj-9")

        assert result["data"] == PROJECT

    async def test_validates_the_project_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123", base_url="https://api.test.dev", max_retries=0
        ) as client:
            with pytest.raises(ValueError, match="project is required"):
                await client.projects.get("")


class TestProjectPathEncoding:
    """A project reference a person typed is encoded, not spliced into the path."""

    def test_encodes_the_project_reference(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/acme%20web", json={"success": True, "data": PROJECT}
        )

        client.projects.get("acme web")

        assert str(httpx_mock.get_request().url) == f"{BASE}/acme%20web"


UPDATED = {
    "id": "proj-9",
    "name": "Acme Web",
    "slug": "acme",
    "billingEmail": "billing@acme.test",
}


class TestProjectUpdate:
    """Tests for renaming a project via mocked HTTP."""

    def test_renames_the_named_project_ignoring_the_client_default(
        self, client, httpx_mock
    ):
        envelope = {"success": True, "data": UPDATED}
        httpx_mock.add_response(url=f"{BASE}/proj-9", method="PATCH", json=envelope)

        result = client.projects.update("proj-9", name="Acme Web")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "PATCH"
        assert str(request.url) == f"{BASE}/proj-9"
        assert json.loads(request.content) == {"name": "Acme Web"}

    def test_encodes_the_project_reference(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/acme%20web",
            method="PATCH",
            json={"success": True, "data": UPDATED},
        )

        client.projects.update("acme web", name="Acme Web")

        assert str(httpx_mock.get_request().url) == f"{BASE}/acme%20web"

    @pytest.mark.parametrize(
        ("project", "name", "message"),
        [
            ("", "Acme Web", "project is required"),
            ("proj-9", "", "name is required"),
        ],
    )
    def test_rejects_an_empty_argument_before_any_request(
        self, client, httpx_mock, project, name, message
    ):
        with pytest.raises(ValueError, match=message):
            client.projects.update(project, name=name)

        assert httpx_mock.get_requests() == []


class TestProjectDelete:
    """Tests for deleting a project via mocked HTTP."""

    def test_deletes_the_named_project_ignoring_the_client_default(
        self, client, httpx_mock
    ):
        envelope = {"success": True, "data": None}
        httpx_mock.add_response(url=f"{BASE}/proj-9", method="DELETE", json=envelope)

        assert client.projects.delete("proj-9") == envelope
        request = httpx_mock.get_request()
        assert request.method == "DELETE"
        assert str(request.url) == f"{BASE}/proj-9"

    def test_works_on_a_client_without_a_default_project(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/acme", method="DELETE", json={"success": True, "data": None}
        )
        scopeless = Cosmoner(
            api_key="key-123", base_url="https://api.test.dev", max_retries=0
        )

        scopeless.projects.delete("acme")

        assert httpx_mock.get_request().method == "DELETE"

    def test_requires_a_project_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="project is required"):
            client.projects.delete("")

        assert httpx_mock.get_requests() == []


class TestAsyncProjectWrites:
    """Tests for renaming and deleting a project through the async client."""

    async def test_renames_the_named_project_ignoring_the_client_default(
        self, httpx_mock
    ):
        envelope = {"success": True, "data": UPDATED}
        httpx_mock.add_response(url=f"{BASE}/proj-9", method="PATCH", json=envelope)

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.projects.update("proj-9", name="Acme Web")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "PATCH"
        assert json.loads(request.content) == {"name": "Acme Web"}

    async def test_deletes_the_named_project_ignoring_the_client_default(
        self, httpx_mock
    ):
        envelope = {"success": True, "data": None}
        httpx_mock.add_response(url=f"{BASE}/proj-9", method="DELETE", json=envelope)

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            assert await client.projects.delete("proj-9") == envelope

        assert httpx_mock.get_request().method == "DELETE"

    async def test_rejects_empty_arguments_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123", base_url="https://api.test.dev", max_retries=0
        ) as client:
            with pytest.raises(ValueError, match="project is required"):
                await client.projects.update("", name="Acme Web")
            with pytest.raises(ValueError, match="name is required"):
                await client.projects.update("proj-9", name="")
            with pytest.raises(ValueError, match="project is required"):
                await client.projects.delete("")

        assert httpx_mock.get_requests() == []
