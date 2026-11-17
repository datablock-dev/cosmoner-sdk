"""Invoices service namespace — the invoices issued to a project. Read-only."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport


def _filter_params(
    status: str | None, created_gte: str | None, created_lte: str | None
) -> dict[str, Any]:
    """Drops absent filters so they are not sent as empty query values."""
    params: dict[str, Any] = {}
    if status is not None:
        params["status"] = status
    if created_gte:
        params["created_gte"] = created_gte
    if created_lte:
        params["created_lte"] = created_lte

    return params


def _list_params(
    status: str | None,
    created_gte: str | None,
    created_lte: str | None,
    limit: int | None,
    starting_after: str | None,
) -> dict[str, Any]:
    """The filters plus the page size and cursor that only the list takes."""
    params = _filter_params(status, created_gte, created_lte)
    if limit is not None:
        params["limit"] = limit
    if starting_after:
        params["starting_after"] = starting_after

    return params


def _invoice_segment(invoice_id: str) -> str:
    """Rejects an empty invoice id and encodes it as one path segment."""
    if not invoice_id:
        raise ValueError("invoice_id is required")

    return quote(invoice_id, safe="")


class InvoicesService:
    """Synchronous reads of a project's invoices. Needs ``billing:read``."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        project = resolve_project_id(self._config, project_id)
        return f"/v1/projects/{project}/billing/invoices"

    def list(
        self,
        *,
        status: str | None = None,
        created_gte: str | None = None,
        created_lte: str | None = None,
        limit: int | None = None,
        starting_after: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Lists one page of the project's invoices, newest first, at every stage.

        Dates are inclusive ISO dates or date-times. Pass the page's
        ``nextCursor`` as ``starting_after`` for the next one.
        """
        params = _list_params(status, created_gte, created_lte, limit, starting_after)

        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id), params=params or None
        )
        return result

    def export(
        self,
        *,
        status: str | None = None,
        created_gte: str | None = None,
        created_lte: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Every invoice matching the filters in one response, newest first.

        At most 1,000: narrow the date range to reach further back.
        Rate-limited, unlike :meth:`list`.
        """
        params = _filter_params(status, created_gte, created_lte)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/export", params=params or None
        )
        return result

    def get(self, invoice_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Reads one invoice by the id :meth:`list` returns."""
        segment = _invoice_segment(invoice_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{segment}"
        )
        return result


class AsyncInvoicesService:
    """Asynchronous counterpart to :class:`InvoicesService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        project = resolve_project_id(self._config, project_id)
        return f"/v1/projects/{project}/billing/invoices"

    async def list(
        self,
        *,
        status: str | None = None,
        created_gte: str | None = None,
        created_lte: str | None = None,
        limit: int | None = None,
        starting_after: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Lists one page of the project's invoices, newest first, at every stage.

        Dates are inclusive ISO dates or date-times. Pass the page's
        ``nextCursor`` as ``starting_after`` for the next one.
        """
        params = _list_params(status, created_gte, created_lte, limit, starting_after)

        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id), params=params or None
        )
        return result

    async def export(
        self,
        *,
        status: str | None = None,
        created_gte: str | None = None,
        created_lte: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Every invoice matching the filters in one response, newest first.

        At most 1,000: narrow the date range to reach further back.
        Rate-limited, unlike :meth:`list`.
        """
        params = _filter_params(status, created_gte, created_lte)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/export", params=params or None
        )
        return result

    async def get(
        self, invoice_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Reads one invoice by the id :meth:`list` returns."""
        segment = _invoice_segment(invoice_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{segment}"
        )
        return result
