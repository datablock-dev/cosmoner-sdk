import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../../src/cli";

/**
 * Drives `cosmoner <product> get` and `cosmoner apps logs` through the real
 * entry point against a mocked API.
 *
 * Most of what is asserted is what an agent depends on: which routes a read
 * calls, that `--format json` prints the API's objects as they are, and that
 * no credential reaches stdout in either format.
 */

const BASE = "https://api.test.dev";
const P = `${BASE}/v1/projects/proj-1`;
const ENV = { COSMONER_API_KEY: "db_key", COSMONER_PROJECT_ID: "proj-1", COSMONER_API_URL: BASE };

let out: string[];
let err: string[];
let fetchSpy: ReturnType<typeof vi.spyOn>;

/** A JSON response with the API's success envelope. */
function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Answers each request by its URL, failing the test on any it does not expect. */
function routes(table: Record<string, unknown>): void {
  fetchSpy.mockImplementation((input: string | URL | Request) => {
    const url = String(input);
    if (!(url in table)) throw new Error(`Unexpected request to ${url}`);
    return Promise.resolve(ok(table[url]));
  });
}

/** The URLs requested, in order. */
function requested(): string[] {
  return (fetchSpy.mock.calls as Array<[string]>).map(([url]) => String(url));
}

/** Runs one command line. */
async function cli(argv: string[], env: Record<string, string> = ENV) {
  const code = await run(argv, "/", false, env);
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const APP = { id: "app-1", name: "web", status: "ACTIVE", url: "https://web.cosmoner.app", gitRepo: null, containerImage: "registry.cosmoner.com/acme/web:v2", createdAt: "2026-09-01T00:00:00.000Z" };

describe("cosmoner <product> get", () => {
  it("lists with no reference, as a table", async () => {
    routes({ [`${P}/apps`]: [APP, { ...APP, id: "app-2", name: "api", url: null }] });

    const result = await cli(["apps", "get"]);

    expect(result.code).toBe(0);
    expect(result.stdout.split("\n")[0]).toMatch(/^NAME\s+STATUS\s+URL\s+SOURCE\s+CREATED$/);
    expect(result.stdout).toContain("web");
    expect(result.stdout).toMatch(/api\s+ACTIVE\s+-\s+/);
  });

  it("accepts list as the same thing", async () => {
    routes({ [`${P}/apps`]: [APP] });

    expect((await cli(["apps", "list"])).stdout).toContain("web");
  });

  it("prints the API's array as is with --format json", async () => {
    routes({ [`${P}/apps`]: [APP] });

    const result = await cli(["apps", "get", "--format", "json"]);

    expect(JSON.parse(result.stdout)).toEqual([APP]);
  });

  it("resolves a name to its id and fetches the full item", async () => {
    routes({ [`${P}/apps`]: [APP], [`${P}/apps/app-1`]: { ...APP, instances: 2 } });

    const result = await cli(["apps", "get", "web", "--format", "json"]);

    expect(result.code).toBe(0);
    expect(requested()).toEqual([`${P}/apps`, `${P}/apps/app-1`]);
    expect(JSON.parse(result.stdout)).toMatchObject({ id: "app-1", instances: 2 });
  });

  it("shows one item as key: value lines, nested fields dotted", async () => {
    routes({ [`${P}/servers`]: [{ id: "srv-1", name: "db-box" }], [`${P}/servers/srv-1`]: { id: "srv-1", name: "db-box", sshKeys: [{ id: "k1", name: "laptop" }] } });

    const result = await cli(["servers", "get", "db-box"]);

    expect(result.stdout).toMatch(/^id:\s+srv-1$/m);
    expect(result.stdout).toMatch(/^sshKeys\[0\]\.name:\s+laptop$/m);
  });

  it("exits 1 for a reference that names nothing", async () => {
    routes({ [`${P}/apps`]: [APP] });

    const result = await cli(["apps", "get", "nope"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('No app "nope" in this project.');
  });

  it("exits 2 for a bad command line, before any request", async () => {
    expect((await cli(["apps"])).code).toBe(2);
    expect((await cli(["apps", "show"])).code).toBe(2);
    expect((await cli(["apps", "list", "web"])).code).toBe(2);
    expect((await cli(["apps", "get", "--format", "yaml"])).code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says so when there is nothing to list", async () => {
    routes({ [`${P}/servers`]: [] });

    expect((await cli(["servers", "get"])).stdout).toBe("No servers.");
  });
});

describe("credentials never reach stdout", () => {
  const REDIS = { id: "r-1", name: "cache", engine: "VALKEY", status: "ACTIVE", memoryMb: 256, region: "fra", host: "cache.internal" };

  it("hides a Redis password, in text and in JSON", async () => {
    routes({ [`${P}/redis`]: [REDIS], [`${P}/redis/r-1`]: { ...REDIS, password: "hunter2" } });

    const text = await cli(["redis", "get", "cache"]);
    const json = await cli(["redis", "get", "cache", "--format", "json"]);

    expect(text.stdout).toMatch(/^password:\s+\[hidden\]$/m);
    expect(JSON.parse(json.stdout.slice(text.stdout.length + 1)).password).toBe("[hidden]");
    expect(out.join("\n")).not.toContain("hunter2");
  });

  it("hides a dedicated database's connection URI, and reads a shared one by its own route", async () => {
    const dedicated = { kind: "DEDICATED", id: "db-1", name: "main", engine: "POSTGRESQL", status: "ONLINE" };
    const shared = { kind: "LEGACY_POOLED", id: "t-1", name: "small", engine: "POSTGRESQL", status: "ACTIVE" };
    routes({
      [`${P}/databases`]: [dedicated, shared],
      [`${P}/databases/dedicated/db-1`]: { ...dedicated, connectionUri: "postgresql://app:s3cr3t@db.internal:5432/app" },
      [`${P}/databases/shared/t-1`]: { ...shared, dbUser: "small_user" },
    });

    await cli(["databases", "get", "main", "--format", "json"]);
    await cli(["databases", "get", "small"]);

    expect(requested()).toContain(`${P}/databases/dedicated/db-1`);
    expect(requested()).toContain(`${P}/databases/shared/t-1`);
    expect(out.join("\n")).not.toContain("s3cr3t");
    expect(out.join("\n")).toContain("small_user");
  });

  it("masks a password in a URL wherever it appears, under any field name", async () => {
    routes({ [`${P}/apps`]: [APP], [`${P}/apps/app-1`]: { ...APP, envVars: [{ key: "DATABASE_URL", value: "postgres://u:leaked@h/db" }] } });

    await cli(["apps", "get", "web", "--format", "json"]);

    expect(out.join("\n")).not.toContain("leaked");
  });

  it("masks credentials an app printed to its log", async () => {
    routes({
      [`${P}/apps`]: [APP],
      [`${P}/apps/app-1/logs?type=RUN`]: { lines: [{ message: "connecting to redis://:pw123@cache:6379", timestamp: "t" }] },
    });

    const result = await cli(["apps", "logs", "web"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("redis://:[hidden]@cache:6379");
    expect(result.stdout).not.toContain("pw123");
  });
});

describe("product specifics", () => {
  it("lists projects without needing a project", async () => {
    routes({ [`${BASE}/v1/projects`]: [{ id: "proj-1", slug: "acme", name: "Acme", _count: { apps: 2, servers: 0, databaseClusters: 1, members: 3 } }] });

    const result = await cli(["projects", "get"], { COSMONER_API_KEY: "db_key", COSMONER_API_URL: BASE });

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/acme\s+Acme\s+2\s+0\s+1\s+3/);
  });

  it("finds a project by slug and fetches it by id", async () => {
    const project = { id: "proj-1", slug: "acme", name: "Acme", _count: {} };
    routes({ [`${BASE}/v1/projects`]: [project], [`${BASE}/v1/projects/proj-1`]: project });

    expect((await cli(["projects", "get", "acme"])).code).toBe(0);
    expect(requested()).toEqual([`${BASE}/v1/projects`, `${BASE}/v1/projects/proj-1`]);
  });

  it("reads a build log when asked", async () => {
    routes({ [`${P}/apps`]: [APP], [`${P}/apps/app-1/logs?type=BUILD`]: { lines: [] } });

    const result = await cli(["apps", "logs", "web", "--type", "build"]);

    expect(result.stdout).toBe("No build log lines for web.");
  });

  it("lists IAM credentials from the API's wrapper object", async () => {
    routes({ [`${P}/iam`]: { credentials: [{ iamUserName: "cosmoner-ci", label: "CI", origin: "registry", createdAt: "2026-09-01T00:00:00Z" }], errors: [] } });

    expect((await cli(["iam", "get"])).stdout).toMatch(/cosmoner-ci\s+CI\s+registry/);
  });

  it("finds an email domain by its domain name", async () => {
    const domain = { id: "ed-1", status: "ACTIVE", domain: { name: "example.com" }, credentials: [] };
    routes({ [`${P}/email`]: [domain], [`${P}/email/ed-1`]: domain });

    expect((await cli(["email", "get", "example.com"])).code).toBe(0);
  });

  it("reads another project with --project", async () => {
    routes({ [`${BASE}/v1/projects/beta/domains`]: [] });

    expect((await cli(["domains", "get", "--project", "beta"])).code).toBe(0);
  });
});

describe("secrets and variables answer get", () => {
  const SECRET = { id: "s1", name: "DB_PASSWORD", environment: "default", version: 1, maskedValue: "••••", updatedAt: "2026-09-01T00:00:00Z" };

  it("lists with get", async () => {
    routes({ [`${P}/secrets`]: [SECRET] });

    expect((await cli(["secrets", "get"])).stdout).toContain("DB_PASSWORD");
  });

  it("narrows to one name, and exits 1 for a name that is not there", async () => {
    routes({ [`${P}/variables`]: [{ ...SECRET, name: "LOG_LEVEL", value: "debug" }] });

    expect((await cli(["variables", "get", "LOG_LEVEL"])).code).toBe(0);
    expect((await cli(["variables", "get", "NOPE"])).code).toBe(1);
  });
});

describe("reads on a saved CLI session with no default project", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "cosmoner-read-"));
    writeFileSync(
      join(configDir, "credentials.json"),
      JSON.stringify({
        version: 2,
        logins: {
          [BASE]: {
            kind: "session",
            sessionId: "cs_1",
            sessionName: "laptop",
            user: { id: "u1", email: "dana@example.com", name: "Dana" },
            accessToken: "cos_at_live",
            accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            refreshToken: "cos_rt_live",
            idleExpiresAt: "2099-01-07T00:00:00.000Z",
            expiresAt: "2099-01-30T00:00:00.000Z",
          },
        },
      })
    );
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("can list projects, and asks for a project for anything inside one", async () => {
    routes({ [`${BASE}/v1/projects`]: [] });
    const env = { COSMONER_API_URL: BASE, COSMONER_CONFIG_DIR: configDir };

    expect((await cli(["projects", "get"], env)).code).toBe(0);
    const inside = await cli(["apps", "get"], env);
    expect(inside.code).toBe(2);
    expect(inside.stderr).toContain("cosmoner use <project>");
  });
});

describe("cosmoner get --all", () => {
  const PROJECT_URL = `${BASE}/v1/projects/proj-1`;
  const LISTINGS = [
    "apps",
    "servers",
    "ssh-keys",
    "databases",
    "redis",
    "domains",
    "storage/object-storage",
    "storage/container-registry",
    "email",
    "iam",
    "members",
    "hosting/shared",
    "webhooks",
    "secrets",
    "variables",
  ];

  /**
   * Answers the project and every listing route; `overrides` replaces a
   * route's data, and a route in `refused` answers 403 as a key without that
   * scope would get.
   */
  function project(overrides: Record<string, unknown> = {}, refused: string[] = []): void {
    fetchSpy.mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (refused.includes(url)) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "Missing scope" } }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url in overrides) return Promise.resolve(ok(overrides[url]));
      if (url === PROJECT_URL) return Promise.resolve(ok({ id: "proj-1", name: "Acme", slug: "acme" }));
      if (url === `${P}/iam`) return Promise.resolve(ok({ credentials: [], errors: [] }));
      if (url === `${P}/members`) return Promise.resolve(ok({ members: [], pendingInvitations: [] }));
      if (LISTINGS.some((route) => url === `${P}/${route}`)) return Promise.resolve(ok([]));
      throw new Error(`Unexpected request to ${url}`);
    });
  }

  it("reads the project and every product in one object", async () => {
    project({ [`${P}/apps`]: [APP] });

    const result = await cli(["get", "--all", "--format", "json"]);

    expect(result.code).toBe(0);
    const overview = JSON.parse(result.stdout);
    expect(overview.project).toEqual({ id: "proj-1", name: "Acme", slug: "acme" });
    expect(overview.apps).toEqual([APP]);
    expect(overview.servers).toEqual([]);
    expect(Object.keys(overview)).toEqual([
      "project",
      "apps",
      "servers",
      "ssh-keys",
      "databases",
      "redis",
      "domains",
      "buckets",
      "registries",
      "email",
      "iam",
      "members",
      "hosting",
      "webhooks",
      "secrets",
      "variables",
      "errors",
    ]);
    expect(overview.errors).toEqual({});
    expect(requested()).toHaveLength(LISTINGS.length + 1);
  });

  it("records a product it may not read instead of failing", async () => {
    project({}, [`${P}/iam`]);

    const result = await cli(["get", "--all", "--format", "json"]);

    expect(result.code).toBe(0);
    const overview = JSON.parse(result.stdout);
    expect(overview.iam).toBeNull();
    expect(overview.errors).toEqual({ iam: "Missing scope (FORBIDDEN)" });
    expect(overview.apps).toEqual([]);
  });

  it("exits 1 when nothing could be read", async () => {
    project({}, [PROJECT_URL, ...LISTINGS.map((route) => `${P}/${route}`)]);

    const result = await cli(["get", "--all", "--format", "json"]);

    expect(result.code).toBe(1);
    expect(Object.keys(JSON.parse(result.stdout).errors)).toHaveLength(LISTINGS.length + 1);
  });

  it("keeps secret names and hides credentials inside listings", async () => {
    project({
      [`${P}/secrets`]: [{ id: "s1", name: "DB_PASSWORD", environment: "default", version: 1 }],
      [`${P}/redis`]: [{ id: "r1", name: "cache", password: "pw-123", url: "redis://:pw-123@cache:6379" }],
    });

    const result = await cli(["get", "--all", "--format", "json"]);

    const overview = JSON.parse(result.stdout);
    expect(overview.secrets[0].name).toBe("DB_PASSWORD");
    expect(overview.redis[0].password).toBe("[hidden]");
    expect(result.stdout).not.toContain("pw-123");
  });

  it("prints a section per product in text", async () => {
    project({ [`${P}/apps`]: [APP] }, [`${P}/iam`]);

    const result = await cli(["get", "--all"]);

    expect(result.code).toBe(0);
    expect(result.stdout.split("\n")[0]).toBe("Project Acme (acme)");
    expect(result.stdout).toMatch(/^APPS \(1\)\nNAME\s+STATUS/m);
    expect(result.stdout).toMatch(/^SERVERS \(0\)\nNone\.$/m);
    expect(result.stdout).toMatch(/^IAM\nNot read: Missing scope \(FORBIDDEN\)$/m);
  });

  it("exits 2 without --all, or with a product, before any request", async () => {
    expect((await cli(["get"])).code).toBe(2);
    const named = await cli(["get", "apps"]);
    expect(named.code).toBe(2);
    expect(named.stderr).toContain("cosmoner apps get");
    expect((await cli(["get", "--all", "--format", "yaml"])).code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
