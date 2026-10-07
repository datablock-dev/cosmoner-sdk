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

describe("DatabasesService", () => {
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = makeClient();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists every database of every kind", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.databases.list();

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/databases`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("lists dedicated databases", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.databases.listDedicated();

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/databases/dedicated`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("fetches one dedicated database", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.databases.getDedicated("db-1");

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/databases/dedicated/db-1`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("lists shared databases", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.databases.listShared();

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/databases/shared`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("fetches one shared database", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.databases.getShared("t-1");

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/databases/shared/t-1`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.databases.list({ projectId: "proj-2" });

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-2/databases`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("rejects an empty id on getDedicated without a request", async () => {
    await expect(client.databases.getDedicated("")).rejects.toThrow("databaseId is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an empty id on getShared without a request", async () => {
    await expect(client.databases.getShared("")).rejects.toThrow("tenantId is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
