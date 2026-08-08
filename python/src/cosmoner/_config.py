"""Shared, validated configuration for the sync and async clients."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

DEFAULT_BASE_URL = "https://api.cosmoner.com"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 2


@dataclass(frozen=True)
class ClientConfig:
    """Immutable connection settings shared by a client and its service namespaces."""

    api_key: str
    project_id: Optional[str]
    base_url: str
    timeout: float
    max_retries: int


def build_config(
    api_key: str,
    project_id: Optional[str],
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = DEFAULT_TIMEOUT,
    max_retries: int = DEFAULT_MAX_RETRIES,
) -> ClientConfig:
    """
    Validates constructor arguments and normalizes them into a ``ClientConfig``.

    ``project_id`` is optional so a single client can span projects, but an
    explicitly empty string is rejected rather than silently treated as unset —
    that almost always means an unresolved environment variable.
    """
    if not api_key:
        raise ValueError("api_key is required")
    if project_id is not None and not project_id:
        raise ValueError("project_id is required")
    if timeout <= 0:
        raise ValueError("timeout must be greater than 0")
    if max_retries < 0:
        raise ValueError("max_retries cannot be negative")

    return ClientConfig(
        api_key=api_key,
        project_id=project_id,
        base_url=base_url.rstrip("/"),
        timeout=timeout,
        max_retries=max_retries,
    )


def resolve_project_id(config: ClientConfig, override: Optional[str] = None) -> str:
    """Returns the per-call project id, falling back to the client-level default."""
    project_id = override or config.project_id
    if not project_id:
        raise ValueError(
            "project_id is required — pass it to the Cosmoner client or to this method"
        )
    return project_id
