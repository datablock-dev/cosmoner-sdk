/** HTTP transport: header assembly, retries, and response/error decoding. */

import type { ResolvedConfig } from "./config";
import {
  CosmonerConnectionError,
  CosmonerError,
  CosmonerTimeoutError,
  errorFromResponse,
} from "./errors";
import { backoffMs, parseRetryAfter, shouldRetry, sleep } from "./retry";
import { USER_AGENT } from "./version";

/** Methods that mutate state and therefore carry an idempotency key. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Per-request options understood by the transport. */
export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  idempotencyKey?: string;
  retryNonIdempotent?: boolean;
}

/** Generates an idempotency key, falling back where `crypto` is unavailable. */
function newIdempotencyKey(): string {
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === "function") return cryptoRef.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/** Issues authenticated requests against the API, retrying transient failures. */
export class Transport {
  constructor(private readonly config: ResolvedConfig) {}

  /**
   * Builds the header set for one request.
   *
   * The idempotency key is generated once per logical request and reused
   * across retries, so a replayed write can be collapsed server-side. The API
   * does not consume this header yet — it is sent now so that retries become
   * safe for writes as soon as it does.
   */
  private headers(method: string, hasBody: boolean, idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    if (hasBody) headers["Content-Type"] = "application/json";
    if (WRITE_METHODS.has(method.toUpperCase())) {
      headers["Idempotency-Key"] = idempotencyKey ?? newIdempotencyKey();
    }
    return headers;
  }

  /** Joins a route path and query onto the configured base URL. */
  private url(path: string, query?: RequestOptions["query"]): string {
    const url = `${this.config.baseUrl}${path}`;
    if (!query) return url;

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }

    const search = params.toString();
    return search ? `${url}?${search}` : url;
  }

  /** Parses a successful response body, or throws the mapped API error. */
  private async decode<T>(response: Response): Promise<T> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    if (response.ok) {
      if (body === undefined) {
        throw new CosmonerError(
          response.status,
          "INVALID_RESPONSE",
          "API returned a non-JSON response"
        );
      }
      return body as T;
    }

    throw errorFromResponse(
      response.status,
      body,
      response.headers,
      parseRetryAfter(response.headers)
    );
  }

  /** Issues a request, retrying transient failures, and returns the parsed body. */
  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.url(path, options.query);
    const hasBody = options.body !== undefined;
    const headers = this.headers(method, hasBody, options.idempotencyKey);

    let attempt = 0;

    for (;;) {
      let response: Response | null = null;
      let transportError: CosmonerError | null = null;
      let status: number | null = null;
      let retryAfter: number | undefined;

      try {
        response = await fetch(url, {
          method,
          headers,
          body: hasBody ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(this.config.timeout),
        });
        status = response.status;
        retryAfter = parseRetryAfter(response.headers);

        if (response.ok) return await this.decode<T>(response);
      } catch (err) {
        const name = (err as Error)?.name;
        const message = (err as Error)?.message ?? String(err);
        transportError =
          name === "TimeoutError" || name === "AbortError"
            ? new CosmonerTimeoutError(`Request timed out: ${message}`)
            : new CosmonerConnectionError(`Request failed: ${message}`);
      }

      const retry = shouldRetry(this.config.maxRetries, {
        attempt,
        method,
        status,
        retryNonIdempotent: options.retryNonIdempotent,
      });

      if (!retry) {
        if (transportError) throw transportError;
        return await this.decode<T>(response as Response); // throws the mapped API error
      }

      await sleep(backoffMs(attempt, retryAfter));
      attempt += 1;
    }
  }
}
