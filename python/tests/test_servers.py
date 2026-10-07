import pytest

from cosmoner import AsyncCosmoner, Cosmoner, NotFoundError

BASE = "https://api.test.dev/v1/projects/proj-1/servers"

SERVER = {
    "id": "srv-1",
    "name": "db",
    "type": "POSTGRES",
    "provider": "AWS",
    "region": "eu-north-1",
    "instanceType": "t3.small",
    "image": "ubuntu-24.04",
    "status": "RUNNING",
    "ipAddress": "203.0.113.10",
    "hostname": "db.cosmoner.dev",
    "phpVersion": None,
    "pgVersion": "16",
    "pgDatabase": "app",
    "pgUsername": "app",
    "sshUser": "ubuntu",
    "createdAt": "2026-09-01T12:00:00.000Z",
    "updatedAt": "2026-09-01T12:00:00.000Z",
}

SSH_KEYS = [{"id": "key-1", "name": "laptop", "fingerprint": "SHA256:abc"}]


@pytest.fixture()
def client():
    """Provide a Cosmoner client configured for testing, with retries disabled."""
    return Cosmoner(
        api_key="key-123",
        project_id="proj-1",
        base_url="https://api.test.dev",
        max_retries=0,
    )


class TestServersValidation:
    """Tests for client-side argument validation."""

    def test_requires_a_server_id_on_get(self, client):
        with pytest.raises(ValueError, match="server_id is required"):
            client.servers.get("")

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.servers.list()


class TestServers:
    """Tests for server reads via mocked HTTP."""

    def test_lists_servers(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [SERVER]})

        result = client.servers.list()

        assert result["data"] == [SERVER]
        assert httpx_mock.get_request().method == "GET"

    def test_fetches_a_server_with_its_ssh_keys(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/srv-1",
            json={"success": True, "data": {**SERVER, "sshKeys": SSH_KEYS}},
        )

        result = client.servers.get("srv-1")

        assert result["data"]["sshKeys"] == SSH_KEYS

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/servers/srv-1",
            json={"success": True, "data": SERVER},
        )

        client.servers.get("srv-1", project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_maps_a_404_onto_not_found_error(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/srv-missing",
            status_code=404,
            json={
                "success": False,
                "error": {"code": "NOT_FOUND", "message": "Server not found"},
            },
        )

        with pytest.raises(NotFoundError):
            client.servers.get("srv-missing")


class TestAsyncServers:
    """Tests for the async servers namespace."""

    async def test_lists_servers(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [SERVER]})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.servers.list()

        assert result["data"] == [SERVER]

    async def test_fetches_a_server(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/srv-1", json={"success": True, "data": SERVER}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.servers.get("srv-1")

        assert result["data"] == SERVER

    async def test_validates_the_server_id_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="server_id is required"):
                await client.servers.get("")


class TestServerDelete:
    """Tests for deleting a server via mocked HTTP."""

    def test_deletes_server_returning_the_envelope(self, client, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/srv-1", json={"success": True, "data": {}})

        assert client.servers.delete("srv-1") == {"success": True, "data": {}}
        assert httpx_mock.get_request().method == "DELETE"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/servers/srv-1",
            json={"success": True, "data": {}},
        )

        client.servers.delete("srv-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    def test_requires_server_id_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="server_id is required"):
            client.servers.delete("")

        assert httpx_mock.get_requests() == []


class TestAsyncServerDelete:
    """Tests for deleting a server through the async client."""

    async def test_deletes_server_returning_the_envelope(self, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/srv-1", json={"success": True, "data": {}})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            assert await client.servers.delete("srv-1") == {"success": True, "data": {}}

        assert httpx_mock.get_request().method == "DELETE"

    async def test_targets_another_project_per_call(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/servers/srv-1",
            json={"success": True, "data": {}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.servers.delete("srv-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    async def test_requires_server_id_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="server_id is required"):
                await client.servers.delete("")

        assert httpx_mock.get_requests() == []
