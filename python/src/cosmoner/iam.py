"""IAM service namespace — the storage access credentials issued for a project."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from urllib.parse import quote

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _require_iam_user_name(iam_user_name: str) -> None:
    """Rejects an empty IAM user name before it becomes a malformed route."""
    if not iam_user_name:
        raise ValueError("iam_user_name is required")


def _create_payload(
    label: str,
    storage_access: str | None,
    bucket_ids: Sequence[str] | None,
    registry_access: str | None,
    repository_ids: Sequence[str] | None,
) -> dict[str, Any]:
    """Validates create arguments and nests them into the API request body.

    A half is sent only when its access is given, and its id list only when that
    is given too; ids without their access are refused rather than dropped.
    """
    if not label:
        raise ValueError("label is required")
    if bucket_ids is not None and storage_access is None:
        raise ValueError("bucket_ids requires storage_access")
    if repository_ids is not None and registry_access is None:
        raise ValueError("repository_ids requires registry_access")
    if storage_access is None and registry_access is None:
        raise ValueError("storage or registry is required")

    payload: dict[str, Any] = {"label": label}
    if storage_access is not None:
        storage: dict[str, Any] = {"access": storage_access}
        if bucket_ids is not None:
            storage["bucketIds"] = list(bucket_ids)
        payload["storage"] = storage
    if registry_access is not None:
        registry: dict[str, Any] = {"access": registry_access}
        if repository_ids is not None:
            registry["repositoryIds"] = list(repository_ids)
        payload["registry"] = registry

    return payload


class IamService:
    """Synchronous operations on a project's IAM credentials."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/iam"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists the project's credentials under ``credentials``.

        Lookups that failed for part of the project are reported as messages
        under ``errors`` rather than failing the whole call.
        """
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    def get(self, iam_user_name: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches one credential by its IAM user name."""
        _require_iam_user_name(iam_user_name)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{quote(iam_user_name, safe='')}"
        )
        return result

    def create(
        self,
        *,
        label: str,
        storage_access: str | None = None,
        bucket_ids: Sequence[str] | None = None,
        registry_access: str | None = None,
        repository_ids: Sequence[str] | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Issues a credential for the project's buckets, registries, or both.

        ``label`` is 1-20 characters. ``storage_access`` is ``"read"`` or
        ``"write"`` and ``registry_access`` is ``"pull"`` or ``"push"``; at least
        one is required. Omitting ``bucket_ids`` or ``repository_ids``, or passing
        an empty list, grants every bucket or repository, including ones created
        later. Ids passed without their access raise ``ValueError``.

        ``secretAccessKey`` in the response is returned exactly once: store it now;
        it cannot be read again.
        """
        payload = _create_payload(
            label, storage_access, bucket_ids, registry_access, repository_ids
        )

        result: dict[str, Any] = self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result

    def delete(self, iam_user_name: str, *, project_id: str | None = None) -> None:
        """Permanently deletes a credential. This cannot be undone.

        The API answers 204, so nothing is returned.
        """
        _require_iam_user_name(iam_user_name)

        self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{quote(iam_user_name, safe='')}"
        )


class AsyncIamService:
    """Asynchronous counterpart to :class:`IamService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/iam"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists the project's credentials under ``credentials``.

        Lookups that failed for part of the project are reported as messages
        under ``errors`` rather than failing the whole call.
        """
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    async def get(
        self, iam_user_name: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one credential by its IAM user name."""
        _require_iam_user_name(iam_user_name)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{quote(iam_user_name, safe='')}"
        )
        return result

    async def create(
        self,
        *,
        label: str,
        storage_access: str | None = None,
        bucket_ids: Sequence[str] | None = None,
        registry_access: str | None = None,
        repository_ids: Sequence[str] | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Issues a credential for the project's buckets, registries, or both.

        ``label`` is 1-20 characters. ``storage_access`` is ``"read"`` or
        ``"write"`` and ``registry_access`` is ``"pull"`` or ``"push"``; at least
        one is required. Omitting ``bucket_ids`` or ``repository_ids``, or passing
        an empty list, grants every bucket or repository, including ones created
        later. Ids passed without their access raise ``ValueError``.

        ``secretAccessKey`` in the response is returned exactly once: store it now;
        it cannot be read again.
        """
        payload = _create_payload(
            label, storage_access, bucket_ids, registry_access, repository_ids
        )

        result: dict[str, Any] = await self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result

    async def delete(self, iam_user_name: str, *, project_id: str | None = None) -> None:
        """Permanently deletes a credential. This cannot be undone.

        The API answers 204, so nothing is returned.
        """
        _require_iam_user_name(iam_user_name)

        await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{quote(iam_user_name, safe='')}"
        )
