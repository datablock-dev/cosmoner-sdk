"""SSH keys service namespace — the public keys registered on a project."""

from __future__ import annotations

from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


class SshKeysService:
    """Synchronous read operations on a project's SSH keys."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/ssh-keys"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every SSH key on the project with its fingerprint."""
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result


class AsyncSshKeysService:
    """Asynchronous counterpart to :class:`SshKeysService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/ssh-keys"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every SSH key on the project with its fingerprint."""
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result
