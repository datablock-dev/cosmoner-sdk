"""Webhooks service namespace — endpoint management and delivery inspection."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport

#: Every event type an endpoint can subscribe to.
WEBHOOK_EVENT_TYPES = (
    "email.sent",
    "email.delivered",
    "email.delivery_delayed",
    "email.bounced",
    "email.complained",
    "email.opened",
    "email.clicked",
    "email.rejected",
    "email.rendering_failed",
    "email.domain_verified",
    "email.sending_paused",
    "app.deployed",
    "app.failed",
    "domain.verified",
    "domain.expired",
    "server.running",
    "server.error",
    "member.invited",
    "member.joined",
)

#: Sentinel distinguishing "leave unchanged" from an explicit ``None``.
_UNSET = object()


def _create_payload(
    name: str, url: str, events: Sequence[str], description: str | None
) -> dict[str, Any]:
    """Validates create arguments and shapes them into the API request body."""
    if not name:
        raise ValueError("name is required")
    if not url:
        raise ValueError("url is required")
    if not events:
        raise ValueError("At least one event is required")

    payload: dict[str, Any] = {"name": name, "url": url, "events": list(events)}
    if description is not None:
        payload["description"] = description

    return payload


def _update_payload(
    name: str | None,
    url: str | None,
    events: Sequence[str] | None,
    description: Any,
    enabled: bool | None,
) -> dict[str, Any]:
    """Shapes update arguments, omitting anything the caller left untouched.

    ``description`` uses a sentinel rather than ``None`` because clearing a
    description means sending an explicit null.
    """
    if events is not None and not events:
        raise ValueError("At least one event is required")

    payload: dict[str, Any] = {}
    if name is not None:
        payload["name"] = name
    if url is not None:
        payload["url"] = url
    if events is not None:
        payload["events"] = list(events)
    if description is not _UNSET:
        payload["description"] = description
    if enabled is not None:
        payload["enabled"] = enabled

    return payload


def _delivery_params(
    status: str | None, event_type: str | None, limit: int | None, cursor: str | None
) -> dict[str, Any]:
    """Drops absent delivery filters so they are not sent as empty query values."""
    params: dict[str, Any] = {}
    if status is not None:
        params["status"] = status
    if event_type is not None:
        params["eventType"] = event_type
    if limit is not None:
        params["limit"] = limit
    if cursor is not None:
        params["cursor"] = cursor

    return params


def _require_endpoint_id(endpoint_id: str) -> None:
    """Rejects an empty endpoint id before it becomes a malformed route."""
    if not endpoint_id:
        raise ValueError("endpoint_id is required")


class WebhooksService:
    """Synchronous webhook endpoint and delivery operations for a project."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/webhooks"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every endpoint on the project, newest first."""
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    def get(self, endpoint_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches one endpoint together with its delivery counts."""
        _require_endpoint_id(endpoint_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{endpoint_id}"
        )
        return result

    def create(
        self,
        name: str,
        url: str,
        events: Sequence[str],
        *,
        description: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Creates an endpoint and returns it with its signing secret.

        The secret is returned by this call alone — every later read gives only
        ``secretHint``, so persist it before discarding the response.
        """
        payload = _create_payload(name, url, events, description)

        result: dict[str, Any] = self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result

    def update(
        self,
        endpoint_id: str,
        *,
        name: str | None = None,
        url: str | None = None,
        events: Sequence[str] | None = None,
        description: str | None = _UNSET,  # type: ignore[assignment]
        enabled: bool | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Updates an endpoint's configuration.

        Re-enabling a paused endpoint through ``enabled=True`` also clears its
        failure streak, so one more failure will not immediately re-pause it.
        Pass ``description=None`` to clear the description.
        """
        _require_endpoint_id(endpoint_id)
        payload = _update_payload(name, url, events, description, enabled)

        result: dict[str, Any] = self._transport.request(
            "PATCH", f"{self._base_path(project_id)}/{endpoint_id}", json=payload
        )
        return result

    def delete(
        self, endpoint_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Deletes an endpoint and its delivery history."""
        _require_endpoint_id(endpoint_id)

        result: dict[str, Any] = self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{endpoint_id}"
        )
        return result

    def resume(
        self, endpoint_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Clears an auto-pause and re-queues the backlog held while it was down.

        An endpoint pauses itself after ten consecutive failed deliveries.
        """
        _require_endpoint_id(endpoint_id)

        result: dict[str, Any] = self._transport.request(
            "POST", f"{self._base_path(project_id)}/{endpoint_id}/resume"
        )
        return result

    def rotate_secret(
        self, endpoint_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Issues a new signing secret and returns it in full.

        The previous secret stops verifying immediately, so deploy the new one
        before rotating if the receiver cannot tolerate rejected deliveries.
        """
        _require_endpoint_id(endpoint_id)

        result: dict[str, Any] = self._transport.request(
            "POST", f"{self._base_path(project_id)}/{endpoint_id}/rotate-secret"
        )
        return result

    def test(
        self,
        endpoint_id: str,
        *,
        event_type: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Sends a synthetic event and reports what the endpoint answered.

        Defaults to the endpoint's first subscribed event. Test sends never
        move the failure streak in either direction.
        """
        _require_endpoint_id(endpoint_id)
        payload = {"eventType": event_type} if event_type is not None else {}

        result: dict[str, Any] = self._transport.request(
            "POST", f"{self._base_path(project_id)}/{endpoint_id}/test", json=payload
        )
        return result

    def list_deliveries(
        self,
        endpoint_id: str,
        *,
        status: str | None = None,
        event_type: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Lists deliveries for an endpoint, newest first, cursor-paginated."""
        _require_endpoint_id(endpoint_id)
        params = _delivery_params(status, event_type, limit, cursor)

        result: dict[str, Any] = self._transport.request(
            "GET",
            f"{self._base_path(project_id)}/{endpoint_id}/deliveries",
            params=params or None,
        )
        return result

    def replay_delivery(
        self, endpoint_id: str, delivery_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Queues a fresh delivery carrying the same payload.

        The endpoint must be enabled — replaying into a paused endpoint fails
        rather than silently queueing behind the backlog.
        """
        _require_endpoint_id(endpoint_id)
        if not delivery_id:
            raise ValueError("delivery_id is required")

        result: dict[str, Any] = self._transport.request(
            "POST",
            f"{self._base_path(project_id)}/{endpoint_id}/deliveries/{delivery_id}/replay",
        )
        return result


class AsyncWebhooksService:
    """Asynchronous counterpart to :class:`WebhooksService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/webhooks"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every endpoint on the project, newest first."""
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    async def get(
        self, endpoint_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one endpoint together with its delivery counts."""
        _require_endpoint_id(endpoint_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{endpoint_id}"
        )
        return result

    async def create(
        self,
        name: str,
        url: str,
        events: Sequence[str],
        *,
        description: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Creates an endpoint and returns it with its signing secret.

        The secret is returned by this call alone — every later read gives only
        ``secretHint``, so persist it before discarding the response.
        """
        payload = _create_payload(name, url, events, description)

        result: dict[str, Any] = await self._transport.request(
            "POST", self._base_path(project_id), json=payload
        )
        return result

    async def update(
        self,
        endpoint_id: str,
        *,
        name: str | None = None,
        url: str | None = None,
        events: Sequence[str] | None = None,
        description: str | None = _UNSET,  # type: ignore[assignment]
        enabled: bool | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Updates an endpoint's configuration.

        Re-enabling a paused endpoint through ``enabled=True`` also clears its
        failure streak, so one more failure will not immediately re-pause it.
        Pass ``description=None`` to clear the description.
        """
        _require_endpoint_id(endpoint_id)
        payload = _update_payload(name, url, events, description, enabled)

        result: dict[str, Any] = await self._transport.request(
            "PATCH", f"{self._base_path(project_id)}/{endpoint_id}", json=payload
        )
        return result

    async def delete(
        self, endpoint_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Deletes an endpoint and its delivery history."""
        _require_endpoint_id(endpoint_id)

        result: dict[str, Any] = await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{endpoint_id}"
        )
        return result

    async def resume(
        self, endpoint_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Clears an auto-pause and re-queues the backlog held while it was down.

        An endpoint pauses itself after ten consecutive failed deliveries.
        """
        _require_endpoint_id(endpoint_id)

        result: dict[str, Any] = await self._transport.request(
            "POST", f"{self._base_path(project_id)}/{endpoint_id}/resume"
        )
        return result

    async def rotate_secret(
        self, endpoint_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Issues a new signing secret and returns it in full.

        The previous secret stops verifying immediately, so deploy the new one
        before rotating if the receiver cannot tolerate rejected deliveries.
        """
        _require_endpoint_id(endpoint_id)

        result: dict[str, Any] = await self._transport.request(
            "POST", f"{self._base_path(project_id)}/{endpoint_id}/rotate-secret"
        )
        return result

    async def test(
        self,
        endpoint_id: str,
        *,
        event_type: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Sends a synthetic event and reports what the endpoint answered.

        Defaults to the endpoint's first subscribed event. Test sends never
        move the failure streak in either direction.
        """
        _require_endpoint_id(endpoint_id)
        payload = {"eventType": event_type} if event_type is not None else {}

        result: dict[str, Any] = await self._transport.request(
            "POST", f"{self._base_path(project_id)}/{endpoint_id}/test", json=payload
        )
        return result

    async def list_deliveries(
        self,
        endpoint_id: str,
        *,
        status: str | None = None,
        event_type: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Lists deliveries for an endpoint, newest first, cursor-paginated."""
        _require_endpoint_id(endpoint_id)
        params = _delivery_params(status, event_type, limit, cursor)

        result: dict[str, Any] = await self._transport.request(
            "GET",
            f"{self._base_path(project_id)}/{endpoint_id}/deliveries",
            params=params or None,
        )
        return result

    async def replay_delivery(
        self, endpoint_id: str, delivery_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Queues a fresh delivery carrying the same payload.

        The endpoint must be enabled — replaying into a paused endpoint fails
        rather than silently queueing behind the backlog.
        """
        _require_endpoint_id(endpoint_id)
        if not delivery_id:
            raise ValueError("delivery_id is required")

        result: dict[str, Any] = await self._transport.request(
            "POST",
            f"{self._base_path(project_id)}/{endpoint_id}/deliveries/{delivery_id}/replay",
        )
        return result
