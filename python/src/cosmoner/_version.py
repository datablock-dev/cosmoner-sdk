"""Resolves the installed package version for the SDK's User-Agent header."""

from __future__ import annotations

from importlib import metadata

try:
    __version__ = metadata.version("cosmoner-sdk")
except metadata.PackageNotFoundError:  # running from a source checkout
    __version__ = "0.0.0"

USER_AGENT = f"cosmoner-python/{__version__}"
