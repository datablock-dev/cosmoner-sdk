"""Projects service namespace — the projects an API key can see, across the account."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from ._config import ClientConfig
from ._transport import AsyncTransport, Transport

_BASE_PATH = "/v1/projects"


def _require_project(project: str) -> None:
    """Rejects an empty project id or slug before it becomes a malformed route."""
    if not project:
        raise ValueError("project is required")


def _update_payload(name: str) -> dict[str, Any]:
    """Validates update arguments and shapes them into the API request body."""
    if not name:
        raise ValueError("name is required")

    return {"name": name}


def _project_path(project: str) -> str:
    """Builds the route for one project, encoding a slug a person may have typed."""
    return f"{_BASE_PATH}/{quote(project, safe='')}"


class ProjectsService:
    """Synchronous account-level project operations.

    Unlike every other namespace this one never falls back to the client's
    default project: the project is the thing being acted on, not the scope.
    """

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def list(self) -> dict[str, Any]:
        """Lists every project the key can see, with per-project resource counts."""
        result: dict[str, Any] = self._transport.request("GET", _BASE_PATH)
        return result

    def get(self, project: str) -> dict[str, Any]:
        """Fetches one project by id or slug, with its resource counts."""
        _require_project(project)

        result: dict[str, Any] = self._transport.request("GET", _project_path(project))
        return result

    def update(self, project: str, *, name: str) -> dict[str, Any]:
        """Renames a project by id or slug and returns it.

        ``name`` is 1-100 characters. Owners and admins only, otherwise 403;
        409 when the caller already has a project of that name.
        """
        _require_project(project)
        payload = _update_payload(name)

        result: dict[str, Any] = self._transport.request(
            "PATCH", _project_path(project), json=payload
        )
        return result

    def delete(self, project: str) -> dict[str, Any]:
        """Permanently deletes a project by id or slug. This cannot be undone.

        Owner only. Refused with 409 while the project still holds resources
        (servers, apps, databases, ...): delete those first.
        """
        _require_project(project)

        result: dict[str, Any] = self._transport.request("DELETE", _project_path(project))
        return result


class AsyncProjectsService:
    """Asynchronous counterpart to :class:`ProjectsService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    async def list(self) -> dict[str, Any]:
        """Lists every project the key can see, with per-project resource counts."""
        result: dict[str, Any] = await self._transport.request("GET", _BASE_PATH)
        return result

    async def get(self, project: str) -> dict[str, Any]:
        """Fetches one project by id or slug, with its resource counts."""
        _require_project(project)

        result: dict[str, Any] = await self._transport.request(
            "GET", _project_path(project)
        )
        return result

    async def update(self, project: str, *, name: str) -> dict[str, Any]:
        """Renames a project by id or slug and returns it.

        ``name`` is 1-100 characters. Owners and admins only, otherwise 403;
        409 when the caller already has a project of that name.
        """
        _require_project(project)
        payload = _update_payload(name)

        result: dict[str, Any] = await self._transport.request(
            "PATCH", _project_path(project), json=payload
        )
        return result

    async def delete(self, project: str) -> dict[str, Any]:
        """Permanently deletes a project by id or slug. This cannot be undone.

        Owner only. Refused with 409 while the project still holds resources
        (servers, apps, databases, ...): delete those first.
        """
        _require_project(project)

        result: dict[str, Any] = await self._transport.request(
            "DELETE", _project_path(project)
        )
        return result
