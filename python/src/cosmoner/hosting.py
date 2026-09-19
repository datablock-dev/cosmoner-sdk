"""Hosting service namespace — shared web hosting sites and how to reach their files."""

from __future__ import annotations

from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _require_site_id(site_id: str) -> None:
    """Rejects an empty site id before it becomes a malformed route."""
    if not site_id:
        raise ValueError("site_id is required")


def _credentials_params(credentials: bool) -> dict[str, str] | None:
    """Builds the query that asks for the SFTP password, or none when not wanted."""
    return {"credentials": "true"} if credentials else None


class HostingService:
    """Synchronous read operations on a project's shared hosting sites."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        project = resolve_project_id(self._config, project_id)
        return f"/v1/projects/{project}/hosting/shared"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every hosting site in the project that has not been deprovisioned."""
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    def get(
        self, site_id: str, *, credentials: bool = False, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one site, with its ``sftpPassword`` when ``credentials`` is true.

        The password needs only the ``hosting:read`` scope, so guard the key
        accordingly.
        """
        _require_site_id(site_id)

        result: dict[str, Any] = self._transport.request(
            "GET",
            f"{self._base_path(project_id)}/{site_id}",
            params=_credentials_params(credentials),
        )
        return result

    def access(self, site_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches the host, port and username for SFTP and SSH."""
        _require_site_id(site_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{site_id}/access"
        )
        return result


class AsyncHostingService:
    """Asynchronous counterpart to :class:`HostingService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        project = resolve_project_id(self._config, project_id)
        return f"/v1/projects/{project}/hosting/shared"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every hosting site in the project that has not been deprovisioned."""
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    async def get(
        self, site_id: str, *, credentials: bool = False, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one site, with its ``sftpPassword`` when ``credentials`` is true.

        The password needs only the ``hosting:read`` scope, so guard the key
        accordingly.
        """
        _require_site_id(site_id)

        result: dict[str, Any] = await self._transport.request(
            "GET",
            f"{self._base_path(project_id)}/{site_id}",
            params=_credentials_params(credentials),
        )
        return result

    async def access(
        self, site_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches the host, port and username for SFTP and SSH."""
        _require_site_id(site_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{site_id}/access"
        )
        return result
