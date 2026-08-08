import json

import pytest

from cosmoner import AsyncCosmoner, Cosmoner, NotFoundError

BASE = "https://api.test.dev/v1/projects/proj-1/webhooks"

ENDPOINT = {
    "id": "ep-1",
    "name": "Billing receiver",
    "description": None,
    "url": "https://example.com/hooks",
    "events": ["email.delivered"],
    "enabled": True,
    "secretHint": "cdef",
    "consecutiveFailures": 0,
    "disabledAt": None,
    "disabledReason": None,
    "lastSuccessAt": None,
    "lastFailureAt": None,
    "createdAt": "2026-08-08T12:00:00.000Z",
    "updatedAt": "2026-08-08T12:00:00.000Z",
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


class TestWebhookValidation:
    """Tests for client-side argument validation."""

    def test_requires_an_endpoint_id_on_get(self, client):
        with pytest.raises(ValueError, match="endpoint_id is required"):
            client.webhooks.get("")

    def test_requires_an_endpoint_id_on_delete(self, client):
        with pytest.raises(ValueError, match="endpoint_id is required"):
            client.webhooks.delete("")

    def test_requires_a_delivery_id_on_replay(self, client):
        with pytest.raises(ValueError, match="delivery_id is required"):
            client.webhooks.replay_delivery("ep-1", "")

    def test_requires_a_name_on_create(self, client):
        with pytest.raises(ValueError, match="name is required"):
            client.webhooks.create(name="", url="https://e.com", events=["email.sent"])

    def test_requires_a_url_on_create(self, client):
        with pytest.raises(ValueError, match="url is required"):
            client.webhooks.create(name="Hooks", url="", events=["email.sent"])

    def test_requires_at_least_one_event_on_create(self, client):
        with pytest.raises(ValueError, match="At least one event is required"):
            client.webhooks.create(name="Hooks", url="https://e.com", events=[])

    def test_rejects_clearing_every_event_on_update(self, client):
        with pytest.raises(ValueError, match="At least one event is required"):
            client.webhooks.update("ep-1", events=[])

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.webhooks.list()


class TestWebhookEndpoints:
    """Tests for endpoint management via mocked HTTP."""

    def test_lists_endpoints(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [ENDPOINT]})

        result = client.webhooks.list()

        assert result["data"] == [ENDPOINT]
        assert httpx_mock.get_request().method == "GET"

    def test_fetches_one_endpoint_with_stats(self, client, httpx_mock):
        stats = {"succeeded": 12, "failed": 1, "pending": 0}
        httpx_mock.add_response(
            url=f"{BASE}/ep-1",
            json={"success": True, "data": {"endpoint": ENDPOINT, "stats": stats}},
        )

        result = client.webhooks.get("ep-1")

        assert result["data"]["stats"] == stats

    def test_creates_an_endpoint_and_surfaces_the_one_time_secret(
        self, client, httpx_mock
    ):
        httpx_mock.add_response(
            url=BASE,
            status_code=201,
            json={"success": True, "data": {**ENDPOINT, "secret": "whsec_full_value"}},
        )

        result = client.webhooks.create(
            name="Billing receiver",
            url="https://example.com/hooks",
            events=["email.delivered", "email.bounced"],
            description="Receipts",
        )

        assert result["data"]["secret"] == "whsec_full_value"

        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {
            "name": "Billing receiver",
            "url": "https://example.com/hooks",
            "events": ["email.delivered", "email.bounced"],
            "description": "Receipts",
        }

    def test_omits_description_when_not_given(self, client, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": {}}
        )

        client.webhooks.create(name="Hooks", url="https://e.com", events=["email.sent"])

        assert "description" not in json.loads(httpx_mock.get_request().content)

    def test_updates_only_the_fields_given(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/ep-1", json={"success": True, "data": ENDPOINT}
        )

        client.webhooks.update("ep-1", enabled=False)

        request = httpx_mock.get_request()
        assert request.method == "PATCH"
        # Untouched fields must not be sent — the API treats present keys as edits.
        assert json.loads(request.content) == {"enabled": False}

    def test_sends_an_explicit_null_to_clear_the_description(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/ep-1", json={"success": True, "data": ENDPOINT}
        )

        client.webhooks.update("ep-1", description=None)

        assert json.loads(httpx_mock.get_request().content) == {"description": None}

    def test_deletes_an_endpoint(self, client, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/ep-1", json={"success": True, "data": None})

        result = client.webhooks.delete("ep-1")

        assert result["data"] is None
        assert httpx_mock.get_request().method == "DELETE"

    def test_resumes_a_paused_endpoint(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/ep-1/resume", json={"success": True, "data": ENDPOINT}
        )

        client.webhooks.resume("ep-1")

        assert httpx_mock.get_request().method == "POST"

    def test_rotates_the_signing_secret(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/ep-1/rotate-secret",
            json={"success": True, "data": {"id": "ep-1", "secret": "whsec_rotated"}},
        )

        result = client.webhooks.rotate_secret("ep-1")

        assert result["data"]["secret"] == "whsec_rotated"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/webhooks",
            json={"success": True, "data": []},
        )

        client.webhooks.list(project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_maps_a_404_onto_not_found_error(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/ep-missing",
            status_code=404,
            json={
                "success": False,
                "error": {"code": "NOT_FOUND", "message": "Webhook endpoint not found"},
            },
        )

        with pytest.raises(NotFoundError):
            client.webhooks.get("ep-missing")

    def test_sends_auth_and_idempotency_headers_on_writes(self, client, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": {}}
        )

        client.webhooks.create(name="Hooks", url="https://e.com", events=["email.sent"])

        request = httpx_mock.get_request()
        assert request.headers["authorization"] == "Bearer key-123"
        assert request.headers["idempotency-key"]


class TestWebhookTestSend:
    """Tests for the synthetic test-send endpoint."""

    def test_sends_an_explicit_event_type(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/ep-1/test",
            json={"success": True, "data": {"outcome": "SUCCEEDED", "delivery": {}}},
        )

        result = client.webhooks.test("ep-1", event_type="email.bounced")

        assert result["data"]["outcome"] == "SUCCEEDED"
        assert json.loads(httpx_mock.get_request().content) == {
            "eventType": "email.bounced"
        }

    def test_lets_the_server_pick_the_event_type(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/ep-1/test",
            json={"success": True, "data": {"outcome": "SUCCEEDED", "delivery": {}}},
        )

        client.webhooks.test("ep-1")

        assert json.loads(httpx_mock.get_request().content) == {}


class TestWebhookDeliveries:
    """Tests for the delivery log and replay."""

    def test_passes_filters_through_as_query_parameters(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/ep-1/deliveries?status=FAILED&eventType=email.bounced&limit=50&cursor=dlv-9",
            json={"success": True, "data": {"deliveries": [], "nextCursor": None}},
        )

        client.webhooks.list_deliveries(
            "ep-1",
            status="FAILED",
            event_type="email.bounced",
            limit=50,
            cursor="dlv-9",
        )

        params = httpx_mock.get_request().url.params
        assert dict(params) == {
            "status": "FAILED",
            "eventType": "email.bounced",
            "limit": "50",
            "cursor": "dlv-9",
        }

    def test_omits_absent_filters(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/ep-1/deliveries",
            json={"success": True, "data": {"deliveries": [], "nextCursor": None}},
        )

        client.webhooks.list_deliveries("ep-1")

        assert str(httpx_mock.get_request().url) == f"{BASE}/ep-1/deliveries"

    def test_replays_a_delivery(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/ep-1/deliveries/dlv-1/replay",
            status_code=201,
            json={"success": True, "data": {"id": "dlv-2"}},
        )

        result = client.webhooks.replay_delivery("ep-1", "dlv-1")

        assert result["data"]["id"] == "dlv-2"
        assert httpx_mock.get_request().method == "POST"


class TestAsyncWebhooks:
    """Tests for the async webhooks namespace."""

    async def test_lists_endpoints(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [ENDPOINT]})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.webhooks.list()

        assert result["data"] == [ENDPOINT]

    async def test_creates_an_endpoint(self, httpx_mock):
        httpx_mock.add_response(
            url=BASE,
            status_code=201,
            json={"success": True, "data": {**ENDPOINT, "secret": "whsec_async"}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.webhooks.create(
                name="Hooks", url="https://e.com", events=["email.sent"]
            )

        assert result["data"]["secret"] == "whsec_async"

    async def test_validates_arguments_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="endpoint_id is required"):
                await client.webhooks.get("")

    async def test_replays_a_delivery(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/ep-1/deliveries/dlv-1/replay",
            status_code=201,
            json={"success": True, "data": {"id": "dlv-2"}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.webhooks.replay_delivery("ep-1", "dlv-1")

        assert result["data"]["id"] == "dlv-2"
