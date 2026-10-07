"""Domains service namespace — a project's domains and their DNS records."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _require_domain(domain: str) -> None:
    """Rejects an empty domain id or name before it becomes a malformed route."""
    if not domain:
        raise ValueError("domain is required")


def _domain_segment(domain: str) -> str:
    """Validates a domain id or name and encodes it as a single path segment."""
    _require_domain(domain)
    # A name is a single path segment, so nothing in it may read as a separator.
    return quote(domain, safe="")


def _create_payload(name: str) -> dict[str, Any]:
    """Validates a domain name and shapes it into the body that adds one you own."""
    if not name:
        raise ValueError("name is required")

    return {"name": name, "type": "EXTERNAL"}


class DomainsService:
    """Synchronous operations on a project's domains."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/domains"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every domain in the project with its DNS records."""
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    def get(self, domain: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches one domain by id or by name, such as ``example.com``."""
        segment = _domain_segment(domain)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{segment}"
        )
        return result

    def create(self, name: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Adds a domain you already own. Buying a domain is not available here.

        The response carries ``verificationRecord`` (``type``, ``name``,
        ``value``): the TXT record to publish before calling :meth:`verify`.
        """
        payload = _create_payload(name)

        result: dict[str, Any] = self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result

    def verify(self, domain: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Checks the verification TXT record of a domain, by id or by name.

        ``status`` is ``ACTIVE`` once verified, or ``PENDING``, possibly with an
        ``error`` saying why the record did not match.
        """
        segment = _domain_segment(domain)

        result: dict[str, Any] = self._transport.request(
            "POST", f"{self._base_path(project_id)}/{segment}/verify"
        )
        return result

    def delete(self, domain: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Permanently removes a domain, by id or by name, from the project.

        The API answers 409 while an app or an email domain still uses it.
        """
        segment = _domain_segment(domain)

        result: dict[str, Any] = self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{segment}"
        )
        return result


class AsyncDomainsService:
    """Asynchronous counterpart to :class:`DomainsService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/domains"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every domain in the project with its DNS records."""
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    async def get(self, domain: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches one domain by id or by name, such as ``example.com``."""
        segment = _domain_segment(domain)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{segment}"
        )
        return result

    async def create(self, name: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Adds a domain you already own. Buying a domain is not available here.

        The response carries ``verificationRecord`` (``type``, ``name``,
        ``value``): the TXT record to publish before calling :meth:`verify`.
        """
        payload = _create_payload(name)

        result: dict[str, Any] = await self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result

    async def verify(
        self, domain: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Checks the verification TXT record of a domain, by id or by name.

        ``status`` is ``ACTIVE`` once verified, or ``PENDING``, possibly with an
        ``error`` saying why the record did not match.
        """
        segment = _domain_segment(domain)

        result: dict[str, Any] = await self._transport.request(
            "POST", f"{self._base_path(project_id)}/{segment}/verify"
        )
        return result

    async def delete(
        self, domain: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently removes a domain, by id or by name, from the project.

        The API answers 409 while an app or an email domain still uses it.
        """
        segment = _domain_segment(domain)

        result: dict[str, Any] = await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{segment}"
        )
        return result
