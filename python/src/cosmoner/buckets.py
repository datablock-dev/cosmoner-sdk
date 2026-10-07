"""Buckets service namespace — a project's object storage buckets."""

from __future__ import annotations

from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _require_bucket_id(bucket_id: str) -> None:
    """Rejects an empty bucket id before it becomes a malformed route."""
    if not bucket_id:
        raise ValueError("bucket_id is required")


#: The only object storage provider buckets are created on.
_PROVIDER = "AWS_S3"


def _create_payload(
    name: str,
    region: str,
    tier: str | None,
    public_access: bool | None,
    versioning: bool | None,
    cdn_enabled: bool | None,
) -> dict[str, Any]:
    """Validates create arguments and shapes them into the API request body."""
    if not name:
        raise ValueError("name is required")
    if not region:
        raise ValueError("region is required")

    payload: dict[str, Any] = {"name": name, "provider": _PROVIDER, "region": region}
    optional = {
        "tier": tier,
        "publicAccess": public_access,
        "versioning": versioning,
        "cdnEnabled": cdn_enabled,
    }
    payload.update({key: value for key, value in optional.items() if value is not None})

    return payload


class BucketsService:
    """Synchronous operations on a project's object storage buckets.

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

    def delete(self, bucket_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Permanently deletes a bucket.

        Every object in it goes too, along with its access credentials.
        """
        _require_bucket_id(bucket_id)

        result: dict[str, Any] = self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{bucket_id}"
        )
        return result

    def preview(
        self, *, tier: str | None = None, project_id: str | None = None
    ) -> dict[str, Any]:
        """Prices a bucket's ``tier`` fee (``STARTER`` unless given) without creating it.

        Only the tier fee is priced: CDN traffic is metered and not included. The
        ``monthly`` charge is exact. ``dueToday`` is an estimate for a project that
        already has a subscription, because the real charge is prorated onto it.
        Amounts are integers in minor units; ``monthly`` excludes tax.
        """
        result: dict[str, Any] = self._transport.request(
            "GET",
            f"{self._base_path(project_id)}/preview",
            params={"provider": _PROVIDER, "tier": "STARTER" if tier is None else tier},
        )
        return result

    def create(
        self,
        *,
        name: str,
        region: str,
        tier: str | None = None,
        public_access: bool | None = None,
        versioning: bool | None = None,
        cdn_enabled: bool | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Creates a bucket, charging the project's saved card immediately.

        The charge is a prorated invoice. A project that cannot be billed is
        refused with 402 (``ORG_PAYMENT_METHOD_REQUIRED``,
        ``BILLER_PAYMENT_METHOD_REQUIRED`` or ``PAYMENT_REQUIRED``) before anything
        is created. Bucket names are unique per project.
        """
        payload = _create_payload(
            name, region, tier, public_access, versioning, cdn_enabled
        )

        result: dict[str, Any] = self._transport.request(
            "POST", self._base_path(project_id), json=payload
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

    async def delete(
        self, bucket_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently deletes a bucket.

        Every object in it goes too, along with its access credentials.
        """
        _require_bucket_id(bucket_id)

        result: dict[str, Any] = await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{bucket_id}"
        )
        return result

    async def preview(
        self, *, tier: str | None = None, project_id: str | None = None
    ) -> dict[str, Any]:
        """Prices a bucket's ``tier`` fee (``STARTER`` unless given) without creating it.

        Only the tier fee is priced: CDN traffic is metered and not included. The
        ``monthly`` charge is exact. ``dueToday`` is an estimate for a project that
        already has a subscription, because the real charge is prorated onto it.
        Amounts are integers in minor units; ``monthly`` excludes tax.
        """
        result: dict[str, Any] = await self._transport.request(
            "GET",
            f"{self._base_path(project_id)}/preview",
            params={"provider": _PROVIDER, "tier": "STARTER" if tier is None else tier},
        )
        return result

    async def create(
        self,
        *,
        name: str,
        region: str,
        tier: str | None = None,
        public_access: bool | None = None,
        versioning: bool | None = None,
        cdn_enabled: bool | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Creates a bucket, charging the project's saved card immediately.

        The charge is a prorated invoice. A project that cannot be billed is
        refused with 402 (``ORG_PAYMENT_METHOD_REQUIRED``,
        ``BILLER_PAYMENT_METHOD_REQUIRED`` or ``PAYMENT_REQUIRED``) before anything
        is created. Bucket names are unique per project.
        """
        payload = _create_payload(
            name, region, tier, public_access, versioning, cdn_enabled
        )

        result: dict[str, Any] = await self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result
