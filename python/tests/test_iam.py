import pytest

from cosmoner import AsyncCosmoner, Cosmoner, NotFoundError

BASE = "https://api.test.dev/v1/projects/proj-1/iam"

CREDENTIAL = {
    "iamUserName": "cosmoner-proj-1-ci",
    "label": "CI",
    "accessKeyId": "AKIAEXAMPLE",
    "createdAt": "2026-09-01T12:00:00.000Z",
    "origin": "project",
    "registry": None,
    "storage": None,
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


class TestIamValidation:
    """Tests for client-side argument validation."""

    def test_requires_an_iam_user_name_on_get(self, client):
        with pytest.raises(ValueError, match="iam_user_name is required"):
            client.iam.get("")

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.iam.list()


class TestIam:
    """Tests for IAM credential reads via mocked HTTP."""

    def test_lists_credentials_with_partial_errors(self, client, httpx_mock):
        data = {"credentials": [CREDENTIAL], "errors": ["registry reg-9 unreachable"]}
        httpx_mock.add_response(url=BASE, json={"success": True, "data": data})

        result = client.iam.list()

        assert result["data"] == data
        assert httpx_mock.get_request().method == "GET"

    def test_fetches_a_credential_by_user_name(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/cosmoner-proj-1-ci", json={"success": True, "data": CREDENTIAL}
        )

        result = client.iam.get("cosmoner-proj-1-ci")

        assert result["data"] == CREDENTIAL

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/iam",
            json={"success": True, "data": {"credentials": [], "errors": []}},
        )

        client.iam.list(project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_maps_a_404_onto_not_found_error(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/nobody",
            status_code=404,
            json={
                "success": False,
                "error": {"code": "NOT_FOUND", "message": "Credential not found"},
            },
        )

        with pytest.raises(NotFoundError):
            client.iam.get("nobody")


class TestAsyncIam:
    """Tests for the async IAM namespace."""

    async def test_lists_credentials(self, httpx_mock):
        data = {"credentials": [CREDENTIAL], "errors": []}
        httpx_mock.add_response(url=BASE, json={"success": True, "data": data})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.iam.list()

        assert result["data"] == data

    async def test_fetches_a_credential(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/cosmoner-proj-1-ci", json={"success": True, "data": CREDENTIAL}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.iam.get("cosmoner-proj-1-ci")

        assert result["data"] == CREDENTIAL

    async def test_validates_the_user_name_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="iam_user_name is required"):
                await client.iam.get("")


class TestIamPathEncoding:
    """An IAM user name typed by a person is encoded, never spliced raw into the path."""

    def test_encodes_the_iam_user_name(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/ci%2Fdeploy",
            json={"success": True, "data": {"iamUserName": "x"}},
        )

        client.iam.get("ci/deploy")

        assert str(httpx_mock.get_request().url) == f"{BASE}/ci%2Fdeploy"


class TestIamCredentialDelete:
    """Tests for deleting an IAM credential via mocked HTTP."""

    def test_deletes_iam_credential_tolerating_the_empty_204(self, client, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/cosmoner-proj-1-ci", status_code=204)

        assert client.iam.delete("cosmoner-proj-1-ci") is None
        assert httpx_mock.get_request().method == "DELETE"

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/iam/cosmoner-proj-1-ci",
            status_code=204,
        )

        client.iam.delete("cosmoner-proj-1-ci", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    def test_requires_iam_user_name_before_any_request(self, client, httpx_mock):
        with pytest.raises(ValueError, match="iam_user_name is required"):
            client.iam.delete("")

        assert httpx_mock.get_requests() == []

    def test_encodes_the_iam_user_name(self, client, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/ci%2Fdeploy", status_code=204)

        client.iam.delete("ci/deploy")

        assert str(httpx_mock.get_request().url) == f"{BASE}/ci%2Fdeploy"


class TestAsyncIamCredentialDelete:
    """Tests for deleting an IAM credential through the async client."""

    async def test_deletes_iam_credential_tolerating_the_empty_204(self, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/cosmoner-proj-1-ci", status_code=204)

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            assert await client.iam.delete("cosmoner-proj-1-ci") is None

        assert httpx_mock.get_request().method == "DELETE"

    async def test_targets_another_project_per_call(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/iam/cosmoner-proj-1-ci",
            status_code=204,
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.iam.delete("cosmoner-proj-1-ci", project_id="proj-2")

        assert httpx_mock.get_request().method == "DELETE"

    async def test_requires_iam_user_name_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="iam_user_name is required"):
                await client.iam.delete("")

        assert httpx_mock.get_requests() == []

    async def test_encodes_the_iam_user_name(self, httpx_mock):
        httpx_mock.add_response(url=f"{BASE}/ci%2Fdeploy", status_code=204)

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.iam.delete("ci/deploy")

        assert str(httpx_mock.get_request().url) == f"{BASE}/ci%2Fdeploy"
