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
