import pytest
import httpx

from datablock import Datablock, DatablockError


@pytest.fixture()
def client():
    """Provide a Datablock client configured for testing."""
    return Datablock(
        api_key="key-123",
        project_id="proj-1",
        base_url="https://api.test.dev",
    )


class TestEmailValidation:
    """Tests for email parameter validation."""

    def test_raises_when_neither_html_nor_text_provided(self, client):
        with pytest.raises(ValueError, match="Either html or text must be provided"):
            client.email.send(credential_id="cred-1", to="user@test.com", subject="Hello")


class TestEmailSend:
    """Tests for email sending via mocked HTTP."""

    def test_sends_email_successfully(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-1/email/send",
            json={"success": True, "data": {"messageId": "msg-abc"}},
        )

        result = client.email.send(
            credential_id="cred-1",
            to="user@test.com",
            subject="Test",
            text="Hello world",
        )

        assert result == {"success": True, "data": {"messageId": "msg-abc"}}

        request = httpx_mock.get_request()
        assert request.url == "https://api.test.dev/v1/projects/proj-1/email/send"
        assert request.method == "POST"
        assert request.headers["authorization"] == "Bearer key-123"
        assert request.headers["content-type"] == "application/json"

    def test_sends_correct_payload_with_all_fields(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-1/email/send",
            json={"success": True, "data": {"messageId": "msg-def"}},
        )

        client.email.send(
            credential_id="cred-1",
            to=["a@test.com", "b@test.com"],
            subject="Test",
            html="<h1>Hi</h1>",
            text="Hi",
            reply_to="reply@test.com",
        )

        import json

        request = httpx_mock.get_request()
        body = json.loads(request.content)
        assert body["credentialId"] == "cred-1"
        assert body["to"] == ["a@test.com", "b@test.com"]
        assert body["subject"] == "Test"
        assert body["html"] == "<h1>Hi</h1>"
        assert body["text"] == "Hi"
        assert body["replyTo"] == "reply@test.com"

    def test_omits_optional_fields_when_none(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-1/email/send",
            json={"success": True, "data": {"messageId": "msg-ghi"}},
        )

        client.email.send(
            credential_id="cred-1",
            to="user@test.com",
            subject="Test",
            text="body",
        )

        import json

        body = json.loads(httpx_mock.get_request().content)
        assert "html" not in body
        assert "replyTo" not in body

    def test_raises_datablock_error_on_api_failure(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-1/email/send",
            status_code=429,
            json={
                "success": False,
                "error": {"code": "RATE_LIMITED", "message": "Too many requests"},
            },
        )

        with pytest.raises(DatablockError) as exc_info:
            client.email.send(
                credential_id="cred-1",
                to="user@test.com",
                subject="Test",
                text="body",
            )

        err = exc_info.value
        assert err.status == 429
        assert err.code == "RATE_LIMITED"
        assert str(err) == "Too many requests"

    def test_handles_error_response_with_missing_fields(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-1/email/send",
            status_code=500,
            json={},
        )

        with pytest.raises(DatablockError) as exc_info:
            client.email.send(
                credential_id="cred-1",
                to="user@test.com",
                subject="Test",
                text="body",
            )

        err = exc_info.value
        assert err.status == 500
        assert err.code == "UNKNOWN"
        assert str(err) == "Unknown error"
