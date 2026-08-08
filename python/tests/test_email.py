import json

import pytest

from cosmoner import AsyncCosmoner, Cosmoner, CosmonerError, RateLimitError

URL = "https://api.test.dev/v1/projects/proj-1/email/send"


@pytest.fixture()
def client():
    """Provide a Cosmoner client configured for testing, with retries disabled."""
    return Cosmoner(
        api_key="key-123",
        project_id="proj-1",
        base_url="https://api.test.dev",
        max_retries=0,
    )


class TestEmailValidation:
    """Tests for email parameter validation."""

    def test_raises_when_neither_html_nor_text_provided(self, client):
        with pytest.raises(ValueError, match="Either html or text must be provided"):
            client.email.send(credential_id="cred-1", to="user@test.com", subject="Hello")

    def test_raises_when_no_project_id_is_available(self):
        client = Cosmoner(api_key="key-123", max_retries=0)
        with pytest.raises(ValueError, match="project_id is required"):
            client.email.send(
                credential_id="cred-1", to="user@test.com", subject="Hi", text="body"
            )


class TestEmailSend:
    """Tests for email sending via mocked HTTP."""

    def test_sends_email_successfully(self, client, httpx_mock):
        httpx_mock.add_response(
            url=URL, json={"success": True, "data": {"messageId": "msg-abc"}}
        )

        result = client.email.send(
            credential_id="cred-1",
            to="user@test.com",
            subject="Test",
            text="Hello world",
        )

        assert result == {"success": True, "data": {"messageId": "msg-abc"}}

        request = httpx_mock.get_request()
        assert str(request.url) == URL
        assert request.method == "POST"
        assert request.headers["authorization"] == "Bearer key-123"
        assert request.headers["content-type"] == "application/json"

    def test_sends_sdk_user_agent_and_idempotency_key(self, client, httpx_mock):
        httpx_mock.add_response(url=URL, json={"success": True, "data": {}})

        client.email.send(
            credential_id="cred-1", to="user@test.com", subject="Test", text="body"
        )

        request = httpx_mock.get_request()
        assert request.headers["user-agent"].startswith("cosmoner-python/")
        assert request.headers["idempotency-key"]

    def test_sends_correct_payload_with_all_fields(self, client, httpx_mock):
        httpx_mock.add_response(
            url=URL, json={"success": True, "data": {"messageId": "msg-def"}}
        )

        client.email.send(
            credential_id="cred-1",
            to=["a@test.com", "b@test.com"],
            subject="Test",
            html="<h1>Hi</h1>",
            text="Hi",
            reply_to="reply@test.com",
        )

        body = json.loads(httpx_mock.get_request().content)
        assert body["credentialId"] == "cred-1"
        assert body["to"] == ["a@test.com", "b@test.com"]
        assert body["subject"] == "Test"
        assert body["html"] == "<h1>Hi</h1>"
        assert body["text"] == "Hi"
        assert body["replyTo"] == "reply@test.com"

    def test_omits_optional_fields_when_none(self, client, httpx_mock):
        httpx_mock.add_response(
            url=URL, json={"success": True, "data": {"messageId": "msg-ghi"}}
        )

        client.email.send(
            credential_id="cred-1", to="user@test.com", subject="Test", text="body"
        )

        body = json.loads(httpx_mock.get_request().content)
        assert "html" not in body
        assert "replyTo" not in body

    def test_per_call_project_id_overrides_client_default(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/email/send",
            json={"success": True, "data": {}},
        )

        client.email.send(
            credential_id="cred-1",
            to="user@test.com",
            subject="Test",
            text="body",
            project_id="proj-2",
        )

        assert "proj-2" in str(httpx_mock.get_request().url)

    def test_raises_cosmoner_error_on_api_failure(self, client, httpx_mock):
        httpx_mock.add_response(
            url=URL,
            status_code=429,
            json={
                "success": False,
                "error": {"code": "RATE_LIMITED", "message": "Too many requests"},
            },
        )

        with pytest.raises(RateLimitError) as exc_info:
            client.email.send(
                credential_id="cred-1", to="user@test.com", subject="Test", text="body"
            )

        err = exc_info.value
        assert err.status == 429
        assert err.code == "RATE_LIMITED"
        assert str(err) == "Too many requests"

    def test_handles_error_response_with_missing_fields(self, client, httpx_mock):
        httpx_mock.add_response(url=URL, status_code=500, json={})

        with pytest.raises(CosmonerError) as exc_info:
            client.email.send(
                credential_id="cred-1", to="user@test.com", subject="Test", text="body"
            )

        err = exc_info.value
        assert err.status == 500
        assert err.code == "UNKNOWN"
        assert str(err) == "Unknown error"

    def test_surfaces_validation_details(self, client, httpx_mock):
        httpx_mock.add_response(
            url=URL,
            status_code=422,
            json={
                "success": False,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Invalid input",
                    "details": {"to": "must be an email"},
                },
            },
        )

        with pytest.raises(CosmonerError) as exc_info:
            client.email.send(
                credential_id="cred-1", to="bad", subject="Test", text="body"
            )

        assert exc_info.value.details == {"to": "must be an email"}


class TestAsyncEmailSend:
    """Tests for the async email service."""

    async def test_sends_email_successfully(self, httpx_mock):
        httpx_mock.add_response(
            url=URL, json={"success": True, "data": {"messageId": "msg-async"}}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            result = await client.email.send(
                credential_id="cred-1",
                to="user@test.com",
                subject="Test",
                text="Hello world",
            )

        assert result == {"success": True, "data": {"messageId": "msg-async"}}

    async def test_raises_mapped_error(self, httpx_mock):
        httpx_mock.add_response(
            url=URL,
            status_code=401,
            json={
                "success": False,
                "error": {"code": "INVALID_API_KEY", "message": "Invalid API key"},
            },
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            with pytest.raises(CosmonerError) as exc_info:
                await client.email.send(
                    credential_id="cred-1",
                    to="user@test.com",
                    subject="Test",
                    text="body",
                )

        assert exc_info.value.status == 401
