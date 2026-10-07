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


class ProjectsService:
    """Synchronous account-level project reads.

    Unlike every other namespace this one never falls back to the client's
    default project: the project is the thing being read, not the scope.
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

        result: dict[str, Any] = self._transport.request(
            "GET", f"{_BASE_PATH}/{quote(project, safe='')}"
        )
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
            "GET", f"{_BASE_PATH}/{quote(project, safe='')}"
        )
        return result
