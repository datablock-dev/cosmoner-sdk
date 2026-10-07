"""Redis service namespace — a project's managed Redis databases."""

from __future__ import annotations

from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _require_redis_id(redis_id: str) -> None:
    """Rejects an empty Redis database id before it becomes a malformed route."""
    if not redis_id:
        raise ValueError("redis_id is required")


class RedisService:
    """Synchronous operations on a project's Redis databases."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/redis"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every Redis database in the project, without passwords."""
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    def get(self, redis_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches one Redis database, always with its plaintext ``password``.

        The password needs only the ``redis:read`` scope, so guard the key
        accordingly.
        """
        _require_redis_id(redis_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{redis_id}"
        )
        return result

    def delete(self, redis_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Permanently deletes a Redis database. This cannot be undone."""
        _require_redis_id(redis_id)

        result: dict[str, Any] = self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{redis_id}"
        )
        return result


class AsyncRedisService:
    """Asynchronous counterpart to :class:`RedisService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/redis"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every Redis database in the project, without passwords."""
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    async def get(
        self, redis_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one Redis database, always with its plaintext ``password``.

        The password needs only the ``redis:read`` scope, so guard the key
        accordingly.
        """
        _require_redis_id(redis_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{redis_id}"
        )
        return result

    async def delete(
        self, redis_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently deletes a Redis database. This cannot be undone."""
        _require_redis_id(redis_id)

        result: dict[str, Any] = await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{redis_id}"
        )
        return result
