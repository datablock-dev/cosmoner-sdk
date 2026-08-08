"""Entry-point clients exposing the API's service namespaces."""

from __future__ import annotations

from typing import Optional

from ._config import (
    DEFAULT_BASE_URL,
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT,
    build_config,
)
from ._transport import AsyncTransport, Transport
from .email import AsyncEmailService, EmailService


class Cosmoner:
    """
    Synchronous Cosmoner API client.

    ``project_id`` is optional: set it here to make it the default for every
    call, or omit it and pass ``project_id=`` per method to work across
    projects with one client.
    """

    def __init__(
        self,
        api_key: str,
        project_id: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> None:
        config = build_config(api_key, project_id, base_url, timeout, max_retries)

        self.api_key = config.api_key
        self.project_id = config.project_id
        self.base_url = config.base_url
        self.timeout = config.timeout
        self.max_retries = config.max_retries

        self._config = config
        self._transport = Transport(config)

        self.email = EmailService(self._transport, config)

    def close(self) -> None:
        """Releases the underlying connection pool."""
        self._transport.close()

    def __enter__(self) -> "Cosmoner":
        """Enters a context that closes the connection pool on exit."""
        return self

    def __exit__(self, *_exc_info: object) -> None:
        """Closes the connection pool when leaving the context."""
        self.close()


class AsyncCosmoner:
    """Asynchronous Cosmoner API client, mirroring :class:`Cosmoner`."""

    def __init__(
        self,
        api_key: str,
        project_id: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> None:
        config = build_config(api_key, project_id, base_url, timeout, max_retries)

        self.api_key = config.api_key
        self.project_id = config.project_id
        self.base_url = config.base_url
        self.timeout = config.timeout
        self.max_retries = config.max_retries

        self._config = config
        self._transport = AsyncTransport(config)

        self.email = AsyncEmailService(self._transport, config)

    async def aclose(self) -> None:
        """Releases the underlying connection pool."""
        await self._transport.aclose()

    async def __aenter__(self) -> "AsyncCosmoner":
        """Enters a context that closes the connection pool on exit."""
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        """Closes the connection pool when leaving the context."""
        await self.aclose()
