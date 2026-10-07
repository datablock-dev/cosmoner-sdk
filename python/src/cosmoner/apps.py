"""Apps service namespace — reading, changing and deleting apps, and deploying images."""

from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Callable
from typing import Any, Literal

from ._config import ClientConfig, resolve_project_id
from ._transport import AsyncTransport, Transport

#: Phases after which a deployment will not change again.
FINISHED_DEPLOYMENT_PHASES = ("ACTIVE", "ERROR", "CANCELED", "SUPERSEDED")

#: The log streams an app exposes: the image build, and the running container.
_LOG_TYPES = ("BUILD", "RUN")

DEFAULT_POLL_INTERVAL = 3.0
DEFAULT_WAIT_TIMEOUT = 600.0

# Docker's tag grammar and the digest form, matching what the API accepts, so a
# malformed value fails before it spends a request against the deploy budget.
_TAG_PATTERN = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")
_DIGEST_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")

#: Sentinel distinguishing "leave unchanged" from an explicit ``None``.
_UNSET: Any = object()

#: How an image app picks up a new image: the tag it names, the newest push, or
#: only when told to.
ImageDeployPolicy = Literal["TAG", "NEWEST", "MANUAL"]


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


def _update_payload(
    name: str | None,
    build_command: Any,
    run_command: Any,
    output_dir: Any,
    public_port: Any,
    internal_port: Any,
    auto_deploy: bool | None,
    image_deploy_policy: str | None,
    instances: int | None,
) -> dict[str, Any]:
    """Shapes update arguments into camelCase JSON, sending only what was given.

    The commands, output directory and ports use a sentinel rather than ``None``
    because clearing one means sending an explicit null.
    """
    candidates: dict[str, Any] = {
        "name": _UNSET if name is None else name,
        "buildCommand": build_command,
        "runCommand": run_command,
        "outputDir": output_dir,
        "publicPort": public_port,
        "internalPort": internal_port,
        "autoDeploy": _UNSET if auto_deploy is None else auto_deploy,
        "imageDeployPolicy": (
            _UNSET if image_deploy_policy is None else image_deploy_policy
        ),
        "instances": _UNSET if instances is None else instances,
    }
    payload = {key: value for key, value in candidates.items() if value is not _UNSET}
    if not payload:
        raise ValueError("at least one change is required")

    return payload


def _require_app_id(app_id: str) -> None:
    """Rejects an empty app id before it becomes a malformed route."""
    if not app_id:
        raise ValueError("app_id is required")


def _require_log_type(log_type: str) -> None:
    """Rejects a log stream the API does not have before spending a request on it."""
    if log_type not in _LOG_TYPES:
        raise ValueError('type must be "BUILD" or "RUN"')


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
    """Synchronous app reads, changes, deletes and image deploys for a project."""

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

    def get(self, app_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches one app by id."""
        _require_app_id(app_id)

        result: dict[str, Any] = self._transport.request(
            "GET", f"{self._base_path(project_id)}/{app_id}"
        )
        return result

    def update(
        self,
        app_id: str,
        *,
        name: str | None = None,
        build_command: str | None = _UNSET,
        run_command: str | None = _UNSET,
        output_dir: str | None = _UNSET,
        public_port: int | None = _UNSET,
        internal_port: int | None = _UNSET,
        auto_deploy: bool | None = None,
        image_deploy_policy: ImageDeployPolicy | None = None,
        instances: int | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Changes an app's settings and returns the updated app.

        Only the fields given are sent, as their camelCase API names. Pass
        ``None`` to ``build_command``, ``run_command``, ``output_dir``,
        ``public_port`` or ``internal_port`` to clear it. A call that changes
        nothing raises ``ValueError`` before any request.
        """
        _require_app_id(app_id)
        payload = _update_payload(
            name,
            build_command,
            run_command,
            output_dir,
            public_port,
            internal_port,
            auto_deploy,
            image_deploy_policy,
            instances,
        )

        result: dict[str, Any] = self._transport.request(
            "PATCH", f"{self._base_path(project_id)}/{app_id}", json=payload
        )
        return result

    def delete(self, app_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Permanently deletes an app. This cannot be undone."""
        _require_app_id(app_id)

        result: dict[str, Any] = self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{app_id}"
        )
        return result

    def logs(
        self,
        app_id: str,
        *,
        type: Literal["BUILD", "RUN"],
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Fetches an app's recent log lines, each with ``message`` and ``timestamp``.

        ``type`` picks the stream: ``BUILD`` for the image build, ``RUN`` for the
        running container. Anything else raises ``ValueError``.
        """
        _require_app_id(app_id)
        _require_log_type(type)

        result: dict[str, Any] = self._transport.request(
            "GET",
            f"{self._base_path(project_id)}/{app_id}/logs",
            params={"type": type},
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

    async def get(self, app_id: str, *, project_id: str | None = None) -> dict[str, Any]:
        """Fetches one app by id."""
        _require_app_id(app_id)

        result: dict[str, Any] = await self._transport.request(
            "GET", f"{self._base_path(project_id)}/{app_id}"
        )
        return result

    async def update(
        self,
        app_id: str,
        *,
        name: str | None = None,
        build_command: str | None = _UNSET,
        run_command: str | None = _UNSET,
        output_dir: str | None = _UNSET,
        public_port: int | None = _UNSET,
        internal_port: int | None = _UNSET,
        auto_deploy: bool | None = None,
        image_deploy_policy: ImageDeployPolicy | None = None,
        instances: int | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Changes an app's settings and returns the updated app.

        Only the fields given are sent, as their camelCase API names. Pass
        ``None`` to ``build_command``, ``run_command``, ``output_dir``,
        ``public_port`` or ``internal_port`` to clear it. A call that changes
        nothing raises ``ValueError`` before any request.
        """
        _require_app_id(app_id)
        payload = _update_payload(
            name,
            build_command,
            run_command,
            output_dir,
            public_port,
            internal_port,
            auto_deploy,
            image_deploy_policy,
            instances,
        )

        result: dict[str, Any] = await self._transport.request(
            "PATCH", f"{self._base_path(project_id)}/{app_id}", json=payload
        )
        return result

    async def delete(
        self, app_id: str, *, project_id: str | None = None
    ) -> dict[str, Any]:
        """Permanently deletes an app. This cannot be undone."""
        _require_app_id(app_id)

        result: dict[str, Any] = await self._transport.request(
            "DELETE", f"{self._base_path(project_id)}/{app_id}"
        )
        return result

    async def logs(
        self,
        app_id: str,
        *,
        type: Literal["BUILD", "RUN"],
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Fetches an app's recent log lines, each with ``message`` and ``timestamp``.

        ``type`` picks the stream: ``BUILD`` for the image build, ``RUN`` for the
        running container. Anything else raises ``ValueError``.
        """
        _require_app_id(app_id)
        _require_log_type(type)

        result: dict[str, Any] = await self._transport.request(
            "GET",
            f"{self._base_path(project_id)}/{app_id}/logs",
            params={"type": type},
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
