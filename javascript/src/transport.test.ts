import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AuthenticationError,
  ConflictError,
  Cosmoner,
  CosmonerConnectionError,
  CosmonerTimeoutError,
  InsufficientScopeError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "./index";
import { backoffMs, parseRetryAfter, shouldRetry } from "./retry";

/** Build a client pointed at the mocked host. */
function makeClient(maxRetries: number) {
  return new Cosmoner({
    apiKey: "key-123",
    projectId: "proj-1",
    baseUrl: "https://api.test.dev",
    maxRetries,
  });
}

/** Issue a representative POST through the transport. */
function send(client: Cosmoner) {
  return client.email.send({
    credentialId: "cred-1",
    to: "user@test.com",
    subject: "Test",
    text: "body",
  });
}

/** Build a JSON response with the given status. */
function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

describe("shouldRetry", () => {
  it("retries 429 even for writes", () => {
    expect(shouldRetry(2, { attempt: 0, method: "POST", status: 429 })).toBe(true);
  });

  it("does not retry 5xx for writes by default", () => {
    expect(shouldRetry(2, { attempt: 0, method: "POST", status: 500 })).toBe(false);
  });

  it("retries 5xx for idempotent methods", () => {
    expect(shouldRetry(2, { attempt: 0, method: "GET", status: 500 })).toBe(true);
  });

  it("retries writes when the caller opts in", () => {
    expect(
      shouldRetry(2, {
        attempt: 0,
        method: "POST",
        status: 500,
        retryNonIdempotent: true,
      })
    ).toBe(true);
  });

  it("does not retry a transport failure for writes", () => {
    expect(shouldRetry(2, { attempt: 0, method: "POST", status: null })).toBe(false);
  });

  it("does not retry client errors", () => {
    expect(shouldRetry(2, { attempt: 0, method: "GET", status: 404 })).toBe(false);
  });

  it("stops at maxRetries", () => {
    expect(shouldRetry(1, { attempt: 1, method: "GET", status: 429 })).toBe(false);
  });

  it("is disabled when maxRetries is zero", () => {
    expect(shouldRetry(0, { attempt: 0, method: "GET", status: 429 })).toBe(false);
  });
});

describe("backoff", () => {
  it("prefers Retry-After", () => {
    expect(backoffMs(0, 3)).toBe(3_000);
  });

  it("caps Retry-After", () => {
    expect(backoffMs(0, 999)).toBe(8_000);
  });

  it("jitters within the ceiling", () => {
    const delay = backoffMs(2);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(2_000);
  });

  it("reads Retry-After in seconds", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "5" }))).toBe(5);
  });

  it("ignores an unparseable Retry-After", () => {
    const headers = new Headers({ "retry-after": "Wed, 21 Oct 2015 07:28:00 GMT" });
    expect(parseRetryAfter(headers)).toBeUndefined();
  });

  it("returns undefined when Retry-After is absent", () => {
    expect(parseRetryAfter(new Headers())).toBeUndefined();
  });
});

describe("Transport retries", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Collapse retry backoff so these tests run instantly.
    vi.spyOn(globalThis.Math, "random").mockReturnValue(0);
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries 429 then succeeds", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: {} }));

    const result = await send(makeClient(2));

    expect(result).toEqual({ success: true, data: {} });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(429));

    await expect(send(makeClient(2))).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does not retry a failed write", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(500));

    await expect(send(makeClient(2))).rejects.toBeInstanceOf(ServerError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reuses one idempotency key across retries", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: {} }));

    await send(makeClient(2));

    const calls = fetchSpy.mock.calls as unknown as [string, RequestInit][];
    const keys = calls.map(
      ([, init]) => (init.headers as Record<string, string>)["Idempotency-Key"]
    );
    expect(new Set(keys).size).toBe(1);
  });

  it("maps timeouts", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    fetchSpy.mockRejectedValue(err);

    await expect(send(makeClient(0))).rejects.toBeInstanceOf(CosmonerTimeoutError);
  });

  it("maps connection failures", async () => {
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));

    await expect(send(makeClient(0))).rejects.toBeInstanceOf(CosmonerConnectionError);
  });

  it("throws on a non-JSON success response", async () => {
    fetchSpy.mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));

    await expect(send(makeClient(0))).rejects.toThrow("non-JSON");
  });
});

describe("error mapping", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it.each([
    [400, ValidationError],
    [401, AuthenticationError],
    [403, InsufficientScopeError],
    [404, NotFoundError],
    [409, ConflictError],
    [422, ValidationError],
    [429, RateLimitError],
    [500, ServerError],
    [503, ServerError],
  ])("maps %i to its error class", async (status, expected) => {
    fetchSpy.mockResolvedValue(jsonResponse(status as number));

    await expect(send(makeClient(0))).rejects.toBeInstanceOf(expected);
  });
});
