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


def _require_credential_id(credential_id: str) -> None:
    """Rejects an empty SMTP credential id before it becomes a malformed route."""
    if not credential_id:
        raise ValueError("credential_id is required")


def _credential_payload(label: str, from_address: str) -> dict[str, Any]:
    """Validates credential arguments and shapes them into the API request body."""
    if not label:
        raise ValueError("label is required")
    if not from_address:
        raise ValueError("from_address is required")

    return {"label": label, "fromAddress": from_address}


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

    def delete_domain(
        self, email_domain_id: str, *, project_id: str | None = None
    ) -> None:
        """Permanently removes a sending domain. This cannot be undone.

        The API answers 204, so nothing is returned.
        """
        _require_email_domain_id(email_domain_id)

        self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{email_domain_id}"
        )

    def create_credential(
        self,
        email_domain_id: str,
        *,
        label: str,
        from_address: str,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Issues an SMTP credential that sends from ``from_address``.

        ``from_address`` must be an address on the domain. ``smtpPassword`` in the
        response is returned exactly once: store it now; it cannot be read again.
        """
        _require_email_domain_id(email_domain_id)
        payload = _credential_payload(label, from_address)

        result: dict[str, Any] = self._transport.request(
            "POST",
            f"{self._base_path(project_id)}/{email_domain_id}/credentials",
            json=payload,
        )
        return result

    def delete_credential(
        self, email_domain_id: str, credential_id: str, *, project_id: str | None = None
    ) -> None:
        """Permanently revokes an SMTP credential. This cannot be undone.

        Anything still sending with it stops working. The API answers 204, so
        nothing is returned.
        """
        _require_email_domain_id(email_domain_id)
        _require_credential_id(credential_id)

        self._transport.request(
            "DELETE",
            f"{self._base_path(project_id)}/{email_domain_id}/credentials/{credential_id}",
        )


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

    async def delete_domain(
        self, email_domain_id: str, *, project_id: str | None = None
    ) -> None:
        """Permanently removes a sending domain. This cannot be undone.

        The API answers 204, so nothing is returned.
        """
        _require_email_domain_id(email_domain_id)

        await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{email_domain_id}"
        )

    async def create_credential(
        self,
        email_domain_id: str,
        *,
        label: str,
        from_address: str,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Issues an SMTP credential that sends from ``from_address``.

        ``from_address`` must be an address on the domain. ``smtpPassword`` in the
        response is returned exactly once: store it now; it cannot be read again.
        """
        _require_email_domain_id(email_domain_id)
        payload = _credential_payload(label, from_address)

        result: dict[str, Any] = await self._transport.request(
            "POST",
            f"{self._base_path(project_id)}/{email_domain_id}/credentials",
            json=payload,
        )
        return result

    async def delete_credential(
        self, email_domain_id: str, credential_id: str, *, project_id: str | None = None
    ) -> None:
        """Permanently revokes an SMTP credential. This cannot be undone.

        Anything still sending with it stops working. The API answers 204, so
        nothing is returned.
        """
        _require_email_domain_id(email_domain_id)
        _require_credential_id(credential_id)

        await self._transport.request(
            "DELETE",
            f"{self._base_path(project_id)}/{email_domain_id}/credentials/{credential_id}",
        )
