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


class DomainsService:
    """Synchronous read operations on a project's domains."""

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
        _require_domain(domain)
        # A name is a single path segment, so nothing in it may read as a separator.
        segment = quote(domain, safe="")

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{segment}"
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
        _require_domain(domain)
        # A name is a single path segment, so nothing in it may read as a separator.
        segment = quote(domain, safe="")

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{segment}"
        )
        return result
