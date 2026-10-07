import json

import pytest

from cosmoner import AsyncCosmoner, ConflictError, Cosmoner, NotFoundError

BASE = "https://api.test.dev/v1/projects/proj-1/domains"

DOMAIN = {
    "id": "dom-1",
    "name": "example.com",
    "type": "EXTERNAL",
    "status": "ACTIVE",
    "registrar": None,
    "expiresAt": None,
    "autoRenew": False,
    "dnsRecords": [
        {
            "id": "rec-1",
            "type": "A",
            "name": "@",
            "value": "203.0.113.10",
            "ttl": 3600,
            "priority": None,
        }
    ],
    "verificationRecord": None,
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


class TestDomainsValidation:
    """Tests for client-side argument validation."""

    def test_requires_a_domain_on_get(self, client):
        with pytest.raises(ValueError, match="domain is required"):
            client.domains.get("")

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.domains.list()


class TestDomains:
    """Tests for domain reads via mocked HTTP."""

    def test_lists_domains(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [DOMAIN]})

        result = client.domains.list()

        assert result["data"] == [DOMAIN]
        assert httpx_mock.get_request().method == "GET"

    def test_fetches_a_domain_by_id(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/dom-1", json={"success": True, "data": DOMAIN}
        )

        result = client.domains.get("dom-1")

        assert result["data"] == DOMAIN

    def test_fetches_a_domain_by_name(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/example.com", json={"success": True, "data": DOMAIN}
        )

        result = client.domains.get("example.com")

        assert result["data"]["name"] == "example.com"

    def test_url_encodes_the_domain_as_one_path_segment(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/a%2Fb%3Fc.example", json={"success": True, "data": DOMAIN}
        )

        client.domains.get("a/b?c.example")

        request = httpx_mock.get_request()
        assert request.url.raw_path == b"/v1/projects/proj-1/domains/a%2Fb%3Fc.example"
        assert request.url.query == b""

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/domains",
            json={"success": True, "data": []},
        )

        client.domains.list(project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_maps_a_404_onto_not_found_error(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/missing.example",
            status_code=404,
            json={
                "success": False,
                "error": {"code": "NOT_FOUND", "message": "Domain not found"},
            },
        )

        with pytest.raises(NotFoundError):
            client.domains.get("missing.example")


class TestAsyncDomains:
    """Tests for the async domains namespace."""

    async def test_lists_domains(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": [DOMAIN]})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.domains.list()

        assert result["data"] == [DOMAIN]

    async def test_url_encodes_the_domain(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/a%2Fb.example", json={"success": True, "data": DOMAIN}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.domains.get("a/b.example")

        assert result["data"] == DOMAIN
        assert httpx_mock.get_request().url.raw_path.endswith(b"/domains/a%2Fb.example")

    async def test_validates_the_domain_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="domain is required"):
                await client.domains.get("")


PENDING_DOMAIN = {
    **DOMAIN,
    "status": "PENDING",
    "verificationRecord": {
        "type": "TXT",
        "name": "_cosmoner-verify.example.com",
        "value": "cosmoner-verify=abc123",
    },
}

VERIFY_RESULT = {
    "status": "ACTIVE",
    "verified": True,
    "record": PENDING_DOMAIN["verificationRecord"],
}


class TestDomainWrites:
    """Tests for adding, verifying and deleting domains via mocked HTTP."""

    def test_adds_an_external_domain(self, client, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": PENDING_DOMAIN}
        )

        result = client.domains.create("example.com")

        assert result == {"success": True, "data": PENDING_DOMAIN}
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {"name": "example.com", "type": "EXTERNAL"}

    def test_adds_a_domain_in_another_project(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/domains",
            status_code=201,
            json={"success": True, "data": PENDING_DOMAIN},
        )

        client.domains.create("example.com", project_id="proj-2")

        assert httpx_mock.get_request().method == "POST"

    def test_requires_a_name_on_create_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="name is required"):
            client.domains.create("")

        assert httpx_mock.get_requests() == []

    def test_verifies_a_domain_by_name(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/example.com/verify",
            json={"success": True, "data": VERIFY_RESULT},
        )

        result = client.domains.verify("example.com")

        assert result == {"success": True, "data": VERIFY_RESULT}
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert request.content == b""

    def test_url_encodes_the_domain_on_verify(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/a%2Fb.example/verify",
            json={"success": True, "data": VERIFY_RESULT},
        )

        client.domains.verify("a/b.example")

        raw_path = httpx_mock.get_request().url.raw_path
        assert raw_path == b"/v1/projects/proj-1/domains/a%2Fb.example/verify"

    def test_verifies_in_another_project(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/domains/dom-1/verify",
            json={"success": True, "data": VERIFY_RESULT},
        )

        client.domains.verify("dom-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "POST"

    def test_requires_a_domain_on_verify_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="domain is required"):
            client.domains.verify("")

        assert httpx_mock.get_requests() == []

    def test_deletes_a_domain_returning_its_id(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/dom-1", json={"success": True, "data": {"id": "dom-1"}}
        )

        result = client.domains.delete("dom-1")

        assert result == {"success": True, "data": {"id": "dom-1"}}
        assert httpx_mock.get_request().method == "DELETE"

    def test_url_encodes_the_domain_on_delete(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/a%2Fb.example", json={"success": True, "data": {"id": "dom-1"}}
        )

        client.domains.delete("a/b.example")

        raw_path = httpx_mock.get_request().url.raw_path
        assert raw_path == b"/v1/projects/proj-1/domains/a%2Fb.example"

    def test_deletes_in_another_project(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/domains/example.com",
            json={"success": True, "data": {"id": "dom-1"}},
        )

        client.domains.delete("example.com", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    def test_requires_a_domain_on_delete_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="domain is required"):
            client.domains.delete("")

        assert httpx_mock.get_requests() == []

    def test_surfaces_a_domain_still_in_use_as_a_conflict(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/example.com",
            status_code=409,
            json={
                "success": False,
                "error": {"code": "CONFLICT", "message": "Domain is in use"},
            },
        )

        with pytest.raises(ConflictError):
            client.domains.delete("example.com")


class TestAsyncDomainWrites:
    """Tests for adding, verifying and deleting domains through the async client."""

    async def test_adds_an_external_domain(self, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": PENDING_DOMAIN}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.domains.create("example.com")

        assert result == {"success": True, "data": PENDING_DOMAIN}
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {"name": "example.com", "type": "EXTERNAL"}

    async def test_verifies_an_encoded_domain_in_another_project(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/domains/a%2Fb.example/verify",
            json={"success": True, "data": VERIFY_RESULT},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.domains.verify("a/b.example", project_id="proj-2")

        assert result == {"success": True, "data": VERIFY_RESULT}
        assert httpx_mock.get_request().method == "POST"

    async def test_deletes_an_encoded_domain(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/a%2Fb.example", json={"success": True, "data": {"id": "dom-1"}}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.domains.delete("a/b.example")

        assert result == {"success": True, "data": {"id": "dom-1"}}
        assert httpx_mock.get_request().method == "DELETE"

    async def test_deletes_in_another_project(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/domains/dom-1",
            json={"success": True, "data": {"id": "dom-1"}},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.domains.delete("dom-1", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    async def test_rejects_empty_arguments_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="name is required"):
                await client.domains.create("")
            with pytest.raises(ValueError, match="domain is required"):
                await client.domains.verify("")
            with pytest.raises(ValueError, match="domain is required"):
                await client.domains.delete("")

        assert httpx_mock.get_requests() == []
