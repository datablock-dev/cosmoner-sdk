"""HTTP transport: header assembly, retries, and response/error decoding."""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Mapping
from typing import Any

import httpx

from ._config import ClientConfig
from ._retry import RetryPolicy, parse_retry_after
from ._version import USER_AGENT
from .errors import (
    CosmonerConnectionError,
    CosmonerError,
    CosmonerTimeoutError,
    error_from_response,
)

# Methods that mutate state and therefore carry an idempotency key.
WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class _BaseTransport:
    """Shared request construction and response decoding for both transports."""

    def __init__(self, config: ClientConfig) -> None:
        self._config = config
        self._policy = RetryPolicy(max_retries=config.max_retries)

    def _url(self, path: str) -> str:
        """Joins a route path onto the configured base URL."""
        return f"{self._config.base_url}{path}"

    def _headers(
        self,
        method: str,
        has_body: bool,
        idempotency_key: str | None,
    ) -> dict[str, str]:
        """Builds the header set for one request.

        The idempotency key is generated once per logical request and reused
        across retries, so a replayed write can be collapsed server-side. The
        API does not consume this header yet — it is sent now so that retries
        become safe for writes as soon as it does.
        """
        headers = {
            "Authorization": f"Bearer {self._config.api_key}",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        if has_body:
            headers["Content-Type"] = "application/json"
        if method.upper() in WRITE_METHODS:
            headers["Idempotency-Key"] = idempotency_key or str(uuid.uuid4())
        return headers

    def _decode(self, response: httpx.Response) -> Any:
        """Parses a successful response body, or raises the mapped API error."""
        try:
            body: Any = response.json()
        except ValueError:
            body = None

        if response.is_success:
            if body is None:
                raise CosmonerError(
                    status=response.status_code,
                    code="INVALID_RESPONSE",
                    message="API returned a non-JSON response",
                )
            return body

        raise error_from_response(
            status=response.status_code,
            body=body,
            headers=response.headers,
            retry_after=parse_retry_after(response.headers),
        )


class Transport(_BaseTransport):
    """Synchronous HTTP transport backed by a pooled ``httpx.Client``."""

    def __init__(self, config: ClientConfig) -> None:
        super().__init__(config)
        self._client = httpx.Client(timeout=config.timeout)

    def request(
        self,
        method: str,
        path: str,
        *,
        json: Mapping[str, Any] | None = None,
        params: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        retry_non_idempotent: bool = False,
    ) -> Any:
        """Issues a request, retrying transient failures, and returns the parsed body."""
        url = self._url(path)
        headers = self._headers(method, json is not None, idempotency_key)
        attempt = 0

        while True:
            status: int | None = None
            retry_after: float | None = None
            error: CosmonerConnectionError | None = None

            try:
                response = self._client.request(
                    method, url, json=json, params=params, headers=headers
                )
                status = response.status_code
                retry_after = parse_retry_after(response.headers)

                if response.is_success:
                    return self._decode(response)
            except httpx.TimeoutException as err:
                response, error = None, CosmonerTimeoutError(f"Request timed out: {err}")
            except httpx.HTTPError as err:
                response, error = None, CosmonerConnectionError(f"Request failed: {err}")
            else:
                error = None

            if not self._policy.should_retry(
                attempt=attempt,
                method=method,
                status=status,
                retry_non_idempotent=retry_non_idempotent,
            ):
                if error is not None:
                    raise error
                # ``response`` is always set when no transport error was captured.
                assert response is not None
                return self._decode(response)  # raises the mapped API error

            time.sleep(self._policy.backoff_seconds(attempt, retry_after))
            attempt += 1

    def close(self) -> None:
        """Closes the underlying connection pool."""
        self._client.close()


class AsyncTransport(_BaseTransport):
    """Asynchronous HTTP transport backed by a pooled ``httpx.AsyncClient``."""

    def __init__(self, config: ClientConfig) -> None:
        super().__init__(config)
        self._client = httpx.AsyncClient(timeout=config.timeout)

    async def request(
        self,
        method: str,
        path: str,
        *,
        json: Mapping[str, Any] | None = None,
        params: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        retry_non_idempotent: bool = False,
    ) -> Any:
        """Issues a request, retrying transient failures, and returns the parsed body."""
        url = self._url(path)
        headers = self._headers(method, json is not None, idempotency_key)
        attempt = 0

        while True:
            status: int | None = None
            retry_after: float | None = None
            error: CosmonerConnectionError | None = None

            try:
                response = await self._client.request(
                    method, url, json=json, params=params, headers=headers
                )
                status = response.status_code
                retry_after = parse_retry_after(response.headers)

                if response.is_success:
                    return self._decode(response)
            except httpx.TimeoutException as err:
                response, error = None, CosmonerTimeoutError(f"Request timed out: {err}")
            except httpx.HTTPError as err:
                response, error = None, CosmonerConnectionError(f"Request failed: {err}")
            else:
                error = None

            if not self._policy.should_retry(
                attempt=attempt,
                method=method,
                status=status,
                retry_non_idempotent=retry_non_idempotent,
            ):
                if error is not None:
                    raise error
                # ``response`` is always set when no transport error was captured.
                assert response is not None
                return self._decode(response)  # raises the mapped API error

            await asyncio.sleep(self._policy.backoff_seconds(attempt, retry_after))
            attempt += 1

    async def aclose(self) -> None:
        """Closes the underlying connection pool."""
        await self._client.aclose()
