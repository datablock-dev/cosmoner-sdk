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

describe("DatabasesService writes", () => {
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

  it("deleteDedicated sends DELETE and returns the envelope", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({}));

    const result = await client.databases.deleteDedicated("db-1");

    expect(writeSent(fetchSpy)).toEqual({ method: "DELETE", url: `${P}/databases/dedicated/db-1`, body: undefined });
    expect(result).toEqual({ success: true, data: {} });
  });

  it("deleteDedicated honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({}, 200));

    await client.databases.deleteDedicated("db-1", { projectId: "proj-2" });

    expect(writeSent(fetchSpy).url).toBe(`https://api.test.dev/v1/projects/proj-2/databases/dedicated/db-1`);
  });

  it("deleteDedicated requires an id before any request", async () => {
    await expect(client.databases.deleteDedicated("")).rejects.toThrow("is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("deleteShared sends DELETE and returns the envelope", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({}));

    const result = await client.databases.deleteShared("t-1");

    expect(writeSent(fetchSpy)).toEqual({ method: "DELETE", url: `${P}/databases/shared/t-1`, body: undefined });
    expect(result).toEqual({ success: true, data: {} });
  });

  it("deleteShared honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({}, 200));

    await client.databases.deleteShared("t-1", { projectId: "proj-2" });

    expect(writeSent(fetchSpy).url).toBe(`https://api.test.dev/v1/projects/proj-2/databases/shared/t-1`);
  });

  it("deleteShared requires an id before any request", async () => {
    await expect(client.databases.deleteShared("")).rejects.toThrow("is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("DatabasesService paid creates", () => {
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

  it("previewDedicated prices a size", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ subtotal: 1200, tax: null, creditApplied: 0, dueToday: 400, monthly: 1200, currency: "USD", nextBillingDate: "2026-10-25T00:00:00.000Z" }, 200));

    const result = await client.databases.previewDedicated({ size: "db-small" });

    expect(writeSent(fetchSpy)).toEqual({ method: "GET", url: `${P}/databases/dedicated/preview?slug=db-small`, body: undefined });
    expect(result).toEqual({ success: true, data: { subtotal: 1200, tax: null, creditApplied: 0, dueToday: 400, monthly: 1200, currency: "USD", nextBillingDate: "2026-10-25T00:00:00.000Z" } });
  });

  it("createDedicated defaults the engine and renames the size", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ deployed: true }, 200));

    const result = await client.databases.createDedicated({ name: "main", size: "db-small", version: "17", region: "se-sto" });

    expect(writeSent(fetchSpy)).toEqual({ method: "POST", url: `${P}/databases/dedicated`, body: { name: "main", engine: "POSTGRESQL", version: "17", slug: "db-small", region: "se-sto" } });
    expect(result).toEqual({ success: true, data: { deployed: true } });
  });

  it("requires a name, size, version and region before any request", async () => {
    await expect(client.databases.createDedicated({ name: "main", size: "db-small", version: "", region: "se-sto" })).rejects.toThrow("is required");
    await expect(client.databases.previewDedicated({ size: "" })).rejects.toThrow("is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("DatabasesService password rotation", () => {
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = makeClient();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rotateSharedPassword posts and returns the new password", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ password: "new-pw", connectionUri: "postgresql://u:new-pw@h/db" }));

    const result = await client.databases.rotateSharedPassword("tenant-1");

    expect(writeSent(fetchSpy)).toEqual({ method: "POST", url: `${API}/v1/projects/proj-1/databases/shared/tenant-1/rotate-password`, body: undefined });
    expect(result).toEqual({ success: true, data: { password: "new-pw", connectionUri: "postgresql://u:new-pw@h/db" } });
  });

  it("rotateSharedPassword honours a per-call project and requires an id", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ password: "p", connectionUri: "u" }));

    await client.databases.rotateSharedPassword("tenant-1", { projectId: "proj-2" });
    await expect(client.databases.rotateSharedPassword("")).rejects.toThrow("tenantId is required");

    expect(writeSent(fetchSpy).url).toBe(`${API}/v1/projects/proj-2/databases/shared/tenant-1/rotate-password`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
