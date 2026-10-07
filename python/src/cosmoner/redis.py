"""Redis service namespace — a project's managed Redis databases."""

from __future__ import annotations

from typing import Any, Literal

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport

#: How a Redis database persists its data to disk, if at all.
RedisPersistence = Literal[
    "NONE",
    "AOF_EVERY_WRITE",
    "AOF_EVERY_1_SECOND",
    "SNAPSHOT_EVERY_1_HOUR",
    "SNAPSHOT_EVERY_6_HOURS",
    "SNAPSHOT_EVERY_12_HOURS",
]


def _require_redis_id(redis_id: str) -> None:
    """Rejects an empty Redis database id before it becomes a malformed route."""
    if not redis_id:
        raise ValueError("redis_id is required")


def _require_plan(plan: str) -> None:
    """Rejects an empty plan slug before it spends a request."""
    if not plan:
        raise ValueError("plan is required")


def _create_payload(
    name: str, plan: str, region: str, persistence: RedisPersistence | None
) -> dict[str, Any]:
    """Validates create arguments and shapes them into the API request body."""
    if not name:
        raise ValueError("name is required")
    _require_plan(plan)
    if not region:
        raise ValueError("region is required")

    payload: dict[str, Any] = {"name": name, "planSlug": plan, "region": region}
    if persistence is not None:
        payload["dataPersistence"] = persistence

    return payload


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

    def preview(self, *, plan: str, project_id: str | None = None) -> dict[str, Any]:
        """Prices a Redis database on ``plan`` without creating it.

        The ``monthly`` charge is exact. ``dueToday`` is an estimate for a project
        that already has a subscription, because the real charge is prorated onto
        it. Amounts are integers in minor units; ``monthly`` excludes tax.
        """
        _require_plan(plan)

        result: dict[str, Any] = self._transport.request(
            "GET",
            f"{self._base_path(project_id)}/preview",
            params={"planSlug": plan},
        )
        return result

    def create(
        self,
        *,
        name: str,
        plan: str,
        region: str,
        persistence: RedisPersistence | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Creates a Redis database, charging the project's saved card immediately.

        The charge is a prorated invoice. A project that cannot be billed is
        refused with 402 (``ORG_PAYMENT_METHOD_REQUIRED``,
        ``BILLER_PAYMENT_METHOD_REQUIRED`` or ``PAYMENT_REQUIRED``) before anything
        is created. The response carries no id: list the databases and match by
        name. The database starts ``CREATING``.
        """
        payload = _create_payload(name, plan, region, persistence)

        result: dict[str, Any] = self._transport.request(
            "POST", self._base_path(project_id), json=payload
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

    async def preview(
        self, *, plan: str, project_id: str | None = None
    ) -> dict[str, Any]:
        """Prices a Redis database on ``plan`` without creating it.

        The ``monthly`` charge is exact. ``dueToday`` is an estimate for a project
        that already has a subscription, because the real charge is prorated onto
        it. Amounts are integers in minor units; ``monthly`` excludes tax.
        """
        _require_plan(plan)

        result: dict[str, Any] = await self._transport.request(
            "GET",
            f"{self._base_path(project_id)}/preview",
            params={"planSlug": plan},
        )
        return result

    async def create(
        self,
        *,
        name: str,
        plan: str,
        region: str,
        persistence: RedisPersistence | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Creates a Redis database, charging the project's saved card immediately.

        The charge is a prorated invoice. A project that cannot be billed is
        refused with 402 (``ORG_PAYMENT_METHOD_REQUIRED``,
        ``BILLER_PAYMENT_METHOD_REQUIRED`` or ``PAYMENT_REQUIRED``) before anything
        is created. The response carries no id: list the databases and match by
        name. The database starts ``CREATING``.
        """
        payload = _create_payload(name, plan, region, persistence)

        result: dict[str, Any] = await self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result
