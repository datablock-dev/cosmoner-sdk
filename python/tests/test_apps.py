import json

import pytest

import cosmoner.apps
from cosmoner import AsyncCosmoner, Cosmoner, NotFoundError

BASE = "https://api.test.dev/v1/projects/proj-1/apps"
DIGEST = "sha256:" + "a" * 64

APP = {
    "id": "app-1",
    "name": "web",
    "subdomain": "web",
    "status": "RUNNING",
    "url": "https://web.cosmoner.app",
    "gitRepo": None,
    "containerImage": "registry.cosmoner.com/acme/web:1.0.0",
    "imageDeployPolicy": "MANUAL",
    "createdAt": "2026-09-01T12:00:00.000Z",
    "updatedAt": "2026-09-01T12:00:00.000Z",
}


def deployment(phase):
    """Build a deployment payload in the given phase."""
    return {
        "id": "dep-1",
        "phase": phase,
        "cause": "api deploy",
        "imageRef": "registry.cosmoner.com/acme/web:1.1.0",
        "imageDigest": None,
        "error": None,
        "startedAt": "2026-09-16T12:00:00.000Z",
        "finishedAt": None,
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


@pytest.fixture()
def sleeps(monkeypatch):
    """Record poll sleeps instead of waiting on them."""
    recorded = []

    async def fake_async_sleep(seconds):
        recorded.append(seconds)

    monkeypatch.setattr(cosmoner.apps.time, "sleep", recorded.append)
    monkeypatch.setattr(cosmoner.apps.asyncio, "sleep", fake_async_sleep)
    return recorded


class TestAppValidation:
    """Tests for client-side argument validation."""

    def test_requires_an_app_id_on_deploy(self, client):
        with pytest.raises(ValueError, match="app_id is required"):
            client.apps.deploy("")

    def test_rejects_both_tag_and_digest(self, client):
        with pytest.raises(ValueError, match="Pass either tag or digest, not both"):
            client.apps.deploy("app-1", tag="1.0.0", digest=DIGEST)

    @pytest.mark.parametrize("tag", ["", ".leading-dot", "has space", "x" * 129])
    def test_rejects_a_malformed_tag(self, client, tag):
        with pytest.raises(ValueError, match="Invalid image tag"):
            client.apps.deploy("app-1", tag=tag)

    @pytest.mark.parametrize(
        "digest", ["a" * 64, "sha256:" + "A" * 64, "sha256:abc", DIGEST + "\n"]
    )
    def test_rejects_a_malformed_digest(self, client, digest):
        with pytest.raises(ValueError, match="digest must be sha256"):
            client.apps.deploy("app-1", digest=digest)

    def test_requires_a_deployment_id(self, client):
        with pytest.raises(ValueError, match="deployment_id is required"):
            client.apps.get_deployment("app-1", "")

    def test_rejects_a_non_positive_interval(self, client):
        with pytest.raises(ValueError, match="interval must be greater than 0"):
            client.apps.wait_for_deployment("app-1", "dep-1", interval=0)

    def test_rejects_a_non_positive_timeout(self, client):
        with pytest.raises(ValueError, match="timeout must be greater than 0"):
            client.apps.wait_for_deployment("app-1", "dep-1", timeout=0)

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.apps.list()


class TestApps:
    """Tests for app listing and deploys via mocked HTTP."""

    def test_lists_apps(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [APP]})

        result = client.apps.list()

        assert result["data"] == [APP]
        assert httpx_mock.get_request().method == "GET"

    def test_deploys_a_tag(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/app-1/deployments",
            status_code=202,
            json={"success": True, "data": deployment("PENDING")},
        )

        result = client.apps.deploy("app-1", tag="1.1.0")

        assert result["data"]["phase"] == "PENDING"
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {"tag": "1.1.0"}

    def test_deploys_a_digest(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/app-1/deployments",
            status_code=202,
            json={"success": True, "data": deployment("PENDING")},
        )

        client.apps.deploy("app-1", digest=DIGEST)

        assert json.loads(httpx_mock.get_request().content) == {"digest": DIGEST}

    def test_sends_an_empty_body_to_re_resolve_the_current_image(
        self, client, httpx_mock
    ):
        httpx_mock.add_response(
            url=f"{BASE}/app-1/deployments",
            status_code=202,
            json={"success": True, "data": deployment("PENDING")},
        )

        client.apps.deploy("app-1")

        assert json.loads(httpx_mock.get_request().content) == {}

    def test_fetches_a_deployment(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/app-1/deployments/dep-1",
            json={"success": True, "data": deployment("DEPLOYING")},
        )

        result = client.apps.get_deployment("app-1", "dep-1")

        assert result["data"]["phase"] == "DEPLOYING"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/apps",
            json={"success": True, "data": []},
        )

        client.apps.list(project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_maps_a_404_onto_not_found_error(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/app-missing/deployments",
            status_code=404,
            json={
                "success": False,
                "error": {"code": "NOT_FOUND", "message": "App not found"},
            },
        )

        with pytest.raises(NotFoundError):
            client.apps.deploy("app-missing")


class TestWaitForDeployment:
    """Tests for polling a deployment to a finished phase."""

    def test_polls_until_the_deployment_finishes(self, client, httpx_mock, sleeps):
        for phase in ("PENDING", "DEPLOYING", "ACTIVE"):
            httpx_mock.add_response(
                url=f"{BASE}/app-1/deployments/dep-1",
                json={"success": True, "data": deployment(phase)},
            )
        polled = []

        result = client.apps.wait_for_deployment(
            "app-1", "dep-1", interval=2, on_poll=lambda d: polled.append(d["phase"])
        )

        assert result["phase"] == "ACTIVE"
        assert polled == ["PENDING", "DEPLOYING", "ACTIVE"]
        assert sleeps == [2, 2]

    def test_returns_a_failed_deployment_rather_than_raising(
        self, client, httpx_mock, sleeps
    ):
        httpx_mock.add_response(
            url=f"{BASE}/app-1/deployments/dep-1",
            json={"success": True, "data": {**deployment("ERROR"), "error": "boom"}},
        )

        result = client.apps.wait_for_deployment("app-1", "dep-1")

        assert result["phase"] == "ERROR"
        assert result["error"] == "boom"
        assert sleeps == []

    def test_raises_when_the_timeout_passes_first(
        self, client, httpx_mock, sleeps, monkeypatch
    ):
        clock = iter([0.0, 5.0])
        monkeypatch.setattr(cosmoner.apps.time, "monotonic", lambda: next(clock))
        httpx_mock.add_response(
            url=f"{BASE}/app-1/deployments/dep-1",
            json={"success": True, "data": deployment("BUILDING")},
        )

        with pytest.raises(TimeoutError, match="dep-1 was still BUILDING after 5s"):
            client.apps.wait_for_deployment("app-1", "dep-1", timeout=5)

    def test_never_sleeps_past_the_deadline(
        self, client, httpx_mock, sleeps, monkeypatch
    ):
        clock = iter([0.0, 9.0, 10.0])
        monkeypatch.setattr(cosmoner.apps.time, "monotonic", lambda: next(clock))
        httpx_mock.add_response(
            url=f"{BASE}/app-1/deployments/dep-1",
            json={"success": True, "data": deployment("BUILDING")},
            is_reusable=True,
        )

        with pytest.raises(TimeoutError):
            client.apps.wait_for_deployment("app-1", "dep-1", interval=3, timeout=10)

        assert sleeps == [1.0]

    def test_raises_when_a_poll_request_fails(self, client, httpx_mock, sleeps):
        httpx_mock.add_response(
            url=f"{BASE}/app-1/deployments/dep-1",
            status_code=404,
            json={
                "success": False,
                "error": {"code": "NOT_FOUND", "message": "Deployment not found"},
            },
        )

        with pytest.raises(NotFoundError):
            client.apps.wait_for_deployment("app-1", "dep-1")


class TestAsyncApps:
    """Tests for the async apps namespace."""

    async def test_lists_apps(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [APP]})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.apps.list()

        assert result["data"] == [APP]

    async def test_deploys_a_tag(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/app-1/deployments",
            status_code=202,
            json={"success": True, "data": deployment("PENDING")},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.apps.deploy("app-1", tag="1.1.0")

        assert result["data"]["id"] == "dep-1"
        assert json.loads(httpx_mock.get_request().content) == {"tag": "1.1.0"}

    async def test_validates_arguments_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="Pass either tag or digest, not both"):
                await client.apps.deploy("app-1", tag="1.0.0", digest=DIGEST)

    async def test_polls_until_the_deployment_finishes(self, httpx_mock, sleeps):
        for phase in ("BUILDING", "SUPERSEDED"):
            httpx_mock.add_response(
                url=f"{BASE}/app-1/deployments/dep-1",
                json={"success": True, "data": deployment(phase)},
            )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.apps.wait_for_deployment("app-1", "dep-1")

        assert result["phase"] == "SUPERSEDED"
        assert sleeps == [3.0]
