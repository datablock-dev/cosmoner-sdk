import json

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


ISSUED = {
    **CREDENTIAL,
    "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "storage": {
        "access": "read",
        "allBuckets": False,
        "buckets": [{"bucketId": "bkt-1", "bucketName": "assets"}],
    },
}


class TestIamCredentialCreate:
    """Tests for issuing an IAM credential via mocked HTTP."""

    def test_issues_a_credential_returning_the_secret_once(self, client, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": ISSUED}
        )

        result = client.iam.create(
            label="CI", storage_access="read", bucket_ids=["bkt-1"]
        )

        assert result == {"success": True, "data": ISSUED}
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {
            "label": "CI",
            "storage": {"access": "read", "bucketIds": ["bkt-1"]},
        }

    def test_nests_both_halves_with_their_id_lists(self, client, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": ISSUED}
        )

        client.iam.create(
            label="CI",
            storage_access="write",
            bucket_ids=["bkt-1", "bkt-2"],
            registry_access="push",
            repository_ids=["repo-1"],
        )

        assert json.loads(httpx_mock.get_request().content) == {
            "label": "CI",
            "storage": {"access": "write", "bucketIds": ["bkt-1", "bkt-2"]},
            "registry": {"access": "push", "repositoryIds": ["repo-1"]},
        }

    def test_sends_only_the_half_given_without_an_id_list(self, client, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": ISSUED}
        )

        client.iam.create(label="CI", registry_access="pull")

        assert json.loads(httpx_mock.get_request().content) == {
            "label": "CI",
            "registry": {"access": "pull"},
        }

    def test_sends_an_empty_id_list_when_given(self, client, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": ISSUED}
        )

        client.iam.create(label="CI", storage_access="read", bucket_ids=[])

        assert json.loads(httpx_mock.get_request().content) == {
            "label": "CI",
            "storage": {"access": "read", "bucketIds": []},
        }

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/iam",
            status_code=201,
            json={"success": True, "data": ISSUED},
        )

        client.iam.create(label="CI", storage_access="read", project_id="proj-2")

        assert httpx_mock.get_request().method == "POST"

    @pytest.mark.parametrize(
        ("kwargs", "message"),
        [
            ({"label": "", "storage_access": "read"}, "label is required"),
            ({"label": "CI"}, "storage or registry is required"),
            (
                {"label": "CI", "bucket_ids": ["bkt-1"]},
                "bucket_ids requires storage_access",
            ),
            (
                {"label": "CI", "storage_access": "read", "repository_ids": ["r-1"]},
                "repository_ids requires registry_access",
            ),
        ],
    )
    def test_rejects_bad_arguments_before_any_request(
        self, client, httpx_mock, kwargs, message
    ):
        with pytest.raises(ValueError, match=message):
            client.iam.create(**kwargs)

        assert httpx_mock.get_requests() == []


class TestAsyncIamCredentialCreate:
    """Tests for issuing an IAM credential through the async client."""

    async def test_issues_a_credential_returning_the_secret_once(self, httpx_mock):
        httpx_mock.add_response(
            url=BASE, status_code=201, json={"success": True, "data": ISSUED}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.iam.create(
                label="CI",
                storage_access="read",
                registry_access="pull",
                repository_ids=["repo-1"],
            )

        assert result == {"success": True, "data": ISSUED}
        request = httpx_mock.get_request()
        assert request.method == "POST"
        assert json.loads(request.content) == {
            "label": "CI",
            "storage": {"access": "read"},
            "registry": {"access": "pull", "repositoryIds": ["repo-1"]},
        }

    async def test_targets_another_project_per_call(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/iam",
            status_code=201,
            json={"success": True, "data": ISSUED},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.iam.create(
                label="CI", registry_access="push", project_id="proj-2"
            )

        assert httpx_mock.get_request().method == "POST"

    async def test_rejects_bad_arguments_before_any_request(self, httpx_mock):
        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(ValueError, match="label is required"):
                await client.iam.create(label="", storage_access="read")
            with pytest.raises(ValueError, match="storage or registry is required"):
                await client.iam.create(label="CI")
            with pytest.raises(ValueError, match="bucket_ids requires storage_access"):
                await client.iam.create(label="CI", bucket_ids=["bkt-1"])
            with pytest.raises(
                ValueError, match="repository_ids requires registry_access"
            ):
                await client.iam.create(
                    label="CI", storage_access="read", repository_ids=["r-1"]
                )

        assert httpx_mock.get_requests() == []
