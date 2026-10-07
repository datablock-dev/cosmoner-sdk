import pytest

from cosmoner import AsyncCosmoner, Cosmoner

BASE = "https://api.test.dev/v1/projects/proj-1/members"

MEMBERS = {
    "orgId": "org-1",
    "currentUserId": "user-1",
    "billerUserId": "user-1",
    "pendingBillerUserId": None,
    "members": [
        {
            "id": "mem-1",
            "userId": "user-1",
            "role": "OWNER",
            "createdAt": "2026-09-01T12:00:00.000Z",
            "user": {"name": "Ada", "email": "ada@acme.test", "image": None},
        }
    ],
    "pendingInvitations": [
        {
            "id": "inv-1",
            "email": "bob@acme.test",
            "role": "MEMBER",
            "expiresAt": "2026-10-14T12:00:00.000Z",
        }
    ],
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


class TestMembersValidation:
    """Tests for client-side argument validation."""

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.members.list()


class TestMembers:
    """Tests for member reads via mocked HTTP."""

    def test_lists_members_and_invitations(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": MEMBERS})

        result = client.members.list()

        assert result["data"] == MEMBERS
        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert request.url.query == b""

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/members",
            json={"success": True, "data": MEMBERS},
        )

        client.members.list(project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)


class TestAsyncMembers:
    """Tests for the async member namespace."""

    async def test_lists_members_and_invitations(self, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": MEMBERS})

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.members.list()

        assert result["data"] == MEMBERS

    async def test_targets_another_project_per_call(self, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/members",
            json={"success": True, "data": MEMBERS},
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            await client.members.list(project_id="proj-2")

        assert "proj-2" in str(httpx_mock.get_request().url)
