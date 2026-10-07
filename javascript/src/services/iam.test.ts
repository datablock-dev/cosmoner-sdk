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

describe("IamService", () => {
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = makeClient();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists the project's credentials", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.iam.list();

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/iam`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("fetches one credential by IAM user name", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.iam.get("cosmoner-ci");

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/iam/cosmoner-ci`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("rejects an empty id on get without a request", async () => {
    await expect(client.iam.get("")).rejects.toThrow("iamUserName is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
