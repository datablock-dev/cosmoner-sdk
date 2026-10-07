"""Databases service namespace — a project's dedicated and shared PostgreSQL databases."""

from __future__ import annotations

from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _require_database_id(database_id: str) -> None:
    """Rejects an empty dedicated database id before it becomes a malformed route."""
    if not database_id:
        raise ValueError("database_id is required")


def _require_tenant_id(tenant_id: str) -> None:
    """Rejects an empty shared tenant id before it becomes a malformed route."""
    if not tenant_id:
        raise ValueError("tenant_id is required")


class DatabasesService:
    """Synchronous operations on a project's databases."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/databases"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists a summary of every database in the project, of every kind.

        Each entry's ``kind`` is ``DEDICATED`` or ``LEGACY_POOLED`` and says
        which of ``dedicated`` or ``pooled`` carries its sizing.
        """
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    def list_dedicated(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists the project's dedicated database clusters."""
        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/dedicated"
        )
        return result

    def get_dedicated(
        self, database_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one dedicated cluster, always with its ``connectionUri``.

        ``connectionUri`` is a full connection URI including the password, and
        needs only the ``databases:read`` scope, so guard the key accordingly.
        """
        _require_database_id(database_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/dedicated/{database_id}"
        )
        return result

    def list_shared(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists the project's tenants on shared database clusters."""
        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/shared"
        )
        return result

    def get_shared(
        self, tenant_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one shared database tenant with its host and pooler details."""
        _require_tenant_id(tenant_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/shared/{tenant_id}"
        )
        return result

    def delete_dedicated(
        self, database_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently deletes a dedicated database cluster. This cannot be undone."""
        _require_database_id(database_id)

        result: dict[str, Any] = self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/dedicated/{database_id}"
        )
        return result

    def delete_shared(
        self, tenant_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently deletes a shared database tenant. This cannot be undone."""
        _require_tenant_id(tenant_id)

        result: dict[str, Any] = self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/shared/{tenant_id}"
        )
        return result


class AsyncDatabasesService:
    """Asynchronous counterpart to :class:`DatabasesService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/databases"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists a summary of every database in the project, of every kind.

        Each entry's ``kind`` is ``DEDICATED`` or ``LEGACY_POOLED`` and says
        which of ``dedicated`` or ``pooled`` carries its sizing.
        """
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    async def list_dedicated(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists the project's dedicated database clusters."""
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/dedicated"
        )
        return result

    async def get_dedicated(
        self, database_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one dedicated cluster, always with its ``connectionUri``.

        ``connectionUri`` is a full connection URI including the password, and
        needs only the ``databases:read`` scope, so guard the key accordingly.
        """
        _require_database_id(database_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/dedicated/{database_id}"
        )
        return result

    async def list_shared(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists the project's tenants on shared database clusters."""
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/shared"
        )
        return result

    async def get_shared(
        self, tenant_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one shared database tenant with its host and pooler details."""
        _require_tenant_id(tenant_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/shared/{tenant_id}"
        )
        return result

    async def delete_dedicated(
        self, database_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently deletes a dedicated database cluster. This cannot be undone."""
        _require_database_id(database_id)

        result: dict[str, Any] = await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/dedicated/{database_id}"
        )
        return result

    async def delete_shared(
        self, tenant_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently deletes a shared database tenant. This cannot be undone."""
        _require_tenant_id(tenant_id)

        result: dict[str, Any] = await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/shared/{tenant_id}"
        )
        return result
