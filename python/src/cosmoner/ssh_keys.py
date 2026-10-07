"""SSH keys service namespace — the public keys registered on a project."""

from __future__ import annotations

from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _create_payload(name: str, public_key: str) -> dict[str, Any]:
    """Validates create arguments and shapes them into the API request body."""
    if not name:
        raise ValueError("name is required")
    if not public_key:
        raise ValueError("public_key is required")

    return {"name": name, "publicKey": public_key}


def _generate_payload(name: str) -> dict[str, Any]:
    """Validates generate arguments and shapes them into the API request body."""
    if not name:
        raise ValueError("name is required")

    return {"name": name}


def _require_ssh_key_id(ssh_key_id: str) -> None:
    """Rejects an empty SSH key id before it becomes a malformed route."""
    if not ssh_key_id:
        raise ValueError("ssh_key_id is required")


class SshKeysService:
    """Synchronous operations on a project's SSH keys."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/ssh-keys"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every SSH key on the project with its fingerprint."""
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    def create(
        self, *, name: str, public_key: str, project_id: str | None = None
    ) -> dict[str, Any]:
        """Registers a public key and returns it with its ``fingerprint``."""
        payload = _create_payload(name, public_key)

        result: dict[str, Any] = self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result

    def generate(self, *, name: str, project_id: str | None = None) -> dict[str, Any]:
        """Generates a key pair, registers its public half, and returns both.

        ``privateKey`` is an RSA 4096 key as PKCS#1 PEM, opening with
        ``-----BEGIN RSA PRIVATE KEY-----``. The API keeps only the public half,
        so it is returned exactly once: store it now; it cannot be read again.
        """
        payload = _generate_payload(name)

        result: dict[str, Any] = self._transport.request(
            "POST", f"{self._base_path(project_id)}/generate", json=payload
        )
        return result

    def delete(self, ssh_key_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Permanently removes a key from the project.

        Deleting does not remove the key from servers it was already installed
        on: ``stillAuthorisedOn`` in the response counts them.
        """
        _require_ssh_key_id(ssh_key_id)

        result: dict[str, Any] = self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{ssh_key_id}"
        )
        return result


class AsyncSshKeysService:
    """Asynchronous counterpart to :class:`SshKeysService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/ssh-keys"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every SSH key on the project with its fingerprint."""
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    async def create(
        self, *, name: str, public_key: str, project_id: str | None = None
    ) -> dict[str, Any]:
        """Registers a public key and returns it with its ``fingerprint``."""
        payload = _create_payload(name, public_key)

        result: dict[str, Any] = await self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result

    async def generate(
        self, *, name: str, project_id: str | None = None
    ) -> dict[str, Any]:
        """Generates a key pair, registers its public half, and returns both.

        ``privateKey`` is an RSA 4096 key as PKCS#1 PEM, opening with
        ``-----BEGIN RSA PRIVATE KEY-----``. The API keeps only the public half,
        so it is returned exactly once: store it now; it cannot be read again.
        """
        payload = _generate_payload(name)

        result: dict[str, Any] = await self._transport.request(
            "POST", f"{self._base_path(project_id)}/generate", json=payload
        )
        return result

    async def delete(
        self, ssh_key_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently removes a key from the project.

        Deleting does not remove the key from servers it was already installed
        on: ``stillAuthorisedOn`` in the response counts them.
        """
        _require_ssh_key_id(ssh_key_id)

        result: dict[str, Any] = await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{ssh_key_id}"
        )
        return result
