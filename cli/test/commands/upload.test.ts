/* eslint-disable require-await -- The in-memory server's methods are async to
   match RemoteFs, though nothing inside them waits. */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../../src/cli";
import type * as Sftp from "../../src/sftp";
import { connectSftp, HostKeyMismatchError, type RemoteFs, type RemoteKind } from "../../src/sftp";

/**
 * Drives `cosmoner upload` through the real entry point against a mocked API
 * and an in-memory SFTP server, asserting on what ends up on the "server".
 */

vi.mock("../../src/sftp", async (importOriginal) => ({
  ...(await importOriginal<typeof Sftp>()),
  connectSftp: vi.fn(),
}));

const API = "https://api.test.dev/v1/projects/proj-1/hosting/shared";
const ENV = {
  COSMONER_API_KEY: "key-123",
  COSMONER_PROJECT_ID: "proj-1",
  COSMONER_API_URL: "https://api.test.dev",
};
const FINGERPRINT = "SHA256:PfqYSl1pbMjfMKAbcmjzGZ0t1kpuCZ2mtymdyLu9HwA";
const DOCROOT = "/my-site.cosmoner.com/public_html";

const SITE = {
  id: "site-1",
  siteName: "my-site",
  unixUser: "h_mysite_x7k2mf",
  documentRoot: `/var/www/h_mysite_x7k2mf${DOCROOT}`,
  status: "ACTIVE",
  sftpHost: "sftp.cosmoner.com",
  sftpPort: 2222,
};

/** An SFTP server's tree held in a map from absolute path to what is there. */
class MemoryFs implements RemoteFs {
  readonly entries = new Map<string, RemoteKind>([["/", "directory"]]);
  readonly puts: string[] = [];
  closed = false;

  /** Adds paths as the server already has them; a trailing slash marks a folder. */
  seed(...paths: string[]): this {
    for (const path of paths) {
      const clean = path.replace(/\/$/, "");
      for (let parent = dirname(clean); parent !== "/"; parent = dirname(parent)) {
        this.entries.set(parent, "directory");
      }
      this.entries.set(clean, path.endsWith("/") ? "directory" : "file");
    }
    return this;
  }

  /** The files under a folder, relative to it. */
  filesUnder(root: string): string[] {
    return [...this.entries]
      .filter(([path, kind]) => kind === "file" && path.startsWith(`${root}/`))
      .map(([path]) => path.slice(root.length + 1))
      .toSorted();
  }

  async kind(path: string) {
    return this.entries.get(path) ?? null;
  }

  async list(path: string) {
    const prefix = path === "/" ? "/" : `${path}/`;
    return [...this.entries]
      .filter(([candidate]) => candidate.startsWith(prefix) && candidate !== path && !candidate.slice(prefix.length).includes("/"))
      .map(([candidate, kind]) => ({ name: candidate.slice(prefix.length), kind }));
  }

  async mkdir(path: string) {
    if (this.entries.get(dirname(path)) !== "directory") throw new Error(`${path}: No such file`);
    this.entries.set(path, "directory");
  }

  async put(_localPath: string, remotePath: string) {
    if (this.entries.get(dirname(remotePath)) !== "directory") throw new Error(`${remotePath}: No such file`);
    this.entries.set(remotePath, "file");
    this.puts.push(remotePath);
  }

  async removeFile(path: string) {
    this.entries.delete(path);
  }

  async removeDir(path: string) {
    if ((await this.list(path)).length > 0) throw new Error(`${path}: Failure`);
    this.entries.delete(path);
  }

  close() {
    this.closed = true;
  }
}

let out: string[];
let err: string[];
let fetchSpy: ReturnType<typeof vi.spyOn>;
let workspace: string;
let server: MemoryFs;

/** A JSON response with the API's success envelope. */
function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Writes files into the local folder being uploaded. */
function local(files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(workspace, "dist", path)), { recursive: true });
    writeFileSync(join(workspace, "dist", path), content);
  }
}

