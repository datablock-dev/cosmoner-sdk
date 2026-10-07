import pytest

from cosmoner import AsyncCosmoner, Cosmoner, NotFoundError

BASE = "https://api.test.dev/v1/projects/proj-1/redis"

REDIS = {
    "id": "rds-1",
    "name": "cache",
    "provider": "REDIS_CLOUD",
    "engine": "redis",
    "engineVersion": "7.4",
    "planSlug": "redis-250mb",
    "planType": "ESSENTIALS",
    "memoryMb": 250,
    "throughputOps": 1000,
    "cloudProvider": "AWS",
    "region": "eu-north-1",
    "replication": False,
    "dataPersistence": "none",
    "status": "ACTIVE",
    "host": "redis-1.cosmoner.dev",
    "port": 6379,
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


class TestRedisValidation:
    """Tests for client-side argument validation."""

    def test_requires_a_redis_id_on_get(self, client):
        with pytest.raises(ValueError, match="redis_id is required"):
            client.redis.get("")

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.redis.list()


class TestRedis:
    """Tests for Redis database reads via mocked HTTP."""

    def test_lists_databases(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [REDIS]})

        result = client.redis.list()

        assert result["data"] == [REDIS]
        assert httpx_mock.get_request().method == "GET"

    def test_fetches_a_database_with_its_password(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/rds-1",
            json={"success": True, "data": {**REDIS, "password": "s3cret"}},
        )

        result = client.redis.get("rds-1")

        assert result["data"]["password"] == "s3cret"
        assert httpx_mock.get_request().url.query == b""

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/redis",
            json={"success": True, "data": []},
        )

        client.redis.list(project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_maps_a_404_onto_not_found_error(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/rds-missing",
            status_code=404,
            json={
                "success": False,
                "error": {"code": "NOT_FOUND", "message": "Redis database not found"},
            },
        )

        with pytest.raises(NotFoundError):
            client.redis.get("rds-missing")


class TestAsyncRedis:
    """Tests for the async Redis namespace."""

    async def test_lists_databases(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [REDIS]})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.redis.list()

        assert result["data"] == [REDIS]

    async def test_fetches_a_database_with_its_password(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/rds-1",
            json={"success": True, "data": {**REDIS, "password": "s3cret"}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.redis.get("rds-1")

        assert result["data"]["password"] == "s3cret"

    async def test_validates_the_redis_id_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="redis_id is required"):
                await client.redis.get("")
