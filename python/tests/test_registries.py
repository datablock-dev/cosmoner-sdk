import pytest

from cosmoner import AsyncCosmoner, Cosmoner, NotFoundError

BASE = "https://api.test.dev/v1/projects/proj-1/storage/container-registry"

REGISTRY = {
    "id": "reg-1",
    "name": "acme",
    "provider": "COSMONER",
    "region": "eu-north-1",
    "endpoint": "registry.cosmoner.com",
    "status": "ACTIVE",
    "namespaceName": "acme",
    "repositories": [
        {"id": "repo-1", "name": "web", "fullPath": "acme/web", "visibility": "PRIVATE"}
    ],
    "createdAt": "2026-09-01T12:00:00.000Z",
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


class TestRegistriesValidation:
    """Tests for client-side argument validation."""

    def test_requires_a_registry_id_on_get(self, client):
        with pytest.raises(ValueError, match="registry_id is required"):
            client.registries.get("")

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.registries.list()


class TestRegistries:
    """Tests for container registry reads via mocked HTTP."""

    def test_lists_registries(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [REGISTRY]})

        result = client.registries.list()

        assert result["data"] == [REGISTRY]
        assert httpx_mock.get_request().method == "GET"

    def test_fetches_a_registry(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/reg-1", json={"success": True, "data": REGISTRY}
        )

        result = client.registries.get("reg-1")

        assert result["data"]["repositories"][0]["fullPath"] == "acme/web"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/storage/container-registry/reg-1",
            json={"success": True, "data": REGISTRY},
        )

        client.registries.get("reg-1", project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_maps_a_404_onto_not_found_error(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/reg-missing",
            status_code=404,
            json={
                "success": False,
                "error": {"code": "NOT_FOUND", "message": "Registry not found"},
            },
        )

        with pytest.raises(NotFoundError):
            client.registries.get("reg-missing")


class TestAsyncRegistries:
    """Tests for the async registries namespace."""

    async def test_lists_registries(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [REGISTRY]})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.registries.list()

        assert result["data"] == [REGISTRY]

    async def test_fetches_a_registry(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/reg-1", json={"success": True, "data": REGISTRY}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.registries.get("reg-1")

        assert result["data"] == REGISTRY

    async def test_validates_the_registry_id_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="registry_id is required"):
                await client.registries.get("")
