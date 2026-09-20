"""Secrets service namespace — encrypted configuration, revealed only as it is set."""

from __future__ import annotations

import re
from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport

_NAME_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")
_MAX_NAME_LENGTH = 100
_MAX_VALUE_LENGTH = 10_000


def _require_secret_id(secret_id: str) -> None:
    """Rejects an empty secret id before it becomes a malformed route."""
    if not secret_id:
        raise ValueError("secret_id is required")


def _require_name(name: str) -> None:
    """Rejects a name the API would reject, using the message the API would send."""
    if not name:
        raise ValueError("name is required")
    if not _NAME_PATTERN.match(name):
        raise ValueError(
            "Name must be uppercase letters, numbers, or underscores, "
            "and start with a letter (e.g. DB_PASSWORD)"
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


def _write_body(
    value: str,
    description: str | None,
    name: str | None = None,
    environment: str | None = None,
) -> dict[str, Any]:
    """Builds a create or update body, omitting what the caller left out."""
    body: dict[str, Any] = {}
    if name is not None:
        body["name"] = name
    body["value"] = value
    if description is not None:
        body["description"] = description
    if environment is not None:
        body["environment"] = environment
    return body


class SecretsService:
    """Synchronous management of a project's secrets.

    Reads need the ``secrets:read`` scope. Writes need ``secrets:write`` *and*
    an owner or admin: the API checks the member's role independently of the
    key's scopes, so a plain member's key is refused even when it carries the
    scope.

    A secret's value is returned exactly once, by the call that sets it. There
    is no route that decrypts one afterwards.
    """

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        project = resolve_project_id(self._config, project_id)
        return f"/v1/projects/{project}/secrets"

    def list(
        self, *, environment: str | None = None, project_id: str | None = None
    ) -> dict[str, Any]:
        """Lists the project's secrets as metadata. Values are never included.

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

    def get(self, secret_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches one secret's metadata. The value is not part of the response."""
        _require_secret_id(secret_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{secret_id}"
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
        """Stores a new secret, and returns its plaintext value once.

        The response carries ``value`` and ``maskedValue``; a later read gives
        metadata only, so store the value now rather than expect to recover it.

        Creation is rate-limited to 10 requests per 10 minutes, and a project at
        its secret limit answers 402 — see :meth:`usage`.
        """
        _require_name(name)
        _require_value(value)

        result: dict[str, Any] = self._transport.request(
            "POST",
            self._base_path(project_id),
            json=_write_body(value, description, name=name, environment=environment),
        )
        return result

    def update(
        self,
        secret_id: str,
        value: str,
        *,
        description: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Replaces the value, bumps the version, and returns the new value once."""
        _require_secret_id(secret_id)
        _require_value(value)

        result: dict[str, Any] = self._transport.request(
            "PATCH",
            f"{self._base_path(project_id)}/{secret_id}",
            json=_write_body(value, description),
        )
        return result

    def delete(self, secret_id: str, *, project_id: str | None = None) -> None:
        """Permanently removes a secret. The API answers 204, so nothing is returned."""
        _require_secret_id(secret_id)

        self._transport.request("DELETE", f"{self._base_path(project_id)}/{secret_id}")

    def usage(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Reports how many secrets the project holds, may hold, and the price of more."""
        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/usage"
        )
        return result

    def audit(self, secret_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Reads a secret's audit trail: who changed it and when, never to what."""
        _require_secret_id(secret_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{secret_id}/audit"
        )
        return result


class AsyncSecretsService:
    """Asynchronous counterpart to :class:`SecretsService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        project = resolve_project_id(self._config, project_id)
        return f"/v1/projects/{project}/secrets"

    async def list(
        self, *, environment: str | None = None, project_id: str | None = None
    ) -> dict[str, Any]:
        """Lists the project's secrets as metadata. Values are never included."""
        result: dict[str, Any] = await self._transport.request(
            "GET",
            self._base_path(project_id),
            params=_environment_params(environment),
        )
        return result

    async def get(
        self, secret_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one secret's metadata. The value is not part of the response."""
        _require_secret_id(secret_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{secret_id}"
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
        """Stores a new secret, and returns its plaintext value once."""
        _require_name(name)
        _require_value(value)

        result: dict[str, Any] = await self._transport.request(
            "POST",
            self._base_path(project_id),
            json=_write_body(value, description, name=name, environment=environment),
        )
        return result

    async def update(
        self,
        secret_id: str,
        value: str,
        *,
        description: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Replaces the value, bumps the version, and returns the new value once."""
        _require_secret_id(secret_id)
        _require_value(value)

        result: dict[str, Any] = await self._transport.request(
            "PATCH",
            f"{self._base_path(project_id)}/{secret_id}",
            json=_write_body(value, description),
        )
        return result

    async def delete(self, secret_id: str, *, project_id: str | None = None) -> None:
        """Permanently removes a secret. The API answers 204, so nothing is returned."""
        _require_secret_id(secret_id)

        await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{secret_id}"
        )

    async def usage(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Reports how many secrets the project holds, may hold, and the price of more."""
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/usage"
        )
        return result

    async def audit(
        self, secret_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Reads a secret's audit trail: who changed it and when, never to what."""
        _require_secret_id(secret_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{secret_id}/audit"
        )
        return result
