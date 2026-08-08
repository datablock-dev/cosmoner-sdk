"""Email service namespace — transactional sending through a project's SMTP credential."""

from __future__ import annotations

from typing import Any, Dict, Optional, Union

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport

Recipients = Union[str, "list[str]"]


def _build_payload(
    credential_id: str,
    to: Recipients,
    subject: str,
    html: Optional[str],
    text: Optional[str],
    reply_to: Optional[Recipients],
) -> Dict[str, Any]:
    """Validates send arguments and shapes them into the API request body."""
    if not html and not text:
        raise ValueError("Either html or text must be provided")

    payload: Dict[str, Any] = {
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

    return payload


class EmailService:
    """Synchronous email operations for a project."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        self._transport = transport
        self._config = config

    def send(
        self,
        credential_id: str,
        to: Recipients,
        subject: str,
        *,
        html: Optional[str] = None,
        text: Optional[str] = None,
        reply_to: Optional[Recipients] = None,
        project_id: Optional[str] = None,
    ) -> dict:
        """
        Sends a transactional email and returns the API envelope with its message id.

        At least one of ``html`` or ``text`` is required. ``project_id`` overrides
        the client-level default for this call.
        """
        payload = _build_payload(credential_id, to, subject, html, text, reply_to)
        project = resolve_project_id(self._config, project_id)

        return self._transport.request(
            "POST", f"/v1/projects/{project}/email/send", json=payload
        )


class AsyncEmailService:
    """Asynchronous counterpart to :class:`EmailService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        self._transport = transport
        self._config = config

    async def send(
        self,
        credential_id: str,
        to: Recipients,
        subject: str,
        *,
        html: Optional[str] = None,
        text: Optional[str] = None,
        reply_to: Optional[Recipients] = None,
        project_id: Optional[str] = None,
    ) -> dict:
        """
        Sends a transactional email and returns the API envelope with its message id.

        At least one of ``html`` or ``text`` is required. ``project_id`` overrides
        the client-level default for this call.
        """
        payload = _build_payload(credential_id, to, subject, html, text, reply_to)
        project = resolve_project_id(self._config, project_id)

        return await self._transport.request(
            "POST", f"/v1/projects/{project}/email/send", json=payload
        )
