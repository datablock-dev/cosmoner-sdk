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
