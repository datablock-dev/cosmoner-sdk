import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Cosmoner } from "../index";

const API = "https://api.test.dev";

/** Build a client pointed at the mocked host, with retries disabled. */
function makeClient() {
  return new Cosmoner({ apiKey: "key-123", projectId: "proj-1", baseUrl: API, maxRetries: 0 });
}

/** A JSON response with the API's success envelope. */
function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The URL and method of the one request the spy captured. */
function sent(fetchSpy: ReturnType<typeof vi.spyOn>): { url: string; method: string } {
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  return { url, method: init.method ?? "GET" };
}

describe("RedisService", () => {
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = makeClient();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists the project's Redis databases", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.redis.list();

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/redis`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("fetches one Redis database", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.redis.get("r-1");

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/redis/r-1`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.redis.get("r-1", { projectId: "proj-2" });

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-2/redis/r-1`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("rejects an empty id on get without a request", async () => {
    await expect(client.redis.get("")).rejects.toThrow("redisId is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/** A reply for the write tests below: the API's envelope, or an empty 204. */
function writeReply(data: unknown, status = 200): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The one request a write test sent: its method, URL and parsed JSON body. */
function writeSent(spy: ReturnType<typeof vi.spyOn>): { method: string; url: string; body: unknown } {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  return { method: init.method ?? "GET", url, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) };
}

describe("RedisService writes", () => {
  const P = "https://api.test.dev/v1/projects/proj-1";
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new Cosmoner({ apiKey: "key-123", projectId: "proj-1", baseUrl: "https://api.test.dev", maxRetries: 0 });
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delete sends DELETE and returns the envelope", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({}));

    const result = await client.redis.delete("r-1");

    expect(writeSent(fetchSpy)).toEqual({ method: "DELETE", url: `${P}/redis/r-1`, body: undefined });
    expect(result).toEqual({ success: true, data: {} });
  });

  it("delete honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({}, 200));

    await client.redis.delete("r-1", { projectId: "proj-2" });

    expect(writeSent(fetchSpy).url).toBe(`https://api.test.dev/v1/projects/proj-2/redis/r-1`);
  });

  it("delete requires an id before any request", async () => {
    await expect(client.redis.delete("")).rejects.toThrow("is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("RedisService paid creates", () => {
  const P = "https://api.test.dev/v1/projects/proj-1";
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new Cosmoner({ apiKey: "key-123", projectId: "proj-1", baseUrl: "https://api.test.dev", maxRetries: 0 });
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preview prices a plan", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ subtotal: 1200, tax: null, creditApplied: 0, dueToday: 400, monthly: 1200, currency: "USD", nextBillingDate: "2026-10-25T00:00:00.000Z" }, 200));

    const result = await client.redis.preview({ plan: "valkey-1gb" });

    expect(writeSent(fetchSpy)).toEqual({ method: "GET", url: `${P}/redis/preview?planSlug=valkey-1gb`, body: undefined });
    expect(result).toEqual({ success: true, data: { subtotal: 1200, tax: null, creditApplied: 0, dueToday: 400, monthly: 1200, currency: "USD", nextBillingDate: "2026-10-25T00:00:00.000Z" } });
  });

  it("create renames plan and persistence for the API", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ deployed: true }, 200));

    const result = await client.redis.create({ name: "cache", plan: "valkey-1gb", region: "se-sto", persistence: "AOF_EVERY_1_SECOND" });

    expect(writeSent(fetchSpy)).toEqual({ method: "POST", url: `${P}/redis`, body: { name: "cache", planSlug: "valkey-1gb", region: "se-sto", dataPersistence: "AOF_EVERY_1_SECOND" } });
    expect(result).toEqual({ success: true, data: { deployed: true } });
  });

  it("requires a name, plan and region before any request", async () => {
    await expect(client.redis.create({ name: "cache", plan: "", region: "se-sto" })).rejects.toThrow("is required");
    await expect(client.redis.preview({ plan: "" })).rejects.toThrow("is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
