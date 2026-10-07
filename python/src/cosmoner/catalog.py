"""Catalog service namespace — the sizes, plans, regions and images on offer."""

from __future__ import annotations

from typing import Any

from ._config import ClientConfig
from ._transport import AsyncTransport, Transport

_BASE_PATH = "/v1/catalog"


class CatalogService:
    """Synchronous reads of what can be created, and at what price.

    Like ``projects``, this namespace never uses the client's default project:
    the catalogue is the same for every project, so it works on a client
    without one.
    """

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def server_sizes(self) -> dict[str, Any]:
        """Lists server sizes; ``priceMonthly`` is in whole dollars."""
        result: dict[str, Any] = self._transport.request(
            "GET", f"{_BASE_PATH}/servers/sizes"
        )
        return result

    def server_regions(self) -> dict[str, Any]:
        """Lists the regions a server can be created in, with their ``features``."""
        result: dict[str, Any] = self._transport.request(
            "GET", f"{_BASE_PATH}/servers/regions"
        )
        return result

    def server_images(self) -> dict[str, Any]:
        """Lists the one-click images a server can be created from."""
        result: dict[str, Any] = self._transport.request(
            "GET", f"{_BASE_PATH}/servers/1-clicks"
        )
        return result

    def redis_plans(self) -> dict[str, Any]:
        """Lists Redis plans; ``priceMonthly`` is in dollars."""
        result: dict[str, Any] = self._transport.request(
            "GET", f"{_BASE_PATH}/redis/plans"
        )
        return result

    def redis_regions(self) -> dict[str, Any]:
        """Lists the regions a Redis database can be created in."""
        result: dict[str, Any] = self._transport.request(
            "GET", f"{_BASE_PATH}/redis/regions"
        )
        return result

    def databases(self) -> dict[str, Any]:
        """Fetches dedicated database ``sizes``, ``engines`` and ``regions``.

        Size prices (``priceMonthly``) are in dollars.
        """
        result: dict[str, Any] = self._transport.request("GET", f"{_BASE_PATH}/databases")
        return result

    def app_sizes(self) -> dict[str, Any]:
        """Lists app sizes, with snake_case keys exactly as the API sends them.

        ``usd_per_month`` is a string, in dollars.
        """
        result: dict[str, Any] = self._transport.request(
            "GET", f"{_BASE_PATH}/apps/sizes"
        )
        return result

    def app_regions(self) -> dict[str, Any]:
        """Lists the regions an app can be created in."""
        result: dict[str, Any] = self._transport.request(
            "GET", f"{_BASE_PATH}/apps/regions"
        )
        return result


class AsyncCatalogService:
    """Asynchronous counterpart to :class:`CatalogService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    async def server_sizes(self) -> dict[str, Any]:
        """Lists server sizes; ``priceMonthly`` is in whole dollars."""
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{_BASE_PATH}/servers/sizes"
        )
        return result

    async def server_regions(self) -> dict[str, Any]:
        """Lists the regions a server can be created in, with their ``features``."""
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{_BASE_PATH}/servers/regions"
        )
        return result

    async def server_images(self) -> dict[str, Any]:
        """Lists the one-click images a server can be created from."""
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{_BASE_PATH}/servers/1-clicks"
        )
        return result

    async def redis_plans(self) -> dict[str, Any]:
        """Lists Redis plans; ``priceMonthly`` is in dollars."""
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{_BASE_PATH}/redis/plans"
        )
        return result

    async def redis_regions(self) -> dict[str, Any]:
        """Lists the regions a Redis database can be created in."""
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{_BASE_PATH}/redis/regions"
        )
        return result

    async def databases(self) -> dict[str, Any]:
        """Fetches dedicated database ``sizes``, ``engines`` and ``regions``.

        Size prices (``priceMonthly``) are in dollars.
        """
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{_BASE_PATH}/databases"
        )
        return result

    async def app_sizes(self) -> dict[str, Any]:
        """Lists app sizes, with snake_case keys exactly as the API sends them.

        ``usd_per_month`` is a string, in dollars.
        """
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{_BASE_PATH}/apps/sizes"
        )
        return result

    async def app_regions(self) -> dict[str, Any]:
        """Lists the regions an app can be created in."""
        result: dict[str, Any] = await self._transport.request(
            "GET", f"{_BASE_PATH}/apps/regions"
        )
        return result
