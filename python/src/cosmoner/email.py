"""Email service namespace — sending domains, and transactional sending through SMTP."""

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


def _require_email_domain_id(email_domain_id: str) -> None:
    """Rejects an empty email domain id before it becomes a malformed route."""
    if not email_domain_id:
        raise ValueError("email_domain_id is required")


class EmailService:
    """Synchronous email operations for a project."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/email"

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

        result: dict[str, Any] = self._transport.request(
            "POST", f"{self._base_path(project_id)}/send", json=payload
        )
        return result

    def list_domains(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists the project's sending domains with their SMTP credentials."""
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    def get_domain(
        self, email_domain_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one sending domain, adding whether it can send under ``sending``."""
        _require_email_domain_id(email_domain_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{email_domain_id}"
        )
        return result


class AsyncEmailService:
    """Asynchronous counterpart to :class:`EmailService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/email"

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

        result: dict[str, Any] = await self._transport.request(
            "POST", f"{self._base_path(project_id)}/send", json=payload
        )
        return result

    async def list_domains(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists the project's sending domains with their SMTP credentials."""
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    async def get_domain(
        self, email_domain_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one sending domain, adding whether it can send under ``sending``."""
        _require_email_domain_id(email_domain_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{email_domain_id}"
        )
        return result
