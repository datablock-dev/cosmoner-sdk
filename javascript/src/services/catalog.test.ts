import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Cosmoner } from "../index";

const API = "https://api.test.dev";

/** A JSON response with the API's success envelope. */
function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CatalogService", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["serverSizes", "/v1/catalog/servers/sizes"],
    ["serverRegions", "/v1/catalog/servers/regions"],
    ["serverImages", "/v1/catalog/servers/1-clicks"],
    ["redisPlans", "/v1/catalog/redis/plans"],
    ["redisRegions", "/v1/catalog/redis/regions"],
    ["databases", "/v1/catalog/databases"],
    ["appSizes", "/v1/catalog/apps/sizes"],
    ["appRegions", "/v1/catalog/apps/regions"],
  ] as const)("%s reads %s, with or without a default project", async (method, route) => {
    fetchSpy.mockImplementation(() => Promise.resolve(ok([{ slug: "x" }])));
    const scoped = new Cosmoner({ apiKey: "key-123", projectId: "proj-1", baseUrl: API, maxRetries: 0 });
    const unscoped = new Cosmoner({ apiKey: "key-123", baseUrl: API, maxRetries: 0 });

    const result = await scoped.catalog[method]();
    await unscoped.catalog[method]();

    for (const [url, init] of fetchSpy.mock.calls as Array<[string, RequestInit]>) {
      expect(url).toBe(`${API}${route}`);
      expect(init.method).toBe("GET");
    }
    expect(result).toEqual({ success: true, data: [{ slug: "x" }] });
  });
});
