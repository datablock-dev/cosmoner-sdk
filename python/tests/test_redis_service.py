import json

import pytest

from cosmoner import AsyncCosmoner, Cosmoner, NotFoundError

BASE = "https://api.test.dev/v1/projects/proj-1/redis"

PREVIEW = {
    "subtotal": 1000,
    "tax": None,
    "creditApplied": 0,
    "dueToday": 1000,
    "monthly": 1000,
    "currency": "USD",
    "nextBillingDate": "2026-11-01T00:00:00.000Z",
}

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


class TestRedisDelete:
    """Tests for deleting a Redis database via mocked HTTP."""

    def test_deletes_redis_database_returning_the_envelope(self, client, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/red-1", json={"success": True, "data": {}})

        assert client.redis.delete("red-1") == {"success": True, "data": {}}
        assert httpx_mock.get_request().method == "DELETE"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/redis/red-1",
            json={"success": True, "data": {}},
        )

        client.redis.delete("red-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    def test_requires_redis_id_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="redis_id is required"):
            client.redis.delete("")

        assert httpx_mock.get_requests() == []


class TestAsyncRedisDelete:
    """Tests for deleting a Redis database through the async client."""

    async def test_deletes_redis_database_returning_the_envelope(self, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/red-1", json={"success": True, "data": {}})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            assert await client.redis.delete("red-1") == {"success": True, "data": {}}

        assert httpx_mock.get_request().method == "DELETE"

    async def test_targets_another_project_per_call(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/redis/red-1",
            json={"success": True, "data": {}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.redis.delete("red-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    async def test_requires_redis_id_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="redis_id is required"):
                await client.redis.delete("")

        assert httpx_mock.get_requests() == []


class TestRedisPreview:
    """Tests for pricing a Redis database before creating it."""

    def test_sends_the_plan_as_plan_slug(self, client, httpx_mock):
        envelope = {"success": True, "data": PREVIEW}
        httpx_mock.add_response(url=f"{BASE}/preview?planSlug=redis-256", json=envelope)

        result = client.redis.preview(plan="redis-256")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert request.url.query == b"planSlug=redis-256"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/redis/preview?planSlug=redis-256",
            json={"success": True, "data": PREVIEW},
        )

        client.redis.preview(plan="redis-256", project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_requires_a_plan_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="plan is required"):
            client.redis.preview(plan="")

        assert httpx_mock.get_requests() == []


class TestRedisCreate:
    """Tests for creating a Redis database via mocked HTTP."""

    def test_sends_only_the_required_fields(self, client, httpx_mock):
        envelope = {"success": True, "data": {"deployed": True}}
        httpx_mock.add_response(url=BASE, method="POST", json=envelope)

        result = client.redis.create(name="cache", plan="redis-256", region="eu-west-1")

        assert result == envelope
        assert json.loads(httpx_mock.get_request().content) == {
            "name": "cache",
            "planSlug": "redis-256",
            "region": "eu-west-1",
        }

    def test_sends_persistence_as_data_persistence(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/redis",
            method="POST",
            json={"success": True, "data": {"deployed": True}},
        )

        client.redis.create(
            name="cache",
            plan="redis-256",
            region="eu-west-1",
            persistence="AOF_EVERY_1_SECOND",
            project_id="proj-2",
        )

        assert json.loads(httpx_mock.get_request().content) == {
            "name": "cache",
            "planSlug": "redis-256",
            "region": "eu-west-1",
            "dataPersistence": "AOF_EVERY_1_SECOND",
        }

    @pytest.mark.parametrize(
        ("fields", "message"),
        [
            ({"name": "", "plan": "p", "region": "r"}, "name is required"),
            ({"name": "n", "plan": "", "region": "r"}, "plan is required"),
            ({"name": "n", "plan": "p", "region": ""}, "region is required"),
        ],
    )
    def test_requires_each_field_before_any_request(
        self, client, httpx_mock, fields, message
    ):
        with pytest.raises(ValueError, match=message):
            client.redis.create(**fields)

        assert httpx_mock.get_requests() == []


class TestAsyncRedisCreate:
    """Tests for pricing and creating a Redis database through the async client."""

    async def test_previews_a_redis_database(self, httpx_mock):
        envelope = {"success": True, "data": PREVIEW}
        httpx_mock.add_response(url=f"{BASE}/preview?planSlug=redis-256", json=envelope)

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            assert await client.redis.preview(plan="redis-256") == envelope

    async def test_creates_a_redis_database(self, httpx_mock):
        envelope = {"success": True, "data": {"deployed": True}}
        httpx_mock.add_response(url=BASE, method="POST", json=envelope)

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.redis.create(
                name="cache", plan="redis-256", region="eu-west-1", persistence="NONE"
            )

        assert result == envelope
        assert json.loads(httpx_mock.get_request().content) == {
            "name": "cache",
            "planSlug": "redis-256",
            "region": "eu-west-1",
            "dataPersistence": "NONE",
        }

    async def test_requires_a_plan_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="plan is required"):
                await client.redis.preview(plan="")
            with pytest.raises(ValueError, match="plan is required"):
                await client.redis.create(name="cache", plan="", region="eu-west-1")

        assert httpx_mock.get_requests() == []
