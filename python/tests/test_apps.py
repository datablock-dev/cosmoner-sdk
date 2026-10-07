import json

import pytest

import cosmoner.apps
from cosmoner import AsyncCosmoner, Cosmoner, NotFoundError

BASE = "https://api.test.dev/v1/projects/proj-1/apps"
DIGEST = "sha256:" + "a" * 64

PREVIEW = {
    "subtotal": 1000,
    "tax": None,
    "creditApplied": 0,
    "dueToday": 1000,
    "monthly": 1000,
    "currency": "USD",
    "nextBillingDate": "2026-11-01T00:00:00.000Z",
}

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

    def test_requires_an_app_id_on_get(self, client):
        with pytest.raises(ValueError, match="app_id is required"):
            client.apps.get("")

    def test_requires_an_app_id_on_logs(self, client):
        with pytest.raises(ValueError, match="app_id is required"):
            client.apps.logs("", type="RUN")

    @pytest.mark.parametrize("log_type", ["", "run", "DEPLOY", "BUILD "])
    def test_rejects_an_unknown_log_type(self, client, log_type):
        with pytest.raises(ValueError, match='type must be "BUILD" or "RUN"'):
            client.apps.logs("app-1", type=log_type)

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

    def test_fetches_an_app(self, client, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/app-1", json={"success": True, "data": APP})

        result = client.apps.get("app-1")

        assert result["data"] == APP
        assert httpx_mock.get_request().method == "GET"

    @pytest.mark.parametrize("log_type", ["BUILD", "RUN"])
    def test_fetches_logs_of_the_requested_type(self, client, httpx_mock, log_type):
        lines = [{"message": "listening on :8080", "timestamp": "2026-09-16T12:00:00Z"}]
        httpx_mock.add_response(
            url=f"{BASE}/app-1/logs?type={log_type}",
            json={"success": True, "data": {"lines": lines}},
        )

        result = client.apps.logs("app-1", type=log_type)

        assert result["data"]["lines"] == lines
        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert dict(request.url.params) == {"type": log_type}

    def test_fetches_an_app_in_another_project(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/apps/app-1",
            json={"success": True, "data": APP},
        )

        client.apps.get("app-1", project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

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

    async def test_fetches_an_app(self, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/app-1", json={"success": True, "data": APP})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.apps.get("app-1")

        assert result["data"] == APP

    async def test_fetches_logs(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/app-1/logs?type=BUILD",
            json={"success": True, "data": {"lines": []}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.apps.logs("app-1", type="BUILD")

        assert result["data"] == {"lines": []}

    async def test_rejects_an_unknown_log_type_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match='type must be "BUILD" or "RUN"'):
                await client.apps.logs("app-1", type="STDOUT")

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


class TestAppWrites:
    """Tests for changing and deleting apps via mocked HTTP."""

    def test_updates_only_the_fields_given_in_camel_case(self, client, httpx_mock):
        updated = {**APP, "name": "web-2", "imageDeployPolicy": "NEWEST"}
        httpx_mock.add_response(
            url=f"{BASE}/app-1", json={"success": True, "data": updated}
        )

        result = client.apps.update(
            "app-1",
            name="web-2",
            build_command="npm run build",
            internal_port=8080,
            auto_deploy=False,
            image_deploy_policy="NEWEST",
            instances=3,
        )

        assert result == {"success": True, "data": updated}
        request = httpx_mock.get_request()
        assert request.method == "PATCH"
        assert json.loads(request.content) == {
            "name": "web-2",
            "buildCommand": "npm run build",
            "internalPort": 8080,
            "autoDeploy": False,
            "imageDeployPolicy": "NEWEST",
            "instances": 3,
        }

    def test_sends_every_field_under_its_api_name(self, client, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/app-1", json={"success": True, "data": APP})

        client.apps.update(
            "app-1",
            name="web",
            build_command="make",
            run_command="./serve",
            output_dir="dist",
            public_port=443,
            internal_port=3000,
            auto_deploy=True,
            image_deploy_policy="TAG",
            instances=2,
        )

        assert json.loads(httpx_mock.get_request().content) == {
            "name": "web",
            "buildCommand": "make",
            "runCommand": "./serve",
            "outputDir": "dist",
            "publicPort": 443,
            "internalPort": 3000,
            "autoDeploy": True,
            "imageDeployPolicy": "TAG",
            "instances": 2,
        }

    def test_sends_an_explicit_null_to_clear_a_setting(self, client, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/app-1", json={"success": True, "data": APP})

        client.apps.update(
            "app-1",
            build_command=None,
            run_command=None,
            output_dir=None,
            public_port=None,
            internal_port=None,
        )

        assert json.loads(httpx_mock.get_request().content) == {
            "buildCommand": None,
            "runCommand": None,
            "outputDir": None,
            "publicPort": None,
            "internalPort": None,
        }

    def test_updates_an_app_in_another_project(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/apps/app-1",
            json={"success": True, "data": APP},
        )

        client.apps.update("app-1", instances=1, project_id="proj-2")

        request = httpx_mock.get_request()
        assert request.method == "PATCH"
        assert json.loads(request.content) == {"instances": 1}

    def test_rejects_an_update_with_no_changes_before_any_request(
        self, client, httpx_mock
    ):
        with pytest.raises(ValueError, match="at least one change is required"):
            client.apps.update("app-1")

        assert httpx_mock.get_requests() == []

    def test_does_not_count_the_project_override_as_a_change(self, client, httpx_mock):
        with pytest.raises(ValueError, match="at least one change is required"):
            client.apps.update("app-1", project_id="proj-2")

        assert httpx_mock.get_requests() == []

    def test_requires_an_app_id_on_update_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="app_id is required"):
            client.apps.update("", name="web")

        assert httpx_mock.get_requests() == []

    def test_deletes_an_app(self, client, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/app-1", json={"success": True, "data": {}})

        result = client.apps.delete("app-1")

        assert result == {"success": True, "data": {}}
        assert httpx_mock.get_request().method == "DELETE"

    def test_deletes_an_app_in_another_project(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/apps/app-1",
            json={"success": True, "data": {}},
        )

        client.apps.delete("app-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    def test_requires_an_app_id_on_delete_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="app_id is required"):
            client.apps.delete("")

        assert httpx_mock.get_requests() == []


class TestAsyncAppWrites:
    """Tests for changing and deleting apps through the async client."""

    async def test_updates_only_the_fields_given_in_camel_case(self, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/app-1", json={"success": True, "data": APP})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.apps.update(
                "app-1", run_command="./serve", public_port=None, auto_deploy=True
            )

        assert result == {"success": True, "data": APP}
        request = httpx_mock.get_request()
        assert request.method == "PATCH"
        assert json.loads(request.content) == {
            "runCommand": "./serve",
            "publicPort": None,
            "autoDeploy": True,
        }

    async def test_updates_an_app_in_another_project(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/apps/app-1",
            json={"success": True, "data": APP},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.apps.update("app-1", output_dir="out", project_id="proj-2")

        assert json.loads(httpx_mock.get_request().content) == {"outputDir": "out"}

    async def test_deletes_an_app_in_another_project(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/apps/app-1",
            json={"success": True, "data": {}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.apps.delete("app-1", project_id="proj-2")

        assert result == {"success": True, "data": {}}
        assert httpx_mock.get_request().method == "DELETE"

    async def test_rejects_bad_arguments_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="at least one change is required"):
                await client.apps.update("app-1")
            with pytest.raises(ValueError, match="app_id is required"):
                await client.apps.update("", name="web")
            with pytest.raises(ValueError, match="app_id is required"):
                await client.apps.delete("")

        assert httpx_mock.get_requests() == []


class TestAppPreview:
    """Tests for pricing an app before creating it."""

    def test_sends_the_size(self, client, httpx_mock):
        envelope = {"success": True, "data": PREVIEW}
        httpx_mock.add_response(
            url=f"{BASE}/preview?size=apps-s-1vcpu-1gb", json=envelope
        )

        result = client.apps.preview(size="apps-s-1vcpu-1gb")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert request.url.query == b"size=apps-s-1vcpu-1gb"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/apps/preview?size=apps-s-1vcpu-1gb",
            json={"success": True, "data": PREVIEW},
        )

        client.apps.preview(size="apps-s-1vcpu-1gb", project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_requires_a_size_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="size is required"):
            client.apps.preview(size="")

        assert httpx_mock.get_requests() == []


class TestAppDraft:
    """Tests for saving an app draft via mocked HTTP."""

    def test_sends_the_required_fields_and_the_domain_type(self, client, httpx_mock):
        envelope = {"success": True, "data": {"draftId": "draft-1"}}
        httpx_mock.add_response(
            url=f"{BASE}/draft", method="POST", status_code=201, json=envelope
        )

        result = client.apps.create_draft(size="apps-s-1vcpu-1gb", region="fra")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {
            "size": "apps-s-1vcpu-1gb",
            "region": "fra",
            "domainType": "cosmoner",
        }

    def test_sends_every_given_field_by_its_api_name(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/apps/draft",
            method="POST",
            status_code=201,
            json={"success": True, "data": {"draftId": "draft-1"}},
        )

        client.apps.create_draft(
            size="apps-s-1vcpu-1gb",
            region="fra",
            name="web",
            app_type="service",
            git_provider="github",
            git_repo="acme/web",
            git_branch="main",
            source_dir="apps/web",
            build_strategy="nixpacks",
            build_command="npm run build",
            run_command="npm start",
            output_dir="dist",
            public_port=3000,
            internal_port=9000,
            auto_deploy=False,
            container_registry="ghcr",
            container_image="ghcr.io/acme/web:1.0.0",
            container_public_port="8080",
            image_deploy_policy="TAG",
            instances=2,
            project_id="proj-2",
        )

        assert json.loads(httpx_mock.get_request().content) == {
            "name": "web",
            "size": "apps-s-1vcpu-1gb",
            "region": "fra",
            "appType": "service",
            "gitProvider": "github",
            "gitRepo": "acme/web",
            "gitBranch": "main",
            "sourceDir": "apps/web",
            "buildStrategy": "nixpacks",
            "buildCommand": "npm run build",
            "runCommand": "npm start",
            "outputDir": "dist",
            "publicPort": 3000,
            "internalPort": 9000,
            "autoDeploy": False,
            "containerRegistry": "ghcr",
            "containerImage": "ghcr.io/acme/web:1.0.0",
            "containerPublicPort": "8080",
            "imageDeployPolicy": "TAG",
            "instances": 2,
            "domainType": "cosmoner",
        }

    @pytest.mark.parametrize(
        ("fields", "message"),
        [
            ({"size": "", "region": "fra"}, "size is required"),
            ({"size": "apps-s-1vcpu-1gb", "region": ""}, "region is required"),
        ],
    )
    def test_requires_each_field_before_any_request(
        self, client, httpx_mock, fields, message
    ):
        with pytest.raises(ValueError, match=message):
            client.apps.create_draft(**fields)

        assert httpx_mock.get_requests() == []


class TestAppCreate:
    """Tests for creating an app from a draft via mocked HTTP."""

    def test_sends_the_draft_and_size(self, client, httpx_mock):
        envelope = {"success": True, "data": {"deployed": True, "appId": "app-1"}}
        httpx_mock.add_response(url=BASE, method="POST", json=envelope)

        result = client.apps.create(draft_id="draft-1", size="apps-s-1vcpu-1gb")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {
            "draftId": "draft-1",
            "size": "apps-s-1vcpu-1gb",
        }

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/apps",
            method="POST",
            json={"success": True, "data": {"deployed": True, "appId": "app-1"}},
        )

        client.apps.create(
            draft_id="draft-1", size="apps-s-1vcpu-1gb", project_id="proj-2"
        )

        assert httpx_mock.get_request().method == "POST"

    @pytest.mark.parametrize(
        ("fields", "message"),
        [
            ({"draft_id": "", "size": "apps-s-1vcpu-1gb"}, "draft_id is required"),
            ({"draft_id": "draft-1", "size": ""}, "size is required"),
        ],
    )
    def test_requires_each_field_before_any_request(
        self, client, httpx_mock, fields, message
    ):
        with pytest.raises(ValueError, match=message):
            client.apps.create(**fields)

        assert httpx_mock.get_requests() == []


class TestAppResize:
    """Tests for reading sizes, pricing a resize and resizing an app."""

    def test_reads_the_sizes_an_app_can_move_to(self, client, httpx_mock):
        envelope = {
            "success": True,
            "data": {"currentSize": "apps-s-1vcpu-1gb", "resizable": True, "sizes": []},
        }
        httpx_mock.add_response(url=f"{BASE}/app-1/sizes", json=envelope)

        assert client.apps.sizes("app-1") == envelope
        assert httpx_mock.get_request().method == "GET"

    def test_previews_a_resize(self, client, httpx_mock):
        preview = {
            **PREVIEW,
            "direction": "upgrade",
            "creditBack": 0,
            "currentMonthly": 500,
        }
        envelope = {"success": True, "data": preview}
        httpx_mock.add_response(
            url=f"{BASE}/app-1/resize-preview?size=apps-s-2vcpu-4gb", json=envelope
        )

        result = client.apps.resize_preview("app-1", size="apps-s-2vcpu-4gb")

        assert result == envelope
        assert httpx_mock.get_request().url.query == b"size=apps-s-2vcpu-4gb"

    def test_resizes_an_app(self, client, httpx_mock):
        envelope = {"success": True, "data": {"instanceSize": "apps-s-2vcpu-4gb"}}
        httpx_mock.add_response(url=f"{BASE}/app-1/size", method="PATCH", json=envelope)

        result = client.apps.resize("app-1", size="apps-s-2vcpu-4gb")

        assert result == envelope
        request = httpx_mock.get_request()
        assert request.method == "PATCH"
        assert json.loads(request.content) == {"size": "apps-s-2vcpu-4gb"}

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/apps/app-1/size",
            method="PATCH",
            json={"success": True, "data": {"instanceSize": "apps-s-2vcpu-4gb"}},
        )

        client.apps.resize("app-1", size="apps-s-2vcpu-4gb", project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_requires_an_app_id_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="app_id is required"):
            client.apps.sizes("")
        with pytest.raises(ValueError, match="app_id is required"):
            client.apps.resize_preview("", size="apps-s-2vcpu-4gb")
        with pytest.raises(ValueError, match="app_id is required"):
            client.apps.resize("", size="apps-s-2vcpu-4gb")

        assert httpx_mock.get_requests() == []

    def test_requires_a_size_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="size is required"):
            client.apps.resize_preview("app-1", size="")
        with pytest.raises(ValueError, match="size is required"):
            client.apps.resize("app-1", size="")

        assert httpx_mock.get_requests() == []


class TestAsyncAppCreate:
    """Tests for pricing, creating and resizing apps through the async client."""

    async def test_previews_drafts_and_creates_an_app(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/preview?size=apps-s-1vcpu-1gb",
            json={"success": True, "data": PREVIEW},
        )
        httpx_mock.add_response(
            url=f"{BASE}/draft",
            method="POST",
            status_code=201,
            json={"success": True, "data": {"draftId": "draft-1"}},
        )
        httpx_mock.add_response(
            url=BASE,
            method="POST",
            json={"success": True, "data": {"deployed": True, "appId": "app-1"}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            preview = await client.apps.preview(size="apps-s-1vcpu-1gb")
            draft = await client.apps.create_draft(
                size="apps-s-1vcpu-1gb", region="fra", name="web"
            )
            created = await client.apps.create(
                draft_id=draft["data"]["draftId"], size="apps-s-1vcpu-1gb"
            )

        assert preview["data"] == PREVIEW
        assert created["data"]["appId"] == "app-1"
        draft_request, create_request = httpx_mock.get_requests()[1:]
        assert json.loads(draft_request.content) == {
            "name": "web",
            "size": "apps-s-1vcpu-1gb",
            "region": "fra",
            "domainType": "cosmoner",
        }
        assert json.loads(create_request.content) == {
            "draftId": "draft-1",
            "size": "apps-s-1vcpu-1gb",
        }

    async def test_reads_sizes_previews_and_resizes(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/app-1/sizes",
            json={"success": True, "data": {"currentSize": "a", "resizable": True}},
        )
        httpx_mock.add_response(
            url=f"{BASE}/app-1/resize-preview?size=b",
            json={"success": True, "data": {**PREVIEW, "direction": "downgrade"}},
        )
        httpx_mock.add_response(
            url=f"{BASE}/app-1/size",
            method="PATCH",
            json={"success": True, "data": {"instanceSize": "b"}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            sizes = await client.apps.sizes("app-1")
            preview = await client.apps.resize_preview("app-1", size="b")
            resized = await client.apps.resize("app-1", size="b")

        assert sizes["data"]["currentSize"] == "a"
        assert preview["data"]["direction"] == "downgrade"
        assert resized == {"success": True, "data": {"instanceSize": "b"}}
        assert json.loads(httpx_mock.get_requests()[2].content) == {"size": "b"}

    async def test_validates_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="region is required"):
                await client.apps.create_draft(size="apps-s-1vcpu-1gb", region="")
            with pytest.raises(ValueError, match="draft_id is required"):
                await client.apps.create(draft_id="", size="apps-s-1vcpu-1gb")
            with pytest.raises(ValueError, match="app_id is required"):
                await client.apps.resize("", size="b")
            with pytest.raises(ValueError, match="size is required"):
                await client.apps.preview(size="")

        assert httpx_mock.get_requests() == []
