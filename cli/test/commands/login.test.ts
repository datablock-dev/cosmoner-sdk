import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
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
  user: { id: "user-1", email: "dana@example.com", name: "Dana" },
  accessToken: "cos_at_new",
  accessTokenExpiresAt: "2099-01-01T01:00:00.000Z",
  refreshToken: "cos_rt_new",
  session: { id: "cs_new", name: "laptop", expiresAt: "2099-01-30T00:00:00.000Z", idleExpiresAt: "2099-01-07T00:00:00.000Z" },
};

/** Runs one command line with the test environment. */
async function cli(argv: string[], extraEnv: Record<string, string> = {}) {
  const code = await run(argv, configDir, false, { ...env, ...extraEnv });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

/** The credentials file as saved. */
function saved(): { version: number; logins: Record<string, Record<string, unknown>> } {
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

/** A saved session, as `cosmoner login` writes one. Its access token has an hour left. */
function seedSession(overrides: Record<string, unknown> = {}) {
  writeFileSync(
    join(configDir, "credentials.json"),
    JSON.stringify({
      version: 2,
      logins: {
        [BASE]: {
          kind: "session",
          sessionId: "cs_1",
          sessionName: "laptop",
          user: { id: "user-1", email: "dana@example.com", name: "Dana" },
          accessToken: "cos_at_live",
          accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          refreshToken: "cos_rt_live",
          idleExpiresAt: "2099-01-07T00:00:00.000Z",
          expiresAt: "2099-01-30T00:00:00.000Z",
          ...overrides,
        },
      },
    })
  );
}

/** What the refresh endpoint returns for a successful exchange. */
const REFRESHED = {
  accessToken: "cos_at_fresh",
  accessTokenExpiresAt: "2099-01-01T01:00:00.000Z",
  refreshToken: "cos_rt_fresh",
  session: { id: "cs_1", name: "laptop", expiresAt: "2099-01-30T00:00:00.000Z", idleExpiresAt: "2099-01-08T00:00:00.000Z" },
};

/** An access-token expiry five minutes out: inside the window every command wants. */
const SOON = () => new Date(Date.now() + 5 * 60 * 1000).toISOString();

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
  it("asks for a session, with no scopes, and saves it privately", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok(STARTED, 201))
      .mockResolvedValueOnce(ok({ status: "pending" }, 202))
      .mockResolvedValueOnce(ok(APPROVED));

    const result = await cli(["login"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("BCDF-GHJK");
    expect(result.stdout).toContain("Logged in as dana@example.com, until 2099-01-30 at the latest.");
    expect(result.stdout).toContain("cosmoner use <project>");
    expect(openBrowser).toHaveBeenCalledWith(STARTED.verificationUriComplete);

    const [startUrl, startInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(startUrl).toBe(`${BASE}/v1/cli/login`);
    const startBody = JSON.parse(startInit.body as string);
    expect(startBody).not.toHaveProperty("permissions");
    expect(startBody.credential).toBe("cli_session");

    expect(saved().version).toBe(2);
    expect(saved().logins[BASE]).toMatchObject({
      kind: "session",
      sessionId: "cs_new",
      accessToken: "cos_at_new",
      refreshToken: "cos_rt_new",
      user: { email: "dana@example.com" },
    });
    expect(saved().logins[BASE]).not.toHaveProperty("defaultProject");
    if (process.platform !== "win32") {
      expect(statSync(join(configDir, "credentials.json")).mode & 0o777).toBe(0o600);
    }
  });

  // Logging in again replaces the machine's credential rather than piling up
  // sessions on the account page, and keeps pointing where the user was.
  it("signs out a legacy key it replaces, and keeps its project as the default", async () => {
    seedLogin();
    fetchSpy
      .mockResolvedValueOnce(ok(STARTED, 201))
      .mockResolvedValueOnce(ok(APPROVED))
      .mockResolvedValueOnce(ok({ id: "key-1" }));

    const result = await cli(["login"]);

    expect(result.code).toBe(0);
    const [logoutUrl, logoutInit] = fetchSpy.mock.calls[2] as [string, RequestInit];
    expect(logoutUrl).toBe(`${BASE}/v1/cli/logout`);
    expect((logoutInit.headers as Record<string, string>).Authorization).toBe("Bearer db_saved");
    expect(saved().logins[BASE]).toMatchObject({
      kind: "session",
      defaultProject: { id: "proj-1", slug: null, name: "Acme" },
    });
    expect(result.stdout).toContain("Default project: Acme");
  });

  it("signs out the session it replaces by its refresh token, keeping the default", async () => {
    seedSession({ refreshToken: "cos_rt_old", defaultProject: { id: "proj-2", slug: "beta", name: "Beta" } });
    fetchSpy
      .mockResolvedValueOnce(ok(STARTED, 201))
      .mockResolvedValueOnce(ok(APPROVED))
      .mockResolvedValueOnce(ok({ id: "cs_old" }));

    expect((await cli(["login"])).code).toBe(0);
    const logoutInit = fetchSpy.mock.calls[2][1] as RequestInit;
    expect(JSON.parse(logoutInit.body as string)).toEqual({ refreshToken: "cos_rt_old" });
    expect(saved().logins[BASE]).toMatchObject({ sessionId: "cs_new", defaultProject: { slug: "beta" } });
  });

  it("still saves the new login when the old credential cannot be signed out", async () => {
    seedLogin();
    fetchSpy
      .mockResolvedValueOnce(ok(STARTED, 201))
      .mockResolvedValueOnce(ok(APPROVED))
      .mockRejectedValueOnce(new Error("network down"));

    const result = await cli(["login"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Could not sign out the old key for Acme");
    expect(saved().logins[BASE]).toMatchObject({ kind: "session" });
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

describe("commands using a saved session", () => {
  it("act on the project passed with --project, by slug or id", async () => {
    seedSession();
    fetchSpy.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([]));

    expect((await cli(["secrets", "list", "--project", "beta"])).code).toBe(0);
    expect((await cli(["variables", "list", "--project", "proj-9"])).code).toBe(0);

    expect(fetchSpy.mock.calls[0][0]).toContain("/v1/projects/beta/secrets");
    expect(fetchSpy.mock.calls[1][0]).toContain("/v1/projects/proj-9/variables");
    expect(authorizationOf(0)).toBe("Bearer cos_at_live");
  });

  it("fall back to COSMONER_PROJECT_ID, then to the default from cosmoner use", async () => {
    seedSession({ defaultProject: { id: "proj-default", slug: "default", name: "Default" } });
    fetchSpy.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([]));

    await cli(["secrets", "list"], { COSMONER_PROJECT_ID: "proj-env" });
    await cli(["secrets", "list"]);

    expect(fetchSpy.mock.calls[0][0]).toContain("/v1/projects/proj-env/secrets");
    expect(fetchSpy.mock.calls[1][0]).toContain("/v1/projects/proj-default/secrets");
  });

  it("refuse to guess when no project is named anywhere", async () => {
    seedSession();

    const result = await cli(["secrets", "list"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cosmoner use <project>");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refresh an access token about to lapse, and save the new pair before using it", async () => {
    seedSession({ accessTokenExpiresAt: SOON() });
    fetchSpy.mockResolvedValueOnce(ok(REFRESHED)).mockResolvedValueOnce(ok([]));

    const result = await cli(["secrets", "list", "--project", "beta"]);

    expect(result.code).toBe(0);
    const [refreshUrl, refreshInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(refreshUrl).toBe(`${BASE}/v1/cli/token/refresh`);
    expect(JSON.parse(refreshInit.body as string)).toEqual({ refreshToken: "cos_rt_live" });
    expect(authorizationOf(1)).toBe("Bearer cos_at_fresh");
    expect(saved().logins[BASE]).toMatchObject({
      accessToken: "cos_at_fresh",
      refreshToken: "cos_rt_fresh",
      idleExpiresAt: "2099-01-08T00:00:00.000Z",
    });
    expect(existsSync(join(configDir, "credentials.json.lock"))).toBe(false);
  });

  it("do not refresh a token with time to spare", async () => {
    seedSession();
    fetchSpy.mockResolvedValueOnce(ok([]));

    await cli(["secrets", "list", "--project", "beta"]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).not.toContain("/token/refresh");
  });

  // Two commands started together must not both spend the same refresh
  // token: the API would read the second use as a stolen token and sign the
  // machine out. The second waits for the lock and finds the first's pair.
  it("use the pair another command saved while this one waited for the lock", async () => {
    seedSession({ accessTokenExpiresAt: SOON() });
    const lock = join(configDir, "credentials.json.lock");
    writeFileSync(lock, "");
    setTimeout(() => {
      seedSession({ accessToken: "cos_at_other", refreshToken: "cos_rt_other" });
      rmSync(lock, { force: true });
    }, 150);
    fetchSpy.mockResolvedValueOnce(ok([]));

    const result = await cli(["secrets", "list", "--project", "beta"]);

    expect(result.code).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(authorizationOf(0)).toBe("Bearer cos_at_other");
  });

  it("take over a lock left behind by a command that died", async () => {
    seedSession({ accessTokenExpiresAt: SOON() });
    const lock = join(configDir, "credentials.json.lock");
    writeFileSync(lock, "");
    const stale = new Date(Date.now() - 60_000);
    utimesSync(lock, stale, stale);
    fetchSpy.mockResolvedValueOnce(ok(REFRESHED)).mockResolvedValueOnce(ok([]));

    expect((await cli(["secrets", "list", "--project", "beta"])).code).toBe(0);
    expect(authorizationOf(1)).toBe("Bearer cos_at_fresh");
  });

  it("forget a session the API says was signed out", async () => {
    seedSession({ accessTokenExpiresAt: SOON() });
    fetchSpy.mockResolvedValueOnce(fail(401, "CLI_SESSION_REVOKED"));

    const result = await cli(["secrets", "list", "--project", "beta"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Your CLI session was signed out. Run cosmoner login again");
    expect(existsSync(join(configDir, "credentials.json"))).toBe(false);
  });

  it("refuse an ended session without calling the API", async () => {
    seedSession({ idleExpiresAt: "2020-01-01T00:00:00.000Z" });

    const result = await cli(["secrets", "list", "--project", "beta"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("expired");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // CI sets COSMONER_API_KEY; a session someone left on the build machine
  // must never be used instead, nor even refreshed.
  it("lose to COSMONER_API_KEY, which is never paired with the session's default", async () => {
    seedSession({ accessTokenExpiresAt: SOON(), defaultProject: { id: "proj-default", slug: null, name: "Default" } });
    fetchSpy.mockResolvedValueOnce(ok([]));

    await cli(["secrets", "list"], { COSMONER_API_KEY: "db_env", COSMONER_PROJECT_ID: "proj-env" });
    const unpaired = await cli(["secrets", "list"], { COSMONER_API_KEY: "db_env" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain("/v1/projects/proj-env/secrets");
    expect(authorizationOf(0)).toBe("Bearer db_env");
    expect(unpaired.code).toBe(2);
    expect(saved().logins[BASE]).toMatchObject({ refreshToken: "cos_rt_live" });
  });
});

describe("commands using a legacy key login", () => {
  it("say the key reaches one project when pointed at another", async () => {
    seedLogin();
    fetchSpy.mockResolvedValueOnce(fail(403, "API_KEY_WRONG_ORGANIZATION"));

    const result = await cli(["secrets", "list", "--project", "beta"]);

    expect(result.stderr).toContain("Your saved login is a key for Acme only");
    expect(fetchSpy.mock.calls[0][0]).toContain("/v1/projects/beta/secrets");
  });
});

describe("cosmoner use", () => {
  it("checks the project against the API and saves it as the default", async () => {
    seedSession();
    fetchSpy.mockResolvedValueOnce(ok({ id: "proj-2", name: "Beta", slug: "beta" }));

    const result = await cli(["use", "beta"]);

    expect(result.code).toBe(0);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/v1/projects/beta`);
    expect(authorizationOf(0)).toBe("Bearer cos_at_live");
    expect(result.stdout).toContain("Using Beta (beta) by default.");
    expect(saved().logins[BASE]).toMatchObject({ defaultProject: { id: "proj-2", slug: "beta", name: "Beta" } });
  });

  it("refuses a project the user is not a member of and keeps the old default", async () => {
    seedSession({ defaultProject: { id: "proj-1", slug: "acme", name: "Acme" } });
    fetchSpy.mockResolvedValueOnce(fail(404, "NOT_FOUND"));

    const result = await cli(["use", "someone-elses"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('No project "someone-elses"');
    expect(saved().logins[BASE]).toMatchObject({ defaultProject: { id: "proj-1" } });
  });

  it("shows the default with no argument, without calling the API", async () => {
    seedSession({ defaultProject: { id: "proj-1", slug: "acme", name: "Acme" } });

    const result = await cli(["use"]);

    expect(result.stdout).toContain("Default project: Acme (acme)");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears the default", async () => {
    seedSession({ defaultProject: { id: "proj-1", slug: "acme", name: "Acme" } });

    expect((await cli(["use", "--clear"])).code).toBe(0);
    expect(saved().logins[BASE]).not.toHaveProperty("defaultProject");
  });

  it("tells a legacy login to log in again, since its key reaches one project", async () => {
    seedLogin();

    const result = await cli(["use", "beta"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Run cosmoner login");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("cosmoner logout with a session", () => {
  it("signs the session out by its refresh token and removes the file", async () => {
    seedSession();
    fetchSpy.mockResolvedValueOnce(ok({ id: "cs_1" }));

    const result = await cli(["logout"]);

    expect(result.code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/cli/logout`);
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: "cos_rt_live" });
    expect(result.stdout).toContain("Logged out dana@example.com");
    expect(existsSync(join(configDir, "credentials.json"))).toBe(false);
  });

  it("points at the account page when the session could not be signed out", async () => {
    seedSession();
    fetchSpy.mockRejectedValueOnce(new Error("network down"));

    const result = await cli(["logout"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Account → Security");
    expect(existsSync(join(configDir, "credentials.json"))).toBe(false);
  });
});

describe("cosmoner whoami with a session", () => {
  const INFO = {
    user: { id: "user-1", email: "dana@example.com", name: "Dana" },
    session: { id: "cs_1", name: "laptop", expiresAt: "2099-01-30T00:00:00.000Z", idleExpiresAt: "2099-01-07T00:00:00.000Z" },
  };

  it("shows the user, when the session ends, and the default project", async () => {
    seedSession({ defaultProject: { id: "proj-1", slug: "acme", name: "Acme" } });
    fetchSpy.mockResolvedValueOnce(ok(INFO));

    const result = await cli(["whoami"]);

    expect(result.code).toBe(0);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/v1/cli/session`);
    expect(result.stdout).toContain("Logged in as dana@example.com");
    expect(result.stdout).toContain("2099-01-07 if unused, and ends 2099-01-30 at the latest");
    expect(result.stdout).toContain("Default project: Acme (acme)");
  });

  it("says when there is no default project", async () => {
    seedSession();
    fetchSpy.mockResolvedValueOnce(ok(INFO));

    expect((await cli(["whoami"])).stdout).toContain("No default project");
  });

  it("exits 1 for a session that can no longer be refreshed", async () => {
    seedSession({ accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString() });
    fetchSpy.mockResolvedValueOnce(fail(401, "CLI_SESSION_EXPIRED"));

    const result = await cli(["whoami"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("expired");
  });
});
