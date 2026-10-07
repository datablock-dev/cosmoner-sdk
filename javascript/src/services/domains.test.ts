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
