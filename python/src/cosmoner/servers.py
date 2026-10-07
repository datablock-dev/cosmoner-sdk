"""Servers service namespace — a project's virtual servers."""

from __future__ import annotations

from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _require_server_id(server_id: str) -> None:
    """Rejects an empty server id before it becomes a malformed route."""
    if not server_id:
        raise ValueError("server_id is required")


class ServersService:
    """Synchronous read operations on a project's servers."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/servers"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every server in the project."""
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    def get(self, server_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches one server, with the SSH keys installed on it under ``sshKeys``."""
        _require_server_id(server_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{server_id}"
        )
        return result


class AsyncServersService:
    """Asynchronous counterpart to :class:`ServersService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/servers"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every server in the project."""
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    async def get(
        self, server_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one server, with the SSH keys installed on it under ``sshKeys``."""
        _require_server_id(server_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{server_id}"
        )
        return result
