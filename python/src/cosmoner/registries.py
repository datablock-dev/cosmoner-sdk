"""Registries service namespace — a project's container registries."""

from __future__ import annotations

from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _require_registry_id(registry_id: str) -> None:
    """Rejects an empty registry id before it becomes a malformed route."""
    if not registry_id:
        raise ValueError("registry_id is required")


def _create_payload(name: str, region: str, provider: str | None) -> dict[str, Any]:
    """Validates create arguments and shapes them into the API request body."""
    if not name:
        raise ValueError("name is required")
    if not region:
        raise ValueError("region is required")

    payload: dict[str, Any] = {"name": name, "region": region}
    if provider is not None:
        payload["provider"] = provider

    return payload


class RegistriesService:
    """Synchronous operations on a project's container registries."""

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

    def delete(
        self, registry_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently deletes a registry.

        Every repository and image in it goes too.
        """
        _require_registry_id(registry_id)

        result: dict[str, Any] = self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{registry_id}"
        )
        return result

    def preview(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Prices a registry's base fee without creating it.

        Only the base fee is priced: storage and egress are metered and not
        included. The ``monthly`` charge is exact. ``dueToday`` is an estimate for
        a project that already has a subscription, because the real charge is
        prorated onto it. Amounts are integers in minor units; ``monthly``
        excludes tax.
        """
        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/preview"
        )
        return result

    def providers(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists the registry providers on offer, each with the ``regions`` it has."""
        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/providers"
        )
        return result

    def create(
        self,
        *,
        name: str,
        region: str,
        provider: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Creates a registry, charging the project's saved card immediately.

        The charge is a prorated invoice. A project that cannot be billed is
        refused with 402 (``ORG_PAYMENT_METHOD_REQUIRED``,
        ``BILLER_PAYMENT_METHOD_REQUIRED`` or ``PAYMENT_REQUIRED``) before anything
        is created. The response carries the new registry's ``id``.
        """
        payload = _create_payload(name, region, provider)

        result: dict[str, Any] = self._transport.request(
            "POST", self._base_path(project_id), json=payload
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

    async def delete(
        self, registry_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently deletes a registry.

        Every repository and image in it goes too.
        """
        _require_registry_id(registry_id)

        result: dict[str, Any] = await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{registry_id}"
        )
        return result

    async def preview(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Prices a registry's base fee without creating it.

        Only the base fee is priced: storage and egress are metered and not
        included. The ``monthly`` charge is exact. ``dueToday`` is an estimate for
        a project that already has a subscription, because the real charge is
        prorated onto it. Amounts are integers in minor units; ``monthly``
        excludes tax.
        """
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/preview"
        )
        return result

    async def providers(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists the registry providers on offer, each with the ``regions`` it has."""
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/providers"
        )
        return result

    async def create(
        self,
        *,
        name: str,
        region: str,
        provider: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Creates a registry, charging the project's saved card immediately.

        The charge is a prorated invoice. A project that cannot be billed is
        refused with 402 (``ORG_PAYMENT_METHOD_REQUIRED``,
        ``BILLER_PAYMENT_METHOD_REQUIRED`` or ``PAYMENT_REQUIRED``) before anything
        is created. The response carries the new registry's ``id``.
        """
        payload = _create_payload(name, region, provider)

        result: dict[str, Any] = await self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result
