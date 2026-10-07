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

describe("ServersService", () => {
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = makeClient();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists the project's servers", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.servers.list();

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/servers`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("fetches one server", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.servers.get("srv-1");

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/servers/srv-1`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.servers.list({ projectId: "proj-2" });

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-2/servers`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("rejects an empty id on get without a request", async () => {
    await expect(client.servers.get("")).rejects.toThrow("serverId is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
