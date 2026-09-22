import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openBrowser } from "../../src/browser";
import { run } from "../../src/cli";

/**
 * Drives `cosmoner login`, `logout` and `whoami` through the real entry point
 * against a mocked API, with the credentials file in a temporary directory.
 *
 * The browser opener is mocked so the suite never opens a window, and the API
 * answers with a zero poll interval so the loop does not wait.
 */

vi.mock("../../src/browser", () => ({ openBrowser: vi.fn(() => true) }));

const BASE = "https://api.test.dev";

let out: string[];
let err: string[];
let fetchSpy: ReturnType<typeof vi.spyOn>;
let configDir: string;
let env: Record<string, string>;

/** A JSON response with the API's success envelope. */
function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A JSON response with the API's error envelope. */
function fail(status: number, code: string, message = code): Response {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const STARTED = {
  deviceCode: "d".repeat(43),
  userCode: "BCDF-GHJK",
  expiresIn: 600,
  interval: 0,
  verificationUri: "https://cosmoner.test/cli",
  verificationUriComplete: "https://cosmoner.test/cli/BCDF-GHJK",
};

const APPROVED = {
  status: "approved",
  apiKey: "db_saved",
  keyId: "key-1",
  expiresAt: "2026-12-21T00:00:00.000Z",
  project: { id: "proj-1", name: "Acme" },
};

/** Runs one command line with the test environment. */
async function cli(argv: string[], extraEnv: Record<string, string> = {}) {
  const code = await run(argv, configDir, false, { ...env, ...extraEnv });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

/** The credentials file as saved. */
function saved(): { logins: Record<string, typeof APPROVED & { projectId: string; projectName: string }> } {
  return JSON.parse(readFileSync(join(configDir, "credentials.json"), "utf8"));
}

/** Writes a saved login directly, as an earlier `cosmoner login` would have. */
function seedLogin(overrides: Record<string, unknown> = {}) {
  writeFileSync(
    join(configDir, "credentials.json"),
    JSON.stringify({
      version: 1,
      logins: {
        [BASE]: {
          apiKey: "db_saved",
          keyId: "key-1",
          projectId: "proj-1",
          projectName: "Acme",
          expiresAt: "2099-01-01T00:00:00.000Z",
          ...overrides,
        },
      },
    })
  );
}

/** The Authorization header of the nth request the spy captured. */
function authorizationOf(index: number): string | undefined {
  const init = fetchSpy.mock.calls[index][1] as RequestInit;
  return (init.headers as Record<string, string>).Authorization;
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "cosmoner-login-"));
  env = { COSMONER_API_URL: BASE, COSMONER_CONFIG_DIR: configDir };
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
  vi.mocked(openBrowser).mockClear();
  rmSync(configDir, { recursive: true, force: true });
});

