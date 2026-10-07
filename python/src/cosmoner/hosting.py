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


def _preview_params(tier: str, extra_storage_gb: int) -> dict[str, Any]:
    """Validates preview arguments and shapes them into the query string."""
    if not tier:
        raise ValueError("tier is required")

    return {"tier": tier, "extraStorageGb": extra_storage_gb}


def _create_payload(
    site_name: str,
    tier: str | None,
    php_version: str | None,
    database: str | None,
    extra_storage_gb: int | None,
) -> dict[str, Any]:
    """Validates create arguments and shapes them into the API request body."""
    if not site_name:
        raise ValueError("site_name is required")

    payload: dict[str, Any] = {"siteName": site_name}
    if tier is not None:
        payload["tier"] = tier
    if php_version is not None:
        payload["phpVersion"] = php_version
    if database is not None:
        payload["database"] = {"name": database}
    if extra_storage_gb is not None:
        payload["extraStorageGb"] = extra_storage_gb

    return payload


class HostingService:
    """Synchronous operations on a project's shared hosting sites."""

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

    def delete(self, site_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Permanently deletes a hosting site. This cannot be undone."""
        _require_site_id(site_id)

        result: dict[str, Any] = self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{site_id}"
        )
        return result

    def prices(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists each tier's ``monthly`` price, in minor units, with its ``currency``."""
        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/prices"
        )
        return result

    def preview(
        self,
        *,
        tier: str,
        extra_storage_gb: int = 0,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Prices a site on ``tier``, plus any extra storage, without creating it.

        The ``monthly`` charge is exact. ``dueToday`` is an estimate for a project
        that already has a subscription, because the real charge is prorated onto
        it. Amounts are integers in minor units; ``monthly`` excludes tax.
        """
        params = _preview_params(tier, extra_storage_gb)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/preview", params=params
        )
        return result

    def create(
        self,
        *,
        site_name: str,
        tier: str | None = None,
        php_version: str | None = None,
        database: str | None = None,
        extra_storage_gb: int | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Creates a site, charging the project's saved card immediately.

        The charge is a prorated invoice. A project that cannot be billed is
        refused with 402 (``ORG_PAYMENT_METHOD_REQUIRED``,
        ``BILLER_PAYMENT_METHOD_REQUIRED`` or ``PAYMENT_REQUIRED``) before anything
        is created. ``database`` names a database to create alongside the site.
        The response carries ``tenantId`` and ``status``, plus ``database`` or
        ``databaseError`` when one was asked for.
        """
        payload = _create_payload(
            site_name, tier, php_version, database, extra_storage_gb
        )

        result: dict[str, Any] = self._transport.request(
            "POST", self._base_path(project_id), json=payload
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

    async def delete(
        self, site_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently deletes a hosting site. This cannot be undone."""
        _require_site_id(site_id)

        result: dict[str, Any] = await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{site_id}"
        )
        return result

    async def prices(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists each tier's ``monthly`` price, in minor units, with its ``currency``."""
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/prices"
        )
        return result

    async def preview(
        self,
        *,
        tier: str,
        extra_storage_gb: int = 0,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Prices a site on ``tier``, plus any extra storage, without creating it.

        The ``monthly`` charge is exact. ``dueToday`` is an estimate for a project
        that already has a subscription, because the real charge is prorated onto
        it. Amounts are integers in minor units; ``monthly`` excludes tax.
        """
        params = _preview_params(tier, extra_storage_gb)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/preview", params=params
        )
        return result

    async def create(
        self,
        *,
        site_name: str,
        tier: str | None = None,
        php_version: str | None = None,
        database: str | None = None,
        extra_storage_gb: int | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Creates a site, charging the project's saved card immediately.

        The charge is a prorated invoice. A project that cannot be billed is
        refused with 402 (``ORG_PAYMENT_METHOD_REQUIRED``,
        ``BILLER_PAYMENT_METHOD_REQUIRED`` or ``PAYMENT_REQUIRED``) before anything
        is created. ``database`` names a database to create alongside the site.
        The response carries ``tenantId`` and ``status``, plus ``database`` or
        ``databaseError`` when one was asked for.
        """
        payload = _create_payload(
            site_name, tier, php_version, database, extra_storage_gb
        )

        result: dict[str, Any] = await self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result
