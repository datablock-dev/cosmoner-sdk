import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Cosmoner } from "../index";

const BASE = "https://api.test.dev/v1/projects/proj-1/hosting/shared";

/** Build a client pointed at the mocked host, with retries disabled. */
function makeClient() {
  return new Cosmoner({
    apiKey: "key-123",
    projectId: "proj-1",
    baseUrl: "https://api.test.dev",
    maxRetries: 0,
  });
}

/** A JSON response with the API's success envelope. */
function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A provisioned hosting site. */
function site() {
  return {
    id: "site-1",
    siteName: "blog",
    phpVersion: "8.3",
    unixUser: "u_blog",
    documentRoot: "/var/www/u_blog/blog.cosmoner.com/public_html",
    internalHostname: "blog.cosmoner.com",
    url: "https://blog.cosmoner.com",
    tier: "shared-xs",
    sshEnabled: false,
    status: "ACTIVE",
    sftpHost: "sftp.cosmoner.com",
    sftpPort: 2222,
    createdAt: "2026-09-01T12:00:00.000Z",
  };
}

describe("HostingService", () => {
  let client: Cosmoner;

  beforeEach(() => {
    client = makeClient();
  });

  describe("argument validation", () => {
    it("requires a siteId on get", async () => {
      await expect(client.hosting.get("")).rejects.toThrow("siteId is required");
    });

    it("requires a siteId on access", async () => {
      await expect(client.hosting.access("")).rejects.toThrow("siteId is required");
    });
  });

  describe("API calls", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("lists sites", async () => {
      fetchSpy.mockResolvedValueOnce(ok([site()]));

      const result = await client.hosting.list();

      expect(result.data[0].siteName).toBe("blog");
      expect(fetchSpy).toHaveBeenCalledWith(BASE, expect.objectContaining({ method: "GET" }));
    });

    it("fetches a site without a query string by default", async () => {
      fetchSpy.mockResolvedValueOnce(ok({ ...site(), ready: true }));

      const result = await client.hosting.get("site-1");

      expect(result.data.ready).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/site-1`,
        expect.objectContaining({ method: "GET" })
      );
    });

    it("asks for credentials when requested", async () => {
      fetchSpy.mockResolvedValueOnce(ok({ ...site(), ready: true, sftpPassword: "s3cret" }));

      const result = await client.hosting.get("site-1", { credentials: true });

      expect(result.data.sftpPassword).toBe("s3cret");
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/site-1?credentials=true`,
        expect.objectContaining({ method: "GET" })
      );
    });

    it("fetches a site's access details", async () => {
      fetchSpy.mockResolvedValueOnce(
        ok({
          username: "u_blog",
          host: "sftp.cosmoner.com",
          sftp: { port: 2222 },
          ssh: { port: 2222, enabled: false },
        })
      );

      const result = await client.hosting.access("site-1");

      expect(result.data.sftp.port).toBe(2222);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/site-1/access`,
        expect.objectContaining({ method: "GET" })
      );
    });

    it("targets another project per call", async () => {
      fetchSpy.mockResolvedValueOnce(ok([]));

      await client.hosting.list({ projectId: "proj-2" });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.test.dev/v1/projects/proj-2/hosting/shared",
        expect.objectContaining({ method: "GET" })
      );
    });
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

describe("HostingService writes", () => {
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

    const result = await client.hosting.delete("site-1");

    expect(writeSent(fetchSpy)).toEqual({ method: "DELETE", url: `${P}/hosting/shared/site-1`, body: undefined });
    expect(result).toEqual({ success: true, data: {} });
  });

  it("delete honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({}, 200));

    await client.hosting.delete("site-1", { projectId: "proj-2" });

    expect(writeSent(fetchSpy).url).toBe(`https://api.test.dev/v1/projects/proj-2/hosting/shared/site-1`);
  });

  it("delete requires an id before any request", async () => {
    await expect(client.hosting.delete("")).rejects.toThrow("is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("HostingService paid creates", () => {
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

  it("prices lists the plans", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply([{ tier: "STARTER", monthly: 500, currency: "usd" }], 200));

    const result = await client.hosting.prices();

    expect(writeSent(fetchSpy)).toEqual({ method: "GET", url: `${P}/hosting/shared/prices`, body: undefined });
    expect(result).toEqual({ success: true, data: [{ tier: "STARTER", monthly: 500, currency: "usd" }] });
  });

  it("preview prices a tier with no extra storage by default", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ subtotal: 1200, tax: null, creditApplied: 0, dueToday: 400, monthly: 1200, currency: "USD", nextBillingDate: "2026-10-25T00:00:00.000Z" }, 200));

    const result = await client.hosting.preview({ tier: "GROWTH" });

    expect(writeSent(fetchSpy)).toEqual({ method: "GET", url: `${P}/hosting/shared/preview?tier=GROWTH&extraStorageGb=0`, body: undefined });
    expect(result).toEqual({ success: true, data: { subtotal: 1200, tax: null, creditApplied: 0, dueToday: 400, monthly: 1200, currency: "USD", nextBillingDate: "2026-10-25T00:00:00.000Z" } });
  });

  it("create nests the database name and sends only what it was given", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ tenantId: "site-1", status: "ACTIVE" }, 201));

    const result = await client.hosting.create({ siteName: "blog", tier: "GROWTH", database: "wp" });

    expect(writeSent(fetchSpy)).toEqual({ method: "POST", url: `${P}/hosting/shared`, body: { siteName: "blog", tier: "GROWTH", database: { name: "wp" } } });
    expect(result).toEqual({ success: true, data: { tenantId: "site-1", status: "ACTIVE" } });
  });

  it("requires a site name and tier before any request", async () => {
    await expect(client.hosting.create({ siteName: "" })).rejects.toThrow("is required");
    await expect(client.hosting.preview({ tier: "" as never })).rejects.toThrow("is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
