import json

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

PREVIEW = {
    "subtotal": 600,
    "tax": None,
    "creditApplied": 0,
    "dueToday": 600,
    "monthly": 600,
    "currency": "USD",
    "nextBillingDate": "2026-11-01T00:00:00.000Z",
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


class TestServerPreview:
    """Tests for pricing a server before creating it."""

    def test_sends_the_default_provider_and_size_as_slug(self, client, httpx_mock):
        envelope = {"success": True, "data": PREVIEW}
        httpx_mock.add_response(
            url=f"{BASE}/preview?provider=digitalocean&slug=s-1vcpu-1gb", json=envelope
        )

        result = client.servers.preview(size="s-1vcpu-1gb")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert request.url.query == b"provider=digitalocean&slug=s-1vcpu-1gb"

    def test_sends_a_given_provider_to_another_project(self, client, httpx_mock):
        httpx_mock.add_response(
            url=(
                "https://api.test.dev/v1/projects/proj-2/servers/preview"
                "?provider=hetzner&slug=cx22"
            ),
            json={"success": True, "data": PREVIEW},
        )

        client.servers.preview(size="cx22", provider="hetzner", project_id="proj-2")

        assert httpx_mock.get_request().url.query == b"provider=hetzner&slug=cx22"

    def test_requires_a_size_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="size is required"):
            client.servers.preview(size="")

        assert httpx_mock.get_requests() == []


class TestServerCreate:
    """Tests for creating a server via mocked HTTP."""

    def test_sends_only_the_required_fields_with_the_default_provider(
        self, client, httpx_mock
    ):
        envelope = {"success": True, "data": {"deployed": True}}
        httpx_mock.add_response(url=BASE, method="POST", json=envelope)

        result = client.servers.create(name="web", size="s-1vcpu-1gb", region="fra1")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {
            "name": "web",
            "slug": "s-1vcpu-1gb",
            "provider": "digitalocean",
            "region": "fra1",
        }

    def test_renames_the_optional_fields(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/servers",
            method="POST",
            json={"success": True, "data": {"deployed": True}},
        )

        client.servers.create(
            name="web",
            size="cx22",
            region="nbg1",
            image="wordpress",
            ssh_key_ids=("key-1", "key-2"),
            provider="hetzner",
            project_id="proj-2",
        )

        assert json.loads(httpx_mock.get_request().content) == {
            "name": "web",
            "slug": "cx22",
            "provider": "hetzner",
            "region": "nbg1",
            "template": "wordpress",
            "sshKeyIds": ["key-1", "key-2"],
        }

    @pytest.mark.parametrize(
        ("fields", "message"),
        [
            ({"name": "", "size": "s", "region": "r"}, "name is required"),
            ({"name": "n", "size": "", "region": "r"}, "size is required"),
            ({"name": "n", "size": "s", "region": ""}, "region is required"),
        ],
    )
    def test_requires_each_field_before_any_request(
        self, client, httpx_mock, fields, message
    ):
        with pytest.raises(ValueError, match=message):
            client.servers.create(**fields)

        assert httpx_mock.get_requests() == []


class TestAsyncServerCreate:
    """Tests for pricing and creating a server through the async client."""

    async def test_previews_a_server(self, httpx_mock):
        envelope = {"success": True, "data": PREVIEW}
        httpx_mock.add_response(
            url=f"{BASE}/preview?provider=digitalocean&slug=s-1vcpu-1gb", json=envelope
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            assert await client.servers.preview(size="s-1vcpu-1gb") == envelope

        assert (
            httpx_mock.get_request().url.query
            == b"provider=digitalocean&slug=s-1vcpu-1gb"
        )

    async def test_creates_a_server(self, httpx_mock):
        envelope = {"success": True, "data": {"deployed": True}}
        httpx_mock.add_response(url=BASE, method="POST", json=envelope)

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.servers.create(
                name="web", size="s-1vcpu-1gb", region="fra1", image="wordpress"
            )

        assert result == envelope
        assert json.loads(httpx_mock.get_request().content) == {
            "name": "web",
            "slug": "s-1vcpu-1gb",
            "provider": "digitalocean",
            "region": "fra1",
            "template": "wordpress",
        }

    async def test_requires_a_name_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="name is required"):
                await client.servers.create(name="", size="s", region="r")
            with pytest.raises(ValueError, match="size is required"):
                await client.servers.preview(size="")

        assert httpx_mock.get_requests() == []


POWER_ACTIONS = [
    ("power_on", "power_on"),
    ("power_off", "power_off"),
    ("reboot", "reboot"),
]


