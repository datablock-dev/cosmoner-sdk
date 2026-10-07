"""Buckets service namespace — a project's object storage buckets."""

from __future__ import annotations

from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


class BucketsService:
    """Synchronous read operations on a project's object storage buckets.

    There is no single-bucket read; filter the list instead.
    """

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        project = resolve_project_id(self._config, project_id)
        return f"/v1/projects/{project}/storage/object-storage"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every bucket in the project with its endpoint and CDN settings."""
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result


class AsyncBucketsService:
    """Asynchronous counterpart to :class:`BucketsService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        project = resolve_project_id(self._config, project_id)
        return f"/v1/projects/{project}/storage/object-storage"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every bucket in the project with its endpoint and CDN settings."""
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result
