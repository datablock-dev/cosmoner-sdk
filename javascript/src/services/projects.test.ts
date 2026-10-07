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

describe("ProjectsService", () => {
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = makeClient();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists every project the credential can reach, ignoring the default project", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.projects.list();

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("fetches a project by id or slug", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.projects.get("acme web");

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/acme%20web`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("rejects an empty id on get without a request", async () => {
    await expect(client.projects.get("")).rejects.toThrow("project is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/** A JSON reply in the API's envelope. */
function writeReply(data: unknown, status = 200): Response {
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

describe("ProjectsService writes", () => {
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = makeClient();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("update renames the named project, not the default one", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ id: "proj-9", name: "Shop", slug: "shop", billingEmail: null }));

    const result = await client.projects.update("proj-9", { name: "Shop" });

    expect(writeSent(fetchSpy)).toEqual({ method: "PATCH", url: `${API}/v1/projects/proj-9`, body: { name: "Shop" } });
    expect(result).toEqual({ success: true, data: { id: "proj-9", name: "Shop", slug: "shop", billingEmail: null } });
  });

  it("delete sends DELETE for the named project", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply(null));

    const result = await client.projects.delete("acme web");

    expect(writeSent(fetchSpy)).toEqual({ method: "DELETE", url: `${API}/v1/projects/acme%20web`, body: undefined });
    expect(result).toEqual({ success: true, data: null });
  });

  it("requires a project and a name before any request", async () => {
    await expect(client.projects.update("", { name: "x" })).rejects.toThrow("project is required");
    await expect(client.projects.update("proj-9", { name: "" })).rejects.toThrow("name is required");
    await expect(client.projects.delete("")).rejects.toThrow("project is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