class TestServerUpdate:
    """Tests for renaming a server via mocked HTTP."""

    def test_renames_a_server_returning_the_envelope(self, client, httpx_mock):
        envelope = {"success": True, "data": {**SERVER, "name": "web-2"}}
        httpx_mock.add_response(url=f"{BASE}/srv-1", method="PATCH", json=envelope)

        result = client.servers.update("srv-1", name="web-2")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "PATCH"
        assert json.loads(request.content) == {"name": "web-2"}

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/servers/srv-1",
            method="PATCH",
            json={"success": True, "data": SERVER},
        )

        client.servers.update("srv-1", name="web-2", project_id="proj-2")

        assert httpx_mock.get_request().method == "PATCH"

    @pytest.mark.parametrize(
        ("server_id", "name", "message"),
        [
            ("", "web-2", "server_id is required"),
            ("srv-1", "", "name is required"),
        ],
    )
    def test_rejects_an_empty_argument_before_any_request(
        self, client, httpx_mock, server_id, name, message
    ):
        with pytest.raises(ValueError, match=message):
            client.servers.update(server_id, name=name)

        assert httpx_mock.get_requests() == []


class TestServerPowerActions:
    """Tests for powering a server on, off and rebooting it via mocked HTTP."""

    @pytest.mark.parametrize(("method", "action"), POWER_ACTIONS)
    def test_posts_the_action_returning_the_envelope(
        self, client, httpx_mock, method, action
    ):
        envelope = {"success": True, "data": {**SERVER, "status": "PROVISIONING"}}
        httpx_mock.add_response(url=f"{BASE}/srv-1/actions", method="POST", json=envelope)

        result = getattr(client.servers, method)("srv-1")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {"action": action}

    @pytest.mark.parametrize(("method", "action"), POWER_ACTIONS)
    def test_targets_another_project_per_call(self, client, httpx_mock, method, action):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/servers/srv-1/actions",
            method="POST",
            json={"success": True, "data": SERVER},
        )

        getattr(client.servers, method)("srv-1", project_id="proj-2")

        assert json.loads(httpx_mock.get_request().content) == {"action": action}

    @pytest.mark.parametrize(("method", "action"), POWER_ACTIONS)
    def test_requires_server_id_before_any_request(
        self, client, httpx_mock, method, action
    ):
        with pytest.raises(ValueError, match="server_id is required"):
            getattr(client.servers, method)("")

        assert httpx_mock.get_requests() == []


class TestAsyncServerLifecycle:
    """Tests for renaming and power actions through the async client."""

    async def test_renames_a_server(self, httpx_mock):
        envelope = {"success": True, "data": {**SERVER, "name": "web-2"}}
        httpx_mock.add_response(url=f"{BASE}/srv-1", method="PATCH", json=envelope)

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.servers.update("srv-1", name="web-2")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "PATCH"
        assert json.loads(request.content) == {"name": "web-2"}

    async def test_renames_in_another_project(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/servers/srv-1",
            method="PATCH",
            json={"success": True, "data": SERVER},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.servers.update("srv-1", name="web-2", project_id="proj-2")

        assert httpx_mock.get_request().method == "PATCH"

    @pytest.mark.parametrize(("method", "action"), POWER_ACTIONS)
    async def test_posts_the_action_returning_the_envelope(
        self, httpx_mock, method, action
    ):
        envelope = {"success": True, "data": {**SERVER, "status": "PROVISIONING"}}
        httpx_mock.add_response(url=f"{BASE}/srv-1/actions", method="POST", json=envelope)

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await getattr(client.servers, method)("srv-1")

        assert result == envelope
        assert json.loads(httpx_mock.get_request().content) == {"action": action}

    @pytest.mark.parametrize(("method", "action"), POWER_ACTIONS)
    async def test_targets_another_project_per_call(self, httpx_mock, method, action):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/servers/srv-1/actions",
            method="POST",
            json={"success": True, "data": SERVER},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await getattr(client.servers, method)("srv-1", project_id="proj-2")

        assert json.loads(httpx_mock.get_request().content) == {"action": action}

    async def test_rejects_empty_arguments_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="server_id is required"):
                await client.servers.update("", name="web-2")
            with pytest.raises(ValueError, match="name is required"):
                await client.servers.update("srv-1", name="")
            with pytest.raises(ValueError, match="server_id is required"):
                await client.servers.power_on("")
            with pytest.raises(ValueError, match="server_id is required"):
                await client.servers.power_off("")
            with pytest.raises(ValueError, match="server_id is required"):
                await client.servers.reboot("")

        assert httpx_mock.get_requests() == []
