"""Apps service namespace — finding apps and rolling image apps onto a new image."""

from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Callable
from typing import Any

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport

#: Phases after which a deployment will not change again.
FINISHED_DEPLOYMENT_PHASES = ("ACTIVE", "ERROR", "CANCELED", "SUPERSEDED")

DEFAULT_POLL_INTERVAL = 3.0
DEFAULT_WAIT_TIMEOUT = 600.0

# Docker's tag grammar and the digest form, matching what the API accepts, so a
# malformed value fails before it spends a request against the deploy budget.
_TAG_PATTERN = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")
_DIGEST_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")


def _deploy_payload(app_id: str, tag: str | None, digest: str | None) -> dict[str, Any]:
    """Validates deploy arguments and shapes them into the API request body."""
    _require_app_id(app_id)
    if tag and digest:
        raise ValueError("Pass either tag or digest, not both")
    if tag is not None and not _TAG_PATTERN.fullmatch(tag):
        raise ValueError(f'Invalid image tag "{tag}"')
    if digest is not None and not _DIGEST_PATTERN.fullmatch(digest):
        raise ValueError("digest must be sha256:<64 hex characters>")

    payload: dict[str, Any] = {}
    if tag is not None:
        payload["tag"] = tag
    if digest is not None:
        payload["digest"] = digest

    return payload


def _require_app_id(app_id: str) -> None:
    """Rejects an empty app id before it becomes a malformed route."""
    if not app_id:
        raise ValueError("app_id is required")


def _require_deployment_ids(app_id: str, deployment_id: str) -> None:
    """Rejects empty app or deployment ids before they become a malformed route."""
    _require_app_id(app_id)
    if not deployment_id:
        raise ValueError("deployment_id is required")


def _validate_wait(interval: float, timeout: float) -> None:
    """Rejects polling settings that would spin or never start."""
    if interval <= 0:
        raise ValueError("interval must be greater than 0")
    if timeout <= 0:
        raise ValueError("timeout must be greater than 0")


def _timeout_error(deployment_id: str, phase: str, timeout: float) -> TimeoutError:
    """Builds the error raised when a deployment outlives the wait."""
    return TimeoutError(
        f"Deployment {deployment_id} was still {phase} after {round(timeout)}s"
    )


class AppsService:
    """Synchronous app lookup and image deploy operations for a project."""

    def __init__(self, transport: Transport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/apps"

    def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every app in the project, newest first."""
        result: dict[str, Any] = self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    def deploy(
        self,
        app_id: str,
        *,
        tag: str | None = None,
        digest: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Starts deploying an image app and returns the deployment without waiting.

        Pass ``tag`` or ``digest`` to roll onto that image from the repository the
        app already pulls from, or neither to re-resolve the image the app names
        now. Only image apps pulling from a Cosmoner registry can be deployed this
        way. Pair with :meth:`wait_for_deployment` to learn whether it succeeded.
        """
        payload = _deploy_payload(app_id, tag, digest)

        result: dict[str, Any] = self._transport.request(
            "POST", f"{self._base_path(project_id)}/{app_id}/deployments", json=payload
        )
        return result

    def get_deployment(
        self, app_id: str, deployment_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one deployment's current phase."""
        _require_deployment_ids(app_id, deployment_id)

        result: dict[str, Any] = self._transport.request(
            "GET",
            f"{self._base_path(project_id)}/{app_id}/deployments/{deployment_id}",
        )
        return result

    def wait_for_deployment(
        self,
        app_id: str,
        deployment_id: str,
        *,
        interval: float = DEFAULT_POLL_INTERVAL,
        timeout: float = DEFAULT_WAIT_TIMEOUT,
        on_poll: Callable[[dict[str, Any]], None] | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Polls a deployment until it finishes, and returns it in its final phase.

        Returns for every finished phase, failures included — check ``phase`` for
        ``ACTIVE``. Raises only when a request fails or ``timeout`` seconds pass
        first (``TimeoutError``), in which case the deployment keeps going
        server-side. ``on_poll`` receives every poll result, including the last.
        """
        _validate_wait(interval, timeout)
        deadline = time.monotonic() + timeout

        while True:
            deployment: dict[str, Any] = self.get_deployment(
                app_id, deployment_id, project_id=project_id
            )["data"]
            if on_poll is not None:
                on_poll(deployment)
            if deployment["phase"] in FINISHED_DEPLOYMENT_PHASES:
                return deployment

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise _timeout_error(deployment_id, deployment["phase"], timeout)
            time.sleep(min(interval, remaining))


class AsyncAppsService:
    """Asynchronous counterpart to :class:`AppsService`."""

    def __init__(self, transport: AsyncTransport, config: ClientConfig) -> None:
        """Binds the namespace to the client's transport and resolved configuration."""
        self._transport = transport
        self._config = config

    def _base_path(self, project_id: str | None) -> str:
        """Builds the collection route for the resolved project."""
        return f"/v1/projects/{resolve_project_id(self._config, project_id)}/apps"

    async def list(self, *, project_id: str | None = None) -> dict[str, Any]:
        """Lists every app in the project, newest first."""
        result: dict[str, Any] = await self._transport.request(
            "GET", self._base_path(project_id)
        )
        return result

    async def deploy(
        self,
        app_id: str,
        *,
        tag: str | None = None,
        digest: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Starts deploying an image app and returns the deployment without waiting.

        Pass ``tag`` or ``digest`` to roll onto that image from the repository the
        app already pulls from, or neither to re-resolve the image the app names
        now. Only image apps pulling from a Cosmoner registry can be deployed this
        way. Pair with :meth:`wait_for_deployment` to learn whether it succeeded.
        """
        payload = _deploy_payload(app_id, tag, digest)

        result: dict[str, Any] = await self._transport.request(
            "POST", f"{self._base_path(project_id)}/{app_id}/deployments", json=payload
        )
        return result

    async def get_deployment(
        self, app_id: str, deployment_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Fetches one deployment's current phase."""
        _require_deployment_ids(app_id, deployment_id)

        result: dict[str, Any] = await self._transport.request(
            "GET",
            f"{self._base_path(project_id)}/{app_id}/deployments/{deployment_id}",
        )
        return result

    async def wait_for_deployment(
        self,
        app_id: str,
        deployment_id: str,
        *,
        interval: float = DEFAULT_POLL_INTERVAL,
        timeout: float = DEFAULT_WAIT_TIMEOUT,
        on_poll: Callable[[dict[str, Any]], None] | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Polls a deployment until it finishes, and returns it in its final phase.

        Returns for every finished phase, failures included — check ``phase`` for
        ``ACTIVE``. Raises only when a request fails or ``timeout`` seconds pass
        first (``TimeoutError``), in which case the deployment keeps going
        server-side. ``on_poll`` receives every poll result, including the last.
        """
        _validate_wait(interval, timeout)
        deadline = time.monotonic() + timeout

        while True:
            response = await self.get_deployment(
                app_id, deployment_id, project_id=project_id
            )
            deployment: dict[str, Any] = response["data"]
            if on_poll is not None:
                on_poll(deployment)
            if deployment["phase"] in FINISHED_DEPLOYMENT_PHASES:
                return deployment

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise _timeout_error(deployment_id, deployment["phase"], timeout)
            await asyncio.sleep(min(interval, remaining))
