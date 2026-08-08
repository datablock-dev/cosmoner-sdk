/** Exception hierarchy raised by the SDK, mapped from API error responses. */

/** Extra context attached to an error when the API supplies it. */
export interface CosmonerErrorOptions {
  details?: unknown;
  requestId?: string;
}

/**
 * Base class for every error the SDK throws.
 *
 * Catching this catches all API and transport failures, so existing
 * `catch (err) { if (err instanceof CosmonerError) }` blocks keep working as
 * the hierarchy grows.
 */
export class CosmonerError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;
  public readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    options: CosmonerErrorOptions = {}
  ) {
    super(message);
    this.name = "CosmonerError";
    this.code = code;
    this.status = status;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

/** The request never produced a response (DNS, TCP, TLS or socket failure). */
export class CosmonerConnectionError extends CosmonerError {
  constructor(message: string, code = "CONNECTION_ERROR") {
    super(0, code, message);
    this.name = "CosmonerConnectionError";
  }
}

/** The request exceeded the configured timeout. */
export class CosmonerTimeoutError extends CosmonerConnectionError {
  constructor(message: string) {
    super(message, "TIMEOUT");
    this.name = "CosmonerTimeoutError";
  }
}

/** 401 — the API key is missing, malformed or revoked. */
export class AuthenticationError extends CosmonerError {
  constructor(status: number, code: string, message: string, options?: CosmonerErrorOptions) {
    super(status, code, message, options);
    this.name = "AuthenticationError";
  }
}

/** 403 — the API key lacks the required `resource:action` permission. */
export class InsufficientScopeError extends CosmonerError {
  constructor(status: number, code: string, message: string, options?: CosmonerErrorOptions) {
    super(status, code, message, options);
    this.name = "InsufficientScopeError";
  }
}

/** 404 — the addressed resource does not exist or is not visible to this key. */
export class NotFoundError extends CosmonerError {
  constructor(status: number, code: string, message: string, options?: CosmonerErrorOptions) {
    super(status, code, message, options);
    this.name = "NotFoundError";
  }
}

/** 409 — the request conflicts with the current state of the resource. */
export class ConflictError extends CosmonerError {
  constructor(status: number, code: string, message: string, options?: CosmonerErrorOptions) {
    super(status, code, message, options);
    this.name = "ConflictError";
  }
}

/** 400/422 — the request body or query failed server-side validation. */
export class ValidationError extends CosmonerError {
  constructor(status: number, code: string, message: string, options?: CosmonerErrorOptions) {
    super(status, code, message, options);
    this.name = "ValidationError";
  }
}

/** 429 — the caller exceeded a rate limit and should back off. */
export class RateLimitError extends CosmonerError {
  public readonly retryAfter?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    options: CosmonerErrorOptions & { retryAfter?: number } = {}
  ) {
    super(status, code, message, options);
    this.name = "RateLimitError";
    this.retryAfter = options.retryAfter;
  }
}

/** 5xx — the API failed to handle an otherwise valid request. */
export class ServerError extends CosmonerError {
  constructor(status: number, code: string, message: string, options?: CosmonerErrorOptions) {
    super(status, code, message, options);
    this.name = "ServerError";
  }
}

/** Shape of the API's error envelope. */
interface ErrorEnvelope {
  success?: false;
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * Maps an error response onto the most specific error class available.
 *
 * Proxies and load balancers can return HTML or an empty body, so every field
 * is read defensively.
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  headers?: Headers,
  retryAfter?: number
): CosmonerError {
  const envelope = (body ?? {}) as ErrorEnvelope;
  const code = envelope.error?.code ?? "UNKNOWN";
  const message = envelope.error?.message ?? "Unknown error";
  const options: CosmonerErrorOptions = {
    details: envelope.error?.details,
    requestId: headers?.get("x-request-id") ?? undefined,
  };

  switch (status) {
    case 400:
    case 422:
      return new ValidationError(status, code, message, options);
    case 401:
      return new AuthenticationError(status, code, message, options);
    case 403:
      return new InsufficientScopeError(status, code, message, options);
    case 404:
      return new NotFoundError(status, code, message, options);
    case 409:
      return new ConflictError(status, code, message, options);
    case 429:
      return new RateLimitError(status, code, message, { ...options, retryAfter });
    default:
      return status >= 500
        ? new ServerError(status, code, message, options)
        : new CosmonerError(status, code, message, options);
  }
}
