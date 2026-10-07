"""IAM service namespace — the storage access credentials issued for a project."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _require_iam_user_name(iam_user_name: str) -> None:
    """Rejects an empty IAM user name before it becomes a malformed route."""
    if not iam_user_name:
        raise ValueError("iam_user_name is required")


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

    async def delete(self, iam_user_name: str, *, project_id: str | None = None) -> None:
        """Permanently deletes a credential. This cannot be undone.

        The API answers 204, so nothing is returned.
        """
        _require_iam_user_name(iam_user_name)

        await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{quote(iam_user_name, safe='')}"
        )
