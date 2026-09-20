"""Variables service namespace — non-sensitive configuration, held in plaintext."""

from __future__ import annotations

import re
from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport

_NAME_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")
_MAX_NAME_LENGTH = 100
_MAX_VALUE_LENGTH = 10_000


def _require_variable_id(variable_id: str) -> None:
    """Rejects an empty variable id before it becomes a malformed route."""
    if not variable_id:
        raise ValueError("variable_id is required")


def _require_name(name: str) -> None:
    """Rejects a name the API would reject, using the message the API would send."""
    if not name:
        raise ValueError("name is required")
    if not _NAME_PATTERN.match(name):
        raise ValueError(
            "Name must be uppercase letters, numbers, or underscores, "
            "and start with a letter (e.g. LOG_LEVEL)"
        )
    if len(name) > _MAX_NAME_LENGTH:
        raise ValueError(f"name must be at most {_MAX_NAME_LENGTH} characters")


def _require_value(value: str) -> None:
    """Rejects a value the API would reject."""
    if not value:
        raise ValueError("value is required")
    if len(value) > _MAX_VALUE_LENGTH:
        raise ValueError(f"value must be at most {_MAX_VALUE_LENGTH} characters")


def _environment_params(environment: str | None) -> dict[str, str] | None:
    """Builds the query that scopes a list to one environment, or none for all."""
    return {"environment": environment} if environment else None


def _update_body(value: str | None, description: str | None) -> dict[str, Any]:
    """Builds an update body, rejecting a call that would change nothing."""
    if value is None and description is None:
        raise ValueError("Provide a value or description to update")
    if value is not None:
        _require_value(value)

    body: dict[str, Any] = {}
    if value is not None:
        body["value"] = value
    if description is not None:
        body["description"] = description
    return body


class VariablesService:
    """Synchronous management of a project's variables.

    Reads need the ``variables:read`` scope. Writes need ``variables:write``
    *and* an owner or admin: the API checks the member's role independently of
    the key's scopes, so a plain member's key is refused even when it carries
    the scope.

    Unlike a secret, a variable's value is returned in full on every read. That
    is the difference between the two resources — anything worth hiding belongs
    in :class:`~cosmoner.secrets.SecretsService`.
    """

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        project = resolve_project_id(self._config, project_id)
        return f"/v1/projects/{project}/variables"

    def list(
        self, *, environment: str | None = None, project_id: str | None = None
    ) -> dict[str, Any]:
        """Lists the project's variables, values included.

        Args:
            environment: One of ``default``, ``development``, ``staging`` or
                ``production``. Omit to list every environment.
            project_id: Overrides the client-level default project.
        """
        result: dict[str, Any] = self._transport.request(
            "GET",
            self._base_path(project_id),
            params=_environment_params(environment),
        )
        return result

    def get(self, variable_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches one variable, value included."""
        _require_variable_id(variable_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{variable_id}"
        )
        return result

    def create(
        self,
        name: str,
        value: str,
        *,
        description: str | None = None,
        environment: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Stores a new variable."""
        _require_name(name)
        _require_value(value)

        body: dict[str, Any] = {"name": name, "value": value}
        if description is not None:
            body["description"] = description
        if environment is not None:
            body["environment"] = environment

        result: dict[str, Any] = self._transport.request(
            "POST", self._base_path(project_id), json=body
        )
        return result

    def update(
        self,
        variable_id: str,
        *,
        value: str | None = None,
        description: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Changes a variable's value, its description, or both."""
        _require_variable_id(variable_id)

        result: dict[str, Any] = self._transport.request(
            "PATCH",
            f"{self._base_path(project_id)}/{variable_id}",
            json=_update_body(value, description),
        )
        return result

    def delete(self, variable_id: str, *, project_id: str | None = None) -> None:
        """Permanently removes a variable. The API answers 204, so nothing is returned."""
        _require_variable_id(variable_id)

        self._transport.request("DELETE", f"{self._base_path(project_id)}/{variable_id}")


class AsyncVariablesService:
    """Asynchronous counterpart to :class:`VariablesService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        project = resolve_project_id(self._config, project_id)
        return f"/v1/projects/{project}/variables"

    async def list(
        self, *, environment: str | None = None, project_id: str | None = None
    ) -> dict[str, Any]:
        """Lists the project's variables, values included."""
        result: dict[str, Any] = await self._transport.request(
            "GET",
            self._base_path(project_id),
            params=_environment_params(environment),
        )
        return result

    async def get(
        self, variable_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one variable, value included."""
        _require_variable_id(variable_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{variable_id}"
        )
        return result

    async def create(
        self,
        name: str,
        value: str,
        *,
        description: str | None = None,
        environment: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Stores a new variable."""
        _require_name(name)
        _require_value(value)

        body: dict[str, Any] = {"name": name, "value": value}
        if description is not None:
            body["description"] = description
        if environment is not None:
            body["environment"] = environment

        result: dict[str, Any] = await self._transport.request(
            "POST", self._base_path(project_id), json=body
        )
        return result

    async def update(
        self,
        variable_id: str,
        *,
        value: str | None = None,
        description: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Changes a variable's value, its description, or both."""
        _require_variable_id(variable_id)

        result: dict[str, Any] = await self._transport.request(
            "PATCH",
            f"{self._base_path(project_id)}/{variable_id}",
            json=_update_body(value, description),
        )
        return result

    async def delete(self, variable_id: str, *, project_id: str | None = None) -> None:
        """Permanently removes a variable. The API answers 204, so nothing is returned."""
        _require_variable_id(variable_id)

        await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{variable_id}"
        )
