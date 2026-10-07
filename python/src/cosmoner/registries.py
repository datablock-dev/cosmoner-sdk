"""Registries service namespace — a project's container registries."""

from __future__ import annotations

from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _require_registry_id(registry_id: str) -> None:
    """Rejects an empty registry id before it becomes a malformed route."""
    if not registry_id:
        raise ValueError("registry_id is required")


class RegistriesService:
    """Synchronous read operations on a project's container registries."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        project = resolve_project_id(self._config, project_id)
        return f"/v1/projects/{project}/storage/container-registry"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every registry in the project with its repositories."""
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    def get(self, registry_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches one registry with its endpoint and repositories."""
        _require_registry_id(registry_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{registry_id}"
        )
        return result


class AsyncRegistriesService:
    """Asynchronous counterpart to :class:`RegistriesService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        project = resolve_project_id(self._config, project_id)
        return f"/v1/projects/{project}/storage/container-registry"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every registry in the project with its repositories."""
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    async def get(
        self, registry_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one registry with its endpoint and repositories."""
        _require_registry_id(registry_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{registry_id}"
        )
        return result
