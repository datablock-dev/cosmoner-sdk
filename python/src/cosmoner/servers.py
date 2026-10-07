"""Servers service namespace — a project's virtual servers."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _require_server_id(server_id: str) -> None:
    """Rejects an empty server id before it becomes a malformed route."""
    if not server_id:
        raise ValueError("server_id is required")


def _update_payload(name: str) -> dict[str, Any]:
    """Validates update arguments and shapes them into the API request body."""
    if not name:
        raise ValueError("name is required")

    return {"name": name}


_DEFAULT_PROVIDER = "digitalocean"


def _require_size(size: str) -> None:
    """Rejects an empty size slug before it spends a request."""
    if not size:
        raise ValueError("size is required")


def _preview_params(size: str, provider: str | None) -> dict[str, str]:
    """Validates preview arguments and shapes them into the query string."""
    _require_size(size)

    return {
        "provider": _DEFAULT_PROVIDER if provider is None else provider,
        "slug": size,
    }


def _create_payload(
    name: str,
    size: str,
    region: str,
    image: str | None,
    ssh_key_ids: Sequence[str] | None,
    provider: str | None,
) -> dict[str, Any]:
    """Validates create arguments and shapes them into the API request body."""
    if not name:
        raise ValueError("name is required")
    _require_size(size)
    if not region:
        raise ValueError("region is required")

    payload: dict[str, Any] = {
        "name": name,
        "slug": size,
        "provider": _DEFAULT_PROVIDER if provider is None else provider,
        "region": region,
    }
    if image is not None:
        payload["template"] = image
    if ssh_key_ids is not None:
        payload["sshKeyIds"] = list(ssh_key_ids)

    return payload


class ServersService:
    """Synchronous operations on a project's servers."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/servers"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every server in the project."""
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    def get(self, server_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches one server, with the SSH keys installed on it under ``sshKeys``."""
        _require_server_id(server_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{server_id}"
        )
        return result

    def preview(
        self, *, size: str, provider: str | None = None, project_id: str | None = None
    ) -> dict[str, Any]:
        """Prices a server of ``size`` without creating it.

        The ``monthly`` charge is exact. ``dueToday`` is an estimate for a project
        that already has a subscription, because the real charge is prorated onto
        it. Amounts are integers in minor units; ``monthly`` excludes tax.
        """
        params = _preview_params(size, provider)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/preview", params=params
        )
        return result

    def create(
        self,
        *,
        name: str,
        size: str,
        region: str,
        image: str | None = None,
        ssh_key_ids: Sequence[str] | None = None,
        provider: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Creates a server, charging the project's saved card immediately.

        The charge is a prorated invoice. A project that cannot be billed is
        refused with 402 (``ORG_PAYMENT_METHOD_REQUIRED``,
        ``BILLER_PAYMENT_METHOD_REQUIRED`` or ``PAYMENT_REQUIRED``) before anything
        is created. ``image`` is a one-click image slug. The response carries no
        id: list the servers and match by name. The server starts
        ``PROVISIONING``.
        """
        payload = _create_payload(name, size, region, image, ssh_key_ids, provider)

        result: dict[str, Any] = self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result

    def delete(self, server_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Permanently deletes a server. This cannot be undone."""
        _require_server_id(server_id)

        result: dict[str, Any] = self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{server_id}"
        )
        return result

    def update(
        self, server_id: str, *, name: str, project_id: str | None = None
    ) -> dict[str, Any]:
        """Renames a server and returns the updated server.

        ``name`` is lowercase letters, digits and hyphens, 1-63 characters.
        """
        _require_server_id(server_id)
        payload = _update_payload(name)

        result: dict[str, Any] = self._transport.request(
            "PATCH", f"{self._base_path(project_id)}/{server_id}", json=payload
        )
        return result

    def power_on(
        self, server_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Starts a stopped server.

        The action is asynchronous: the server comes back ``PROVISIONING`` while
        it runs, so read the server to see where it settles. Refused with 409
        while the server is still being provisioned or is already running.
        """
        return self._action(server_id, "power_on", project_id)

    def power_off(
        self, server_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Cuts power to a running server, like pulling the plug.

        This is a hard power cut, not a clean shutdown. The action is
        asynchronous: the server comes back ``PROVISIONING`` while it runs, so
        read the server to see where it settles. Refused with 409 while the
        server is still being provisioned or is not running.
        """
        return self._action(server_id, "power_off", project_id)

    def reboot(self, server_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Restarts a running server.

        The action is asynchronous: the server comes back ``PROVISIONING`` while
        it runs, so read the server to see where it settles. Refused with 409
        while the server is still being provisioned or is not running.
        """
        return self._action(server_id, "reboot", project_id)

    def _action(
        self, server_id: str, action: str, project_id: str | None
    ) -> dict[str, Any]:
        """Starts a power action on a server and returns the server row."""
        _require_server_id(server_id)

        result: dict[str, Any] = self._transport.request(
            "POST",
            f"{self._base_path(project_id)}/{server_id}/actions",
            json={"action": action},
        )
        return result


class AsyncServersService:
    """Asynchronous counterpart to :class:`ServersService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/servers"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every server in the project."""
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    async def get(
        self, server_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one server, with the SSH keys installed on it under ``sshKeys``."""
        _require_server_id(server_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{server_id}"
        )
        return result

    async def preview(
        self, *, size: str, provider: str | None = None, project_id: str | None = None
    ) -> dict[str, Any]:
        """Prices a server of ``size`` without creating it.

        The ``monthly`` charge is exact. ``dueToday`` is an estimate for a project
        that already has a subscription, because the real charge is prorated onto
        it. Amounts are integers in minor units; ``monthly`` excludes tax.
        """
        params = _preview_params(size, provider)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/preview", params=params
        )
        return result

    async def create(
        self,
        *,
        name: str,
        size: str,
        region: str,
        image: str | None = None,
        ssh_key_ids: Sequence[str] | None = None,
        provider: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Creates a server, charging the project's saved card immediately.

        The charge is a prorated invoice. A project that cannot be billed is
        refused with 402 (``ORG_PAYMENT_METHOD_REQUIRED``,
        ``BILLER_PAYMENT_METHOD_REQUIRED`` or ``PAYMENT_REQUIRED``) before anything
        is created. ``image`` is a one-click image slug. The response carries no
        id: list the servers and match by name. The server starts
        ``PROVISIONING``.
        """
        payload = _create_payload(name, size, region, image, ssh_key_ids, provider)

        result: dict[str, Any] = await self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result

    async def delete(
        self, server_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently deletes a server. This cannot be undone."""
        _require_server_id(server_id)

        result: dict[str, Any] = await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{server_id}"
        )
        return result

    async def update(
        self, server_id: str, *, name: str, project_id: str | None = None
    ) -> dict[str, Any]:
        """Renames a server and returns the updated server.

        ``name`` is lowercase letters, digits and hyphens, 1-63 characters.
        """
        _require_server_id(server_id)
        payload = _update_payload(name)

        result: dict[str, Any] = await self._transport.request(
            "PATCH", f"{self._base_path(project_id)}/{server_id}", json=payload
        )
        return result

    async def power_on(
        self, server_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Starts a stopped server.

        The action is asynchronous: the server comes back ``PROVISIONING`` while
        it runs, so read the server to see where it settles. Refused with 409
        while the server is still being provisioned or is already running.
        """
        return await self._action(server_id, "power_on", project_id)

    async def power_off(
        self, server_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Cuts power to a running server, like pulling the plug.

        This is a hard power cut, not a clean shutdown. The action is
        asynchronous: the server comes back ``PROVISIONING`` while it runs, so
        read the server to see where it settles. Refused with 409 while the
        server is still being provisioned or is not running.
        """
        return await self._action(server_id, "power_off", project_id)

    async def reboot(
        self, server_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Restarts a running server.

        The action is asynchronous: the server comes back ``PROVISIONING`` while
        it runs, so read the server to see where it settles. Refused with 409
        while the server is still being provisioned or is not running.
        """
        return await self._action(server_id, "reboot", project_id)

    async def _action(
        self, server_id: str, action: str, project_id: str | None
    ) -> dict[str, Any]:
        """Starts a power action on a server and returns the server row."""
        _require_server_id(server_id)

        result: dict[str, Any] = await self._transport.request(
            "POST",
            f"{self._base_path(project_id)}/{server_id}/actions",
            json={"action": action},
        )
        return result
