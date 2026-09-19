import pytest

from cosmoner import AsyncCosmoner, Cosmoner, NotFoundError

BASE = "https://api.test.dev/v1/projects/proj-1/hosting/shared"

SITE = {
    "id": "site-1",
    "siteName": "blog",
    "phpVersion": "8.3",
    "unixUser": "u_blog",
    "documentRoot": "/var/www/u_blog/blog.cosmoner.com/public_html",
    "internalHostname": "blog.cosmoner.com",
    "url": "https://blog.cosmoner.com",
    "tier": "shared-xs",
    "sshEnabled": False,
    "status": "ACTIVE",
    "sftpHost": "sftp.cosmoner.com",
    "sftpPort": 2222,
    "createdAt": "2026-09-01T12:00:00.000Z",
}

ACCESS = {
    "username": "u_blog",
    "host": "sftp.cosmoner.com",
    "sftp": {"port": 2222},
    "ssh": {"port": 2222, "enabled": False},
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


class TestHostingValidation:
    """Tests for client-side argument validation."""

    def test_requires_a_site_id_on_get(self, client):
        with pytest.raises(ValueError, match="site_id is required"):
            client.hosting.get("")

    def test_requires_a_site_id_on_access(self, client):
        with pytest.raises(ValueError, match="site_id is required"):
            client.hosting.access("")

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.hosting.list()


class TestHosting:
    """Tests for hosting site reads via mocked HTTP."""

    def test_lists_sites(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [SITE]})

        result = client.hosting.list()

        assert result["data"] == [SITE]
        assert httpx_mock.get_request().method == "GET"

    def test_fetches_a_site_without_a_query_string_by_default(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/site-1", json={"success": True, "data": {**SITE, "ready": True}}
        )

        result = client.hosting.get("site-1")

        assert result["data"]["ready"] is True
        assert httpx_mock.get_request().url.query == b""

    def test_asks_for_credentials_when_requested(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/site-1?credentials=true",
            json={
                "success": True,
                "data": {**SITE, "ready": True, "sftpPassword": "s3cret"},
            },
        )

        result = client.hosting.get("site-1", credentials=True)

        assert result["data"]["sftpPassword"] == "s3cret"

    def test_fetches_access_details(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/site-1/access", json={"success": True, "data": ACCESS}
        )

        result = client.hosting.access("site-1")

        assert result["data"] == ACCESS

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/hosting/shared",
            json={"success": True, "data": []},
        )

        client.hosting.list(project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_maps_a_404_onto_not_found_error(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/site-missing",
            status_code=404,
            json={
                "success": False,
                "error": {"code": "NOT_FOUND", "message": "Site not found"},
            },
        )

        with pytest.raises(NotFoundError):
            client.hosting.get("site-missing")


class TestAsyncHosting:
    """Tests for the async hosting namespace."""

    async def test_lists_sites(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [SITE]})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.hosting.list()

        assert result["data"] == [SITE]

    async def test_asks_for_credentials_when_requested(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/site-1?credentials=true",
            json={"success": True, "data": {**SITE, "sftpPassword": "s3cret"}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.hosting.get("site-1", credentials=True)

        assert result["data"]["sftpPassword"] == "s3cret"

    async def test_fetches_access_details(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/site-1/access", json={"success": True, "data": ACCESS}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.hosting.access("site-1")

        assert result["data"] == ACCESS

    async def test_validates_the_site_id_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="site_id is required"):
                await client.hosting.get("")
