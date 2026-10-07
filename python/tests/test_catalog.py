import pytest

from cosmoner import AsyncCosmoner, Cosmoner

BASE = "https://api.test.dev/v1/catalog"

SERVER_SIZE = {
    "slug": "s-1vcpu-1gb",
    "description": "Basic",
    "vcpus": 1,
    "memoryMb": 1024,
    "diskGb": 25,
    "transferTb": 1,
    "priceMonthly": 6,
    "priceHourly": 0.009,
}

REDIS_PLAN = {
    "slug": "redis-256",
    "name": "256 MB",
    "provider": "UPSTASH",
    "engine": "REDIS",
    "planType": "FIXED",
    "memoryMb": 256,
    "throughputOps": 1000,
    "cpuMilli": 250,
    "supportsReplication": False,
    "supportsPersistence": True,
    "priceMonthly": 10,
}

DATABASES = {
    "provider": "DIGITALOCEAN",
    "sizes": [
        {
            "slug": "db-s-1vcpu-1gb",
            "description": "Basic",
            "nodeClass": "basic",
            "vcpus": 1,
            "memoryMb": 1024,
            "diskGb": 10,
            "priceMonthly": 15,
            "numNodes": 1,
        }
    ],
    "engines": [{"engine": "POSTGRESQL", "versions": ["16", "17"]}],
    "regions": [{"slug": "fra1", "name": "Frankfurt", "features": []}],
    "storage": {},
}

APP_SIZE = {
    "name": "Basic",
    "slug": "apps-s-1vcpu-0.5gb",
    "tier_slug": "basic",
    "cpu_type": "SHARED",
    "cpus": "1",
    "memory_bytes": "536870912",
    "usd_per_month": "5.00",
}

# Each catalog method, the route under /v1/catalog it reads, and a sample payload.
ROUTES = [
    ("server_sizes", "servers/sizes", [SERVER_SIZE]),
    ("server_regions", "servers/regions", [{"slug": "fra1", "name": "Frankfurt"}]),
    ("server_images", "servers/1-clicks", [{"slug": "wordpress"}]),
    ("redis_plans", "redis/plans", [REDIS_PLAN]),
    ("redis_regions", "redis/regions", [{"slug": "eu-west-1", "name": "Ireland"}]),
    ("databases", "databases", DATABASES),
    ("app_sizes", "apps/sizes", [APP_SIZE]),
    ("app_regions", "apps/regions", [{"slug": "fra", "label": "Frankfurt"}]),
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


class TestCatalog:
    """Tests for account-level catalogue reads via mocked HTTP."""

    @pytest.mark.parametrize(("method", "route", "data"), ROUTES)
    def test_reads_the_route_ignoring_the_client_default_project(
        self, client, httpx_mock, method, route, data
    ):
        envelope = {"success": True, "data": data}
        httpx_mock.add_response(url=f"{BASE}/{route}", json=envelope)

        result = getattr(client.catalog, method)()

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert str(request.url) == f"{BASE}/{route}"

    @pytest.mark.parametrize(("method", "route", "data"), ROUTES)
    def test_works_on_a_client_without_a_default_project(
        self, httpx_mock, method, route, data
    ):
        httpx_mock.add_response(
            url=f"{BASE}/{route}", json={"success": True, "data": data}
        )
        scopeless = Cosmoner(
            api_key="key-123", base_url="https://api.test.dev", max_retries=0
        )

        result = getattr(scopeless.catalog, method)()

        assert result["data"] == data


class TestAsyncCatalog:
    """Tests for the async catalog namespace."""

    @pytest.mark.parametrize(("method", "route", "data"), ROUTES)
    async def test_reads_the_route_ignoring_the_client_default_project(
        self, httpx_mock, method, route, data
    ):
        envelope = {"success": True, "data": data}
        httpx_mock.add_response(url=f"{BASE}/{route}", json=envelope)

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await getattr(client.catalog, method)()

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert str(request.url) == f"{BASE}/{route}"

    async def test_works_on_a_client_without_a_default_project(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/servers/sizes", json={"success": True, "data": [SERVER_SIZE]}
        )

        async with AsyncCosmoner(
            api_key="key-123", base_url="https://api.test.dev", max_retries=0
        ) as client:
            result = await client.catalog.server_sizes()

        assert result["data"] == [SERVER_SIZE]
