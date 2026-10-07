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

describe("ServersService writes", () => {
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

    const result = await client.servers.delete("srv-1");

    expect(writeSent(fetchSpy)).toEqual({ method: "DELETE", url: `${P}/servers/srv-1`, body: undefined });
    expect(result).toEqual({ success: true, data: {} });
  });

  it("delete honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({}, 200));

    await client.servers.delete("srv-1", { projectId: "proj-2" });

    expect(writeSent(fetchSpy).url).toBe(`https://api.test.dev/v1/projects/proj-2/servers/srv-1`);
  });

  it("delete requires an id before any request", async () => {
    await expect(client.servers.delete("")).rejects.toThrow("is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ServersService paid creates", () => {
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

  it("preview prices a size, defaulting the provider", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ subtotal: 1200, tax: null, creditApplied: 0, dueToday: 400, monthly: 1200, currency: "USD", nextBillingDate: "2026-10-25T00:00:00.000Z" }, 200));

    const result = await client.servers.preview({ size: "s-1vcpu-1gb" });

    expect(writeSent(fetchSpy)).toEqual({ method: "GET", url: `${P}/servers/preview?provider=digitalocean&slug=s-1vcpu-1gb`, body: undefined });
    expect(result).toEqual({ success: true, data: { subtotal: 1200, tax: null, creditApplied: 0, dueToday: 400, monthly: 1200, currency: "USD", nextBillingDate: "2026-10-25T00:00:00.000Z" } });
  });

  it("create sends the API's field names and the default provider", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ deployed: true }, 200));

    const result = await client.servers.create({ name: "box", size: "s-1vcpu-1gb", region: "ams3", image: "docker-20-04", sshKeyIds: ["key-1"] });

    expect(writeSent(fetchSpy)).toEqual({ method: "POST", url: `${P}/servers`, body: { name: "box", slug: "s-1vcpu-1gb", provider: "digitalocean", region: "ams3", template: "docker-20-04", sshKeyIds: ["key-1"] } });
    expect(result).toEqual({ success: true, data: { deployed: true } });
  });

  it("create leaves out what it was not given and honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ deployed: true }, 200));

    const result = await client.servers.create({ name: "box", size: "s-1", region: "ams3", projectId: "proj-2" });

    expect(writeSent(fetchSpy)).toEqual({ method: "POST", url: `https://api.test.dev/v1/projects/proj-2/servers`, body: { name: "box", slug: "s-1", provider: "digitalocean", region: "ams3" } });
    expect(result).toEqual({ success: true, data: { deployed: true } });
  });

  it("requires a name, size and region before any request", async () => {
    await expect(client.servers.create({ name: "", size: "s", region: "r" })).rejects.toThrow("is required");
    await expect(client.servers.preview({ size: "" })).rejects.toThrow("is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
