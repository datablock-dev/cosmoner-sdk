"""Email service namespace — transactional sending through a project's SMTP credential."""

from __future__ import annotations

from typing import Any, Union

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport

Recipients = Union[str, "list[str]"]


def _build_payload(
    credential_id: str,
    to: Recipients,
    subject: str,
    html: str | None,
    text: str | None,
    reply_to: Recipients | None,
) -> dict[str, Any]:
    """Validates send arguments and shapes them into the API request body."""
    if not html and not text:
        raise ValueError("Either html or text must be provided")

    payload: dict[str, Any] = {
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
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def send(
        self,
        credential_id: str,
        to: Recipients,
        subject: str,
        *,
        html: str | None = None,
        text: str | None = None,
        reply_to: Recipients | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Sends a transactional email and returns the API envelope with its message id.

        At least one of ``html`` or ``text`` is required. ``project_id`` overrides
        the client-level default for this call.
        """
        payload = _build_payload(credential_id, to, subject, html, text, reply_to)
        project = resolve_project_id(self._config, project_id)

        result: dict[str, Any] = self._transport.request(
            "POST", f"/v1/projects/{project}/email/send", json=payload
        )
        return result


class AsyncEmailService:
    """Asynchronous counterpart to :class:`EmailService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    async def send(
        self,
        credential_id: str,
        to: Recipients,
        subject: str,
        *,
        html: str | None = None,
        text: str | None = None,
        reply_to: Recipients | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Sends a transactional email and returns the API envelope with its message id.

        At least one of ``html`` or ``text`` is required. ``project_id`` overrides
        the client-level default for this call.
        """
        payload = _build_payload(credential_id, to, subject, html, text, reply_to)
        project = resolve_project_id(self._config, project_id)

        result: dict[str, Any] = await self._transport.request(
            "POST", f"/v1/projects/{project}/email/send", json=payload
        )
        return result
