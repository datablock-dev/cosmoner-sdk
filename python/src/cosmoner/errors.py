"""Exception hierarchy raised by the SDK, mapped from API error responses."""

from __future__ import annotations

from typing import Any, Mapping, Optional


class CosmonerError(Exception):
    """
    Base class for every error the SDK raises.

    Catching this catches all API and transport failures, so existing
    ``except CosmonerError`` blocks keep working as the hierarchy grows.
    """

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        details: Any = None,
        request_id: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details
        self.request_id = request_id


class CosmonerConnectionError(CosmonerError):
    """The request never produced a response (DNS, TCP, TLS or socket failure)."""

    def __init__(self, message: str, *, code: str = "CONNECTION_ERROR") -> None:
        super().__init__(status=0, code=code, message=message)


class CosmonerTimeoutError(CosmonerConnectionError):
    """The request exceeded the configured timeout."""

    def __init__(self, message: str) -> None:
        super().__init__(message, code="TIMEOUT")


class AuthenticationError(CosmonerError):
    """401 — the API key is missing, malformed or revoked."""


class InsufficientScopeError(CosmonerError):
    """403 — the API key lacks the required ``resource:action`` permission."""


class NotFoundError(CosmonerError):
    """404 — the addressed resource does not exist or is not visible to this key."""


class ValidationError(CosmonerError):
    """400/422 — the request body or query failed server-side validation."""


class ConflictError(CosmonerError):
    """409 — the request conflicts with the current state of the resource."""


class RateLimitError(CosmonerError):
    """429 — the caller exceeded a rate limit and should back off."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        details: Any = None,
        request_id: Optional[str] = None,
        retry_after: Optional[float] = None,
    ) -> None:
        super().__init__(status, code, message, details=details, request_id=request_id)
        self.retry_after = retry_after


class ServerError(CosmonerError):
    """5xx — the API failed to handle an otherwise valid request."""


_STATUS_MAP = {
    400: ValidationError,
    401: AuthenticationError,
    403: InsufficientScopeError,
    404: NotFoundError,
    409: ConflictError,
    422: ValidationError,
    429: RateLimitError,
}


def error_from_response(
    status: int,
    body: Any,
    headers: Optional[Mapping[str, str]] = None,
    retry_after: Optional[float] = None,
) -> CosmonerError:
    """
    Maps an error response onto the most specific exception class available.

    The API envelope is ``{"success": false, "error": {"code", "message", "details"?}}``
    but proxies and load balancers can return HTML or an empty body, so every
    field is read defensively.
    """
    error: Mapping[str, Any] = {}
    if isinstance(body, Mapping):
        raw = body.get("error")
        if isinstance(raw, Mapping):
            error = raw

    code = error.get("code") or "UNKNOWN"
    message = error.get("message") or "Unknown error"
    details = error.get("details")
    request_id = (headers or {}).get("x-request-id")

    if status == 429:
        return RateLimitError(
            status,
            code,
            message,
            details=details,
            request_id=request_id,
            retry_after=retry_after,
        )

    cls = _STATUS_MAP.get(status) or (ServerError if status >= 500 else CosmonerError)
    return cls(status, code, message, details=details, request_id=request_id)
