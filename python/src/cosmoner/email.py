from __future__ import annotations

from typing import TYPE_CHECKING, Union

import httpx

from .errors import CosmonerError

if TYPE_CHECKING:
    from .client import Cosmoner


class EmailService:
    def __init__(self, client: Cosmoner) -> None:
        self._client = client

    def send(
        self,
        credential_id: str,
        to: Union[str, list[str]],
        subject: str,
        *,
        html: str | None = None,
        text: str | None = None,
        reply_to: Union[str, list[str], None] = None,
    ) -> dict:
        if not html and not text:
            raise ValueError("Either html or text must be provided")

        url = f"{self._client.base_url}/v1/projects/{self._client.project_id}/email/send"

        payload: dict = {
            "credentialId": credential_id,
            "to": to,
            "subject": subject,
        }
        if html is not None:
            payload["html"] = html
        if text is not None:
            payload["text"] = text
        if reply_to is not None:
            payload["replyTo"] = reply_to

        response = httpx.post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {self._client.api_key}",
                "Content-Type": "application/json",
            },
        )

        body = response.json()

        if not response.is_success:
            error = body.get("error", {})
            raise CosmonerError(
                status=response.status_code,
                code=error.get("code", "UNKNOWN"),
                message=error.get("message", "Unknown error"),
            )

        return body