/** Answers the site list and the credentialed detail read. */
function mockSite(overrides: Partial<typeof SITE> = {}): void {
  fetchSpy
    .mockResolvedValueOnce(ok([{ ...SITE, ...overrides }]))
    .mockResolvedValueOnce(ok({ ...SITE, ...overrides, ready: true, sftpPassword: "s3cret" }));
}

/** Runs `cosmoner upload` with the given arguments. */
async function upload(argv: string[], env: Record<string, string> = ENV) {
  const code = await run(["upload", ...argv], workspace, false, env);
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

beforeEach(() => {
  out = [];
  err = [];
  workspace = mkdtempSync(join(tmpdir(), "cosmoner-upload-"));
  mkdirSync(join(workspace, "dist"));
  server = new MemoryFs();
  vi.mocked(connectSftp).mockImplementation(async () => ({ fs: server, fingerprint: FINGERPRINT }));
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.mocked(connectSftp).mockReset();
});

describe("upload", () => {
  it("uploads into the site's document root, creating it and its folders", async () => {
    local({ "index.php": "<?php", "css/site.css": "body{}" });
    mockSite();

    const result = await upload(["my-site", "dist"]);

    expect(result.code).toBe(0);
    expect(server.filesUnder(DOCROOT)).toEqual(["css/site.css", "index.php"]);
    expect(server.closed).toBe(true);
    expect(result.stdout).toContain(`Uploading dist to my-site:${DOCROOT} (2 files, 11 B)`);
    expect(result.stdout).toContain("✓ Uploaded 2 files");
  });

  it("logs in with the credentials the API returned", async () => {
    local({ "index.html": "hi" });
    mockSite();

    await upload(["site-1", "dist", "--host-key", FINGERPRINT]);

    expect(fetchSpy.mock.calls[1][0]).toBe(`${API}/site-1?credentials=true`);
    expect(connectSftp).toHaveBeenCalledWith({
      host: "sftp.cosmoner.com",
      port: 2222,
      username: "h_mysite_x7k2mf",
      password: "s3cret",
      hostKeys: [FINGERPRINT],
    });
  });

  it("never prints the password", async () => {
    local({ "index.html": "hi" });
    mockSite();

    const result = await upload(["my-site", "dist", "--format", "json"]);

    expect(`${result.stdout}${result.stderr}`).not.toContain("s3cret");
  });

  it("reads pinned host keys from the environment", async () => {
    local({ "index.html": "hi" });
    mockSite();

    const result = await upload(["my-site", "dist"], { ...ENV, COSMONER_SFTP_HOST_KEY: `${FINGERPRINT}, SHA256:other` });

    expect(vi.mocked(connectSftp).mock.calls[0][0].hostKeys).toEqual([FINGERPRINT, "SHA256:other"]);
    expect(result.stdout).not.toContain("pin it");
  });

  it("suggests pinning the host key when none is pinned", async () => {
    local({ "index.html": "hi" });
    mockSite();

    const result = await upload(["my-site", "dist"]);

    expect(result.stdout).toContain(`host key ${FINGERPRINT} — pin it with COSMONER_SFTP_HOST_KEY`);
  });

  it("uploads into --remote instead of the document root", async () => {
    local({ "style.css": "a{}" });
    mockSite();

    expect((await upload(["my-site", "dist", "--remote", "shop.example.com/public_html/"])).code).toBe(0);
    expect(server.filesUnder("/shop.example.com/public_html")).toEqual(["style.css"]);
  });

  it("leaves files that are not in the folder alone by default", async () => {
    server.seed(`${DOCROOT}/old.html`);
    local({ "index.html": "hi" });
    mockSite();

    await upload(["my-site", "dist"]);

    expect(server.filesUnder(DOCROOT)).toEqual(["index.html", "old.html"]);
  });

  it("removes files and folders that are not in the folder with --delete", async () => {
    server.seed(`${DOCROOT}/old.html`, `${DOCROOT}/legacy/app.js`, `${DOCROOT}/keep/`, "/other.example.com/public_html/index.html");
    local({ "index.html": "hi", "keep/a.txt": "a" });
    mockSite();

    const result = await upload(["my-site", "dist", "--delete"]);

    expect(result.code).toBe(0);
    expect(server.filesUnder(DOCROOT)).toEqual(["index.html", "keep/a.txt"]);
    expect(server.entries.has(`${DOCROOT}/legacy`)).toBe(false);
    expect(server.filesUnder("/other.example.com")).toEqual(["public_html/index.html"]);
    expect(result.stdout).toContain("removed 3");
  });

  it("changes nothing with --dry-run", async () => {
    server.seed(`${DOCROOT}/old.html`);
    local({ "index.html": "hi" });
    mockSite();

    const result = await upload(["my-site", "dist", "--delete", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(server.puts).toEqual([]);
    expect(server.filesUnder(DOCROOT)).toEqual(["old.html"]);
    expect(result.stdout).toContain("upload index.html");
    expect(result.stdout).toContain("remove old.html");
  });

  it("does not upload .git or symlinks", async () => {
    local({ "index.html": "hi", ".git/config": "[core]" });
    symlinkSync(join(workspace, "dist", "index.html"), join(workspace, "dist", "link.html"));
    mockSite();

    const result = await upload(["my-site", "dist"]);

    expect(server.filesUnder(DOCROOT)).toEqual(["index.html"]);
    expect(result.stdout).toContain("skipped link.html");
  });

  it("prints only JSON with --format json", async () => {
    local({ "index.html": "hi" });
    mockSite();

    const result = await upload(["my-site", "dist", "--format", "json"]);

    expect(JSON.parse(result.stdout)).toMatchObject({
      site: { id: "site-1", name: "my-site" },
      remote: DOCROOT,
      dryRun: false,
      uploaded: ["index.html"],
      removed: [],
      bytes: 2,
    });
  });

  it("refuses a file where the site has a folder", async () => {
    server.seed(`${DOCROOT}/blog/`);
    local({ blog: "not a folder" });
    mockSite();

    const result = await upload(["my-site", "dist"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("blog is a file on one side and a folder on the other");
    expect(server.puts).toEqual([]);
  });

  it("exits 1 for a site that is not active, without connecting", async () => {
    local({ "index.html": "hi" });
    mockSite({ status: "PROVISIONING" });

    const result = await upload(["my-site", "dist"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("my-site is PROVISIONING, not ACTIVE");
    expect(connectSftp).not.toHaveBeenCalled();
  });

  it("exits 1 for a site that does not exist", async () => {
    local({ "index.html": "hi" });
    fetchSpy.mockResolvedValueOnce(ok([SITE]));

    const result = await upload(["other", "dist"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('No hosting site named "other"');
  });

  it("exits 1 on a host key mismatch, saying what to do", async () => {
    local({ "index.html": "hi" });
    mockSite();
    vi.mocked(connectSftp).mockRejectedValueOnce(new HostKeyMismatchError("SHA256:evil"));

    const result = await upload(["my-site", "dist", "--host-key", FINGERPRINT]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("host key SHA256:evil, which is not a pinned key");
  });

  it("exits 1 for an empty folder before calling the API", async () => {
    const result = await upload(["my-site", "dist", "--delete"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("dist has no files to upload");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("usage", () => {
    it("exits 2 without an API key", async () => {
      local({ "index.html": "hi" });

      const result = await upload(["my-site", "dist"], { COSMONER_PROJECT_ID: "proj-1" });

      expect(result.code).toBe(2);
      expect(result.stderr).toContain("COSMONER_API_KEY");
    });

    it("exits 2 when the folder is missing", async () => {
      const result = await upload(["my-site", "build"]);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain("build is not a folder");
    });

    it("exits 2 without a folder", async () => {
      expect((await upload(["my-site"])).code).toBe(2);
    });

    it("refuses --delete on the site's root", async () => {
      local({ "index.html": "hi" });

      const result = await upload(["my-site", "dist", "--delete", "--remote", "/"]);

      expect(result.code).toBe(2);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses .. in --remote", async () => {
      local({ "index.html": "hi" });

      expect((await upload(["my-site", "dist", "--remote", "public_html/../.."])).code).toBe(2);
    });
  });
});
