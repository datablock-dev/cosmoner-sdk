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

describe("DomainsService", () => {
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = makeClient();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists the project's domains", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.domains.list();

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/domains`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("fetches a domain by name, encoded for the path", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.domains.get("shop.example.com");

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/domains/shop.example.com`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("encodes a name that would otherwise break the path", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.domains.get("a/b");

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/domains/a%2Fb`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("rejects an empty id on get without a request", async () => {
    await expect(client.domains.get("")).rejects.toThrow("domain is required");
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

describe("DomainsService writes", () => {
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
    fetchSpy.mockResolvedValueOnce(writeReply({ id: "dom-1" }));

    const result = await client.domains.delete("dom-1");

    expect(writeSent(fetchSpy)).toEqual({ method: "DELETE", url: `${P}/domains/dom-1`, body: undefined });
    expect(result).toEqual({ success: true, data: { id: "dom-1" } });
  });

  it("delete honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ id: "dom-1" }, 200));

    await client.domains.delete("dom-1", { projectId: "proj-2" });

    expect(writeSent(fetchSpy).url).toBe(`https://api.test.dev/v1/projects/proj-2/domains/dom-1`);
  });

  it("delete requires an id before any request", async () => {
    await expect(client.domains.delete("")).rejects.toThrow("is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("delete encodes the name it is given", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ id: "dom-1" }, 200));

    await client.domains.delete("shop.example.com/x");

    expect(writeSent(fetchSpy).url).toBe(`${P}/domains/shop.example.com%2Fx`);
  });

  it("create always adds an external domain", async () => {
    const created = { id: "dom-1", name: "example.com", verificationRecord: { type: "TXT", name: "_cosmoner-challenge.example.com", value: "v" } };
    fetchSpy.mockResolvedValueOnce(writeReply(created, 201));

    const result = await client.domains.create("example.com");

    expect(writeSent(fetchSpy)).toEqual({ method: "POST", url: `${P}/domains`, body: { name: "example.com", type: "EXTERNAL" } });
    expect(result).toEqual({ success: true, data: created });
  });

  it("create requires a name before any request", async () => {
    await expect(client.domains.create("")).rejects.toThrow("name is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("verify posts to the domain, encoding its name", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ status: "ACTIVE", verified: true }));

    const result = await client.domains.verify("example.com");

    expect(writeSent(fetchSpy)).toEqual({ method: "POST", url: `${P}/domains/example.com/verify`, body: undefined });
    expect(result.data.verified).toBe(true);
  });

  it("verify requires a domain before any request", async () => {
    await expect(client.domains.verify("")).rejects.toThrow("domain is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
