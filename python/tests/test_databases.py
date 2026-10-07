import json

import pytest

from cosmoner import AsyncCosmoner, Cosmoner, NotFoundError

BASE = "https://api.test.dev/v1/projects/proj-1/databases"

PREVIEW = {
    "subtotal": 1000,
    "tax": None,
    "creditApplied": 0,
    "dueToday": 1000,
    "monthly": 1000,
    "currency": "USD",
    "nextBillingDate": "2026-11-01T00:00:00.000Z",
}

SUMMARY = {
    "kind": "DEDICATED",
    "id": "db-1",
    "name": "main",
    "engine": "POSTGRES",
    "version": "16",
    "region": "eu-north-1",
    "status": "RUNNING",
    "plan": "db-s-1vcpu-1gb",
    "createdAt": "2026-09-01T12:00:00.000Z",
    "dedicated": {"numNodes": 1, "storageGb": 10},
}

DEDICATED = {
    "id": "db-1",
    "name": "main",
    "engine": "POSTGRES",
    "version": "16",
    "provider": "DIGITALOCEAN",
    "region": "eu-north-1",
    "size": "db-s-1vcpu-1gb",
    "numNodes": 1,
    "storageGb": 10,
    "status": "RUNNING",
    "host": "db-1.cosmoner.dev",
    "port": 25060,
    "defaultDb": "defaultdb",
    "defaultUser": "doadmin",
    "createdAt": "2026-09-01T12:00:00.000Z",
}