describe("cosmoner login", () => {
  it("asks for the CLI's scopes and saves the approved key privately", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok(STARTED, 201))
      .mockResolvedValueOnce(ok({ status: "pending" }, 202))
      .mockResolvedValueOnce(ok(APPROVED));

    const result = await cli(["login"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("BCDF-GHJK");
    expect(result.stdout).toContain("Logged in to Acme, until 2026-12-21.");
    expect(openBrowser).toHaveBeenCalledWith(STARTED.verificationUriComplete);

    const [startUrl, startInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(startUrl).toBe(`${BASE}/v1/cli/login`);
    expect(JSON.parse(startInit.body as string).permissions).toMatchObject({ apps: ["read", "write"] });

    expect(saved().logins[BASE]).toMatchObject({ apiKey: "db_saved", projectId: "proj-1", projectName: "Acme" });
    if (process.platform !== "win32") {
      expect(statSync(join(configDir, "credentials.json")).mode & 0o777).toBe(0o600);
    }
  });

  it("prints the link without opening a browser when asked", async () => {
    fetchSpy.mockResolvedValueOnce(ok(STARTED, 201)).mockResolvedValueOnce(ok(APPROVED));

    const result = await cli(["login", "--no-browser"]);

    expect(result.code).toBe(0);
    expect(openBrowser).not.toHaveBeenCalled();
    expect(result.stdout).toContain(`Open ${STARTED.verificationUriComplete} in a browser`);
  });

  it("keeps polling after a slow_down", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok({ ...STARTED, interval: -5 }, 201))
      .mockResolvedValueOnce(fail(429, "SLOW_DOWN"))
      .mockResolvedValueOnce(ok(APPROVED));

    expect((await cli(["login"])).code).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("exits 1 and saves nothing when the login is denied", async () => {
    fetchSpy.mockResolvedValueOnce(ok(STARTED, 201)).mockResolvedValueOnce(fail(403, "ACCESS_DENIED"));

    const result = await cli(["login"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("denied");
    expect(existsSync(join(configDir, "credentials.json"))).toBe(false);
  });

  it("exits 1 when the code expires", async () => {
    fetchSpy.mockResolvedValueOnce(ok(STARTED, 201)).mockResolvedValueOnce(fail(410, "EXPIRED_TOKEN"));

    const result = await cli(["login"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("expired");
  });

  it("warns that COSMONER_API_KEY still takes priority", async () => {
    fetchSpy.mockResolvedValueOnce(ok(STARTED, 201)).mockResolvedValueOnce(ok(APPROVED));

    const result = await cli(["login"], { COSMONER_API_KEY: "db_env" });

    expect(result.stdout).toContain("COSMONER_API_KEY is set");
  });
});

describe("commands using the saved login", () => {
  it("fall back to the saved key and project", async () => {
    seedLogin();
    fetchSpy.mockResolvedValueOnce(ok([]));

    const result = await cli(["secrets", "list"]);

    expect(result.code).toBe(0);
    expect(fetchSpy.mock.calls[0][0]).toContain("/v1/projects/proj-1/secrets");
    expect(authorizationOf(0)).toBe("Bearer db_saved");
  });

  it("prefer COSMONER_API_KEY over the saved login", async () => {
    seedLogin();
    fetchSpy.mockResolvedValueOnce(ok([]));

    await cli(["secrets", "list"], { COSMONER_API_KEY: "db_env", COSMONER_PROJECT_ID: "proj-env" });

    expect(fetchSpy.mock.calls[0][0]).toContain("/v1/projects/proj-env/secrets");
    expect(authorizationOf(0)).toBe("Bearer db_env");
  });

  it("do not pair an environment key with the saved project", async () => {
    seedLogin();

    const result = await cli(["secrets", "list"], { COSMONER_API_KEY: "db_env" });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("COSMONER_PROJECT_ID");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuse an expired login without calling the API", async () => {
    seedLogin({ expiresAt: "2020-01-01T00:00:00.000Z" });

    const result = await cli(["secrets", "list"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("expired");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignore a login saved for a different API URL", async () => {
    seedLogin();

    const result = await cli(["secrets", "list"], { COSMONER_API_URL: "https://api.other.dev" });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Run cosmoner login");
  });
});

describe("cosmoner logout", () => {
  it("revokes the saved key and removes the file", async () => {
    seedLogin();
    fetchSpy.mockResolvedValueOnce(ok({ id: "key-1" }));

    const result = await cli(["logout"]);

    expect(result.code).toBe(0);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/v1/cli/logout`);
    expect(authorizationOf(0)).toBe("Bearer db_saved");
    expect(existsSync(join(configDir, "credentials.json"))).toBe(false);
  });

  it("treats an already revoked key as logged out", async () => {
    seedLogin();
    fetchSpy.mockResolvedValueOnce(fail(401, "INVALID_API_KEY"));

    expect((await cli(["logout"])).code).toBe(0);
  });

  it("forgets the key but exits 1 when it could not be revoked", async () => {
    seedLogin();
    fetchSpy.mockRejectedValueOnce(new Error("network down"));

    const result = await cli(["logout"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("key-1");
    expect(existsSync(join(configDir, "credentials.json"))).toBe(false);
  });

  it("says so when there is nothing to log out of", async () => {
    const result = await cli(["logout"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Not logged in");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("cosmoner whoami", () => {
  it("names the saved project after checking the key", async () => {
    seedLogin();
    fetchSpy.mockResolvedValueOnce(ok({ id: "proj-1", name: "Acme" }));

    const result = await cli(["whoami"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Logged in to Acme (proj-1)");
  });

  it("reports a revoked key", async () => {
    seedLogin();
    fetchSpy.mockResolvedValueOnce(fail(401, "UNAUTHORIZED"));

    const result = await cli(["whoami"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no longer works");
  });

  it("exits 1 when not logged in", async () => {
    const result = await cli(["whoami"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Run cosmoner login");
  });
});
