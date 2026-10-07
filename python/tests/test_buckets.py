import pytest

from cosmoner import AsyncCosmoner, Cosmoner

BASE = "https://api.test.dev/v1/projects/proj-1/storage/object-storage"

BUCKETS = [
    {
        "id": "bkt-1",
        "name": "assets",
        "provider": "AWS",
        "region": "eu-north-1",
        "endpoint": "https://s3.eu-north-1.amazonaws.com",
        "publicAccess": False,
        "versioning": True,
        "status": "ACTIVE",
        "tier": "STANDARD",
        "cdnEnabled": True,
        "cdnDomain": "cdn.acme.test",
        "createdAt": "2026-09-01T12:00:00.000Z",
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


class TestBucketsValidation:
    """Tests for client-side argument validation."""

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.buckets.list()


class TestBuckets:
    """Tests for bucket reads via mocked HTTP."""

    def test_lists_buckets(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": BUCKETS})

        result = client.buckets.list()

        assert result["data"] == BUCKETS
        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert request.url.query == b""

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/storage/object-storage",
            json={"success": True, "data": BUCKETS},
        )

        client.buckets.list(project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)


class TestAsyncBuckets:
    """Tests for the async bucket namespace."""

    async def test_lists_buckets(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": BUCKETS})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.buckets.list()

        assert result["data"] == BUCKETS

    async def test_targets_another_project_per_call(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/storage/object-storage",
            json={"success": True, "data": BUCKETS},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.buckets.list(project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)


class TestBucketDelete:
    """Tests for deleting a bucket via mocked HTTP."""

    def test_deletes_bucket_returning_the_envelope(self, client, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/bkt-1", json={"success": True, "data": {}})

        assert client.buckets.delete("bkt-1") == {"success": True, "data": {}}
        assert httpx_mock.get_request().method == "DELETE"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/storage/object-storage/bkt-1",
            json={"success": True, "data": {}},
        )

        client.buckets.delete("bkt-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    def test_requires_bucket_id_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="bucket_id is required"):
            client.buckets.delete("")

        assert httpx_mock.get_requests() == []


class TestAsyncBucketDelete:
    """Tests for deleting a bucket through the async client."""

    async def test_deletes_bucket_returning_the_envelope(self, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/bkt-1", json={"success": True, "data": {}})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            assert await client.buckets.delete("bkt-1") == {"success": True, "data": {}}

        assert httpx_mock.get_request().method == "DELETE"

    async def test_targets_another_project_per_call(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/storage/object-storage/bkt-1",
            json={"success": True, "data": {}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.buckets.delete("bkt-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    async def test_requires_bucket_id_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="bucket_id is required"):
                await client.buckets.delete("")

        assert httpx_mock.get_requests() == []