SHARED = {
    "id": "ten-1",
    "clusterId": "cl-1",
    "clusterName": "shared-eu-1",
    "dbName": "t_acme",
    "dbUser": "t_acme",
    "host": "shared-eu-1.cosmoner.dev",
    "port": 5432,
    "region": "eu-north-1",
    "poolName": "t_acme",
    "poolPort": 6432,
    "poolMode": "transaction",
    "status": "ACTIVE",
    "tier": "starter",
    "maxConnections": 20,
    "storageLimitMb": 1024,
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


class TestDatabasesValidation:
    """Tests for client-side argument validation."""

    def test_requires_a_database_id_on_get_dedicated(self, client):
        with pytest.raises(ValueError, match="database_id is required"):
            client.databases.get_dedicated("")

    def test_requires_a_tenant_id_on_get_shared(self, client):
        with pytest.raises(ValueError, match="tenant_id is required"):
            client.databases.get_shared("")

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.databases.list()


class TestDatabases:
    """Tests for database reads via mocked HTTP."""

    def test_lists_every_kind_of_database(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [SUMMARY]})

        result = client.databases.list()

        assert result["data"] == [SUMMARY]
        assert httpx_mock.get_request().method == "GET"

    def test_lists_dedicated_clusters(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/dedicated", json={"success": True, "data": [DEDICATED]}
        )

        result = client.databases.list_dedicated()

        assert result["data"] == [DEDICATED]

    def test_fetches_a_dedicated_cluster_with_its_connection_uri(
        self, client, httpx_mock
    ):
        uri = "postgresql://doadmin:s3cret@db-1.cosmoner.dev:25060/defaultdb"
        httpx_mock.add_response(
            url=f"{BASE}/dedicated/db-1",
            json={"success": True, "data": {**DEDICATED, "connectionUri": uri}},
        )

        result = client.databases.get_dedicated("db-1")

        assert result["data"]["connectionUri"] == uri
        assert httpx_mock.get_request().url.query == b""

    def test_lists_shared_tenants(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/shared", json={"success": True, "data": [SHARED]}
        )

        result = client.databases.list_shared()

        assert result["data"] == [SHARED]

    def test_fetches_a_shared_tenant(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/shared/ten-1", json={"success": True, "data": SHARED}
        )

        result = client.databases.get_shared("ten-1")

        assert result["data"] == SHARED

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/databases/shared/ten-1",
            json={"success": True, "data": SHARED},
        )

        client.databases.get_shared("ten-1", project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_maps_a_404_onto_not_found_error(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/dedicated/db-missing",
            status_code=404,
            json={
                "success": False,
                "error": {"code": "NOT_FOUND", "message": "Database not found"},
            },
        )

        with pytest.raises(NotFoundError):
            client.databases.get_dedicated("db-missing")


class TestAsyncDatabases:
    """Tests for the async databases namespace."""

    async def test_lists_every_kind_of_database(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [SUMMARY]})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.databases.list()

        assert result["data"] == [SUMMARY]

    async def test_reads_dedicated_clusters(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/dedicated", json={"success": True, "data": [DEDICATED]}
        )
        httpx_mock.add_response(
            url=f"{BASE}/dedicated/db-1",
            json={"success": True, "data": {**DEDICATED, "connectionUri": "pg://x"}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            listed = await client.databases.list_dedicated()
            fetched = await client.databases.get_dedicated("db-1")

        assert listed["data"] == [DEDICATED]
        assert fetched["data"]["connectionUri"] == "pg://x"

    async def test_reads_shared_tenants(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/shared", json={"success": True, "data": [SHARED]}
        )
        httpx_mock.add_response(
            url=f"{BASE}/shared/ten-1", json={"success": True, "data": SHARED}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            listed = await client.databases.list_shared()
            fetched = await client.databases.get_shared("ten-1")

        assert listed["data"] == [SHARED]
        assert fetched["data"] == SHARED

    async def test_validates_ids_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="database_id is required"):
                await client.databases.get_dedicated("")
            with pytest.raises(ValueError, match="tenant_id is required"):
                await client.databases.get_shared("")


class TestDedicatedDatabaseDelete:
    """Tests for deleting a dedicated database via mocked HTTP."""

    def test_deletes_dedicated_database_returning_the_envelope(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/dedicated/db-1", json={"success": True, "data": {}}
        )

        assert client.databases.delete_dedicated("db-1") == {"success": True, "data": {}}
        assert httpx_mock.get_request().method == "DELETE"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/databases/dedicated/db-1",
            json={"success": True, "data": {}},
        )

        client.databases.delete_dedicated("db-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    def test_requires_database_id_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="database_id is required"):
            client.databases.delete_dedicated("")

        assert httpx_mock.get_requests() == []


class TestAsyncDedicatedDatabaseDelete:
    """Tests for deleting a dedicated database through the async client."""

    async def test_deletes_dedicated_database_returning_the_envelope(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/dedicated/db-1", json={"success": True, "data": {}}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            assert await client.databases.delete_dedicated("db-1") == {
                "success": True,
                "data": {},
            }

        assert httpx_mock.get_request().method == "DELETE"

    async def test_targets_another_project_per_call(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/databases/dedicated/db-1",
            json={"success": True, "data": {}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.databases.delete_dedicated("db-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    async def test_requires_database_id_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="database_id is required"):
                await client.databases.delete_dedicated("")

        assert httpx_mock.get_requests() == []


class TestSharedDatabaseDelete:
    """Tests for deleting a shared database tenant via mocked HTTP."""

    def test_deletes_shared_database_tenant_returning_the_envelope(
        self, client, httpx_mock
    ):
        httpx_mock.add_response(
            url=f"{BASE}/shared/tenant-1", json={"success": True, "data": {}}
        )

        assert client.databases.delete_shared("tenant-1") == {"success": True, "data": {}}
        assert httpx_mock.get_request().method == "DELETE"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/databases/shared/tenant-1",
            json={"success": True, "data": {}},
        )

        client.databases.delete_shared("tenant-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    def test_requires_tenant_id_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="tenant_id is required"):
            client.databases.delete_shared("")

        assert httpx_mock.get_requests() == []


class TestAsyncSharedDatabaseDelete:
    """Tests for deleting a shared database tenant through the async client."""

    async def test_deletes_shared_database_tenant_returning_the_envelope(
        self, httpx_mock
    ):
        httpx_mock.add_response(
            url=f"{BASE}/shared/tenant-1", json={"success": True, "data": {}}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            assert await client.databases.delete_shared("tenant-1") == {
                "success": True,
                "data": {},
            }

        assert httpx_mock.get_request().method == "DELETE"

    async def test_targets_another_project_per_call(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/databases/shared/tenant-1",
            json={"success": True, "data": {}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.databases.delete_shared("tenant-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    async def test_requires_tenant_id_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="tenant_id is required"):
                await client.databases.delete_shared("")

        assert httpx_mock.get_requests() == []


class TestDedicatedDatabasePreview:
    """Tests for pricing a dedicated cluster before creating it."""

    def test_sends_the_size_as_slug(self, client, httpx_mock):
        envelope = {"success": True, "data": PREVIEW}
        httpx_mock.add_response(
            url=f"{BASE}/dedicated/preview?slug=db-s-1vcpu-1gb", json=envelope
        )

        result = client.databases.preview_dedicated(size="db-s-1vcpu-1gb")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert request.url.query == b"slug=db-s-1vcpu-1gb"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url=(
                "https://api.test.dev/v1/projects/proj-2/databases/dedicated/preview"
                "?slug=db-s-1vcpu-1gb"
            ),
            json={"success": True, "data": PREVIEW},
        )

        client.databases.preview_dedicated(size="db-s-1vcpu-1gb", project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_requires_a_size_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="size is required"):
            client.databases.preview_dedicated(size="")

        assert httpx_mock.get_requests() == []


class TestDedicatedDatabaseCreate:
    """Tests for creating a dedicated cluster via mocked HTTP."""

    def test_sends_the_default_engine_and_size_as_slug(self, client, httpx_mock):
        envelope = {"success": True, "data": {"deployed": True}}
        httpx_mock.add_response(url=f"{BASE}/dedicated", method="POST", json=envelope)

        result = client.databases.create_dedicated(
            name="main", size="db-s-1vcpu-1gb", version="16", region="fra1"
        )

        assert result == envelope
        assert json.loads(httpx_mock.get_request().content) == {
            "name": "main",
            "engine": "POSTGRESQL",
            "version": "16",
            "slug": "db-s-1vcpu-1gb",
            "region": "fra1",
        }

    def test_sends_a_given_engine_to_another_project(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/databases/dedicated",
            method="POST",
            json={"success": True, "data": {"deployed": True}},
        )

        client.databases.create_dedicated(
            name="main",
            size="db-s-1vcpu-1gb",
            version="8",
            region="fra1",
            engine="MYSQL",
            project_id="proj-2",
        )

        assert json.loads(httpx_mock.get_request().content)["engine"] == "MYSQL"

    @pytest.mark.parametrize(
        ("fields", "message"),
        [
            ({"name": "", "size": "s", "version": "16", "region": "r"}, "name is"),
            ({"name": "n", "size": "", "version": "16", "region": "r"}, "size is"),
            ({"name": "n", "size": "s", "version": "", "region": "r"}, "version is"),
            ({"name": "n", "size": "s", "version": "16", "region": ""}, "region is"),
        ],
    )
    def test_requires_each_field_before_any_request(
        self, client, httpx_mock, fields, message
    ):
        with pytest.raises(ValueError, match=f"{message} required"):
            client.databases.create_dedicated(**fields)

        assert httpx_mock.get_requests() == []


class TestAsyncDedicatedDatabaseCreate:
    """Tests for pricing and creating a dedicated cluster through the async client."""

    async def test_previews_a_dedicated_cluster(self, httpx_mock):
        envelope = {"success": True, "data": PREVIEW}
        httpx_mock.add_response(
            url=f"{BASE}/dedicated/preview?slug=db-s-1vcpu-1gb", json=envelope
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.databases.preview_dedicated(size="db-s-1vcpu-1gb")

        assert result == envelope

    async def test_creates_a_dedicated_cluster(self, httpx_mock):
        envelope = {"success": True, "data": {"deployed": True}}
        httpx_mock.add_response(url=f"{BASE}/dedicated", method="POST", json=envelope)

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.databases.create_dedicated(
                name="main", size="db-s-1vcpu-1gb", version="16", region="fra1"
            )

        assert result == envelope
        assert json.loads(httpx_mock.get_request().content) == {
            "name": "main",
            "engine": "POSTGRESQL",
            "version": "16",
            "slug": "db-s-1vcpu-1gb",
            "region": "fra1",
        }

    async def test_requires_a_version_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="version is required"):
                await client.databases.create_dedicated(
                    name="main", size="db-s-1vcpu-1gb", version="", region="fra1"
                )
            with pytest.raises(ValueError, match="size is required"):
                await client.databases.preview_dedicated(size="")

        assert httpx_mock.get_requests() == []
