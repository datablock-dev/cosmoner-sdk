import json

import pytest

from cosmoner import AsyncCosmoner, Cosmoner

BASE = "https://api.test.dev/v1/projects/proj-1/ssh-keys"

KEYS = [
    {
        "id": "key-1",
        "name": "laptop",
        "publicKey": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA laptop",
        "fingerprint": "SHA256:abc",
        "createdAt": "2026-09-01T12:00:00.000Z",
        "updatedAt": "2026-09-01T12:00:00.000Z",
    }
]


@pytest.fixture()
def client():
    """Provide a Cosmoner client configured for testing, with retries disabled."""
    return Cosmoner(
        api_key="key-123",
        project_id="proj-1",
        base_url="https://api.test.dev",
        max_retries=0,
    )


class TestSshKeysValidation:
    """Tests for client-side argument validation."""

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.ssh_keys.list()


class TestSshKeys:
    """Tests for SSH key reads via mocked HTTP."""

    def test_lists_ssh_keys(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": KEYS})

        result = client.ssh_keys.list()

        assert result["data"] == KEYS
        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert request.url.query == b""

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/ssh-keys",
            json={"success": True, "data": KEYS},
        )

        client.ssh_keys.list(project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)


class TestAsyncSshKeys:
    """Tests for the async SSH key namespace."""

    async def test_lists_ssh_keys(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": KEYS})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.ssh_keys.list()

        assert result["data"] == KEYS

    async def test_targets_another_project_per_call(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/ssh-keys",
            json={"success": True, "data": KEYS},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.ssh_keys.list(project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)


PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA laptop"

CREATED = {
    "id": "key-2",
    "name": "laptop",
    "publicKey": PUBLIC_KEY,
    "fingerprint": "SHA256:abc",
    "createdAt": "2026-09-01T12:00:00.000Z",
}


class TestSshKeyWrites:
    """Tests for adding and deleting SSH keys via mocked HTTP."""

    def test_adds_a_key(self, client, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": CREATED}
        )

        result = client.ssh_keys.create(name="laptop", public_key=PUBLIC_KEY)

        assert result == {"success": True, "data": CREATED}
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {"name": "laptop", "publicKey": PUBLIC_KEY}

    def test_adds_a_key_to_another_project(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/ssh-keys",
            status_code=201,
            json={"success": True, "data": CREATED},
        )

        client.ssh_keys.create(name="laptop", public_key=PUBLIC_KEY, project_id="proj-2")

        assert httpx_mock.get_request().method == "POST"

    @pytest.mark.parametrize(
        ("name", "public_key", "message"),
        [("", PUBLIC_KEY, "name is required"), ("laptop", "", "public_key is required")],
    )
    def test_rejects_an_empty_argument_before_any_request(
        self, client, httpx_mock, name, public_key, message
    ):
        with pytest.raises(ValueError, match=message):
            client.ssh_keys.create(name=name, public_key=public_key)

        assert httpx_mock.get_requests() == []

    def test_deletes_a_key_reporting_servers_that_still_accept_it(
        self, client, httpx_mock
    ):
        httpx_mock.add_response(
            url=f"{BASE}/key-1", json={"success": True, "data": {"stillAuthorisedOn": 2}}
        )

        result = client.ssh_keys.delete("key-1")

        assert result == {"success": True, "data": {"stillAuthorisedOn": 2}}
        assert httpx_mock.get_request().method == "DELETE"

    def test_deletes_from_another_project(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/ssh-keys/key-1",
            json={"success": True, "data": {"stillAuthorisedOn": 0}},
        )

        client.ssh_keys.delete("key-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    def test_requires_an_ssh_key_id_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="ssh_key_id is required"):
            client.ssh_keys.delete("")

        assert httpx_mock.get_requests() == []


class TestAsyncSshKeyWrites:
    """Tests for adding and deleting SSH keys through the async client."""

    async def test_adds_a_key(self, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": CREATED}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.ssh_keys.create(name="laptop", public_key=PUBLIC_KEY)

        assert result == {"success": True, "data": CREATED}
        assert json.loads(httpx_mock.get_request().content) == {
            "name": "laptop",
            "publicKey": PUBLIC_KEY,
        }

    async def test_deletes_a_key_in_another_project(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/ssh-keys/key-1",
            json={"success": True, "data": {"stillAuthorisedOn": 1}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.ssh_keys.delete("key-1", project_id="proj-2")

        assert result == {"success": True, "data": {"stillAuthorisedOn": 1}}
        assert httpx_mock.get_request().method == "DELETE"

    async def test_rejects_empty_arguments_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="name is required"):
                await client.ssh_keys.create(name="", public_key=PUBLIC_KEY)
            with pytest.raises(ValueError, match="public_key is required"):
                await client.ssh_keys.create(name="laptop", public_key="")
            with pytest.raises(ValueError, match="ssh_key_id is required"):
                await client.ssh_keys.delete("")

        assert httpx_mock.get_requests() == []


PRIVATE_KEY = (
    "-----BEGIN RSA PRIVATE KEY-----\nMIIJKQIBAAKCAgEA\n-----END RSA PRIVATE KEY-----\n"
)

GENERATED = {
    "id": "key-3",
    "name": "deploy",
    "publicKey": "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQ deploy",
    "fingerprint": "SHA256:def",
    "createdAt": "2026-09-01T12:00:00.000Z",
    "updatedAt": "2026-09-01T12:00:00.000Z",
    "privateKey": PRIVATE_KEY,
}


class TestSshKeyGenerate:
    """Tests for generating an SSH key pair via mocked HTTP."""

    def test_generates_a_key_returning_the_private_half_once(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/generate",
            status_code=201,
            json={"success": True, "data": GENERATED},
        )

        result = client.ssh_keys.generate(name="deploy")

        assert result == {"success": True, "data": GENERATED}
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {"name": "deploy"}

    def test_generates_in_another_project(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/ssh-keys/generate",
            status_code=201,
            json={"success": True, "data": GENERATED},
        )

        client.ssh_keys.generate(name="deploy", project_id="proj-2")

        assert httpx_mock.get_request().method == "POST"

    def test_requires_a_name_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="name is required"):
            client.ssh_keys.generate(name="")

        assert httpx_mock.get_requests() == []


class TestAsyncSshKeyGenerate:
    """Tests for generating an SSH key pair through the async client."""

    async def test_generates_a_key_returning_the_private_half_once(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/generate",
            status_code=201,
            json={"success": True, "data": GENERATED},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.ssh_keys.generate(name="deploy")

        assert result == {"success": True, "data": GENERATED}
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {"name": "deploy"}

    async def test_generates_in_another_project(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/ssh-keys/generate",
            status_code=201,
            json={"success": True, "data": GENERATED},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.ssh_keys.generate(name="deploy", project_id="proj-2")

        assert httpx_mock.get_request().method == "POST"

    async def test_requires_a_name_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="name is required"):
                await client.ssh_keys.generate(name="")

        assert httpx_mock.get_requests() == []
