/**
 * The login `cosmoner login` saves, and how a command picks its credential.
 *
 * `COSMONER_API_KEY` always wins. CI sets it, and a saved login on a build
 * machine must never quietly replace the key the job was given. The saved
 * login is the fallback for a person at a terminal.
 *
 * A login is an account-level CLI session: a short-lived access token, the
 * refresh token that renews it, and the default project `cosmoner use` set.
 * Logins saved by an older CLI hold a project API key instead; those keep
 * working, bound to their one project, until the key expires.
 *
 * Logins are stored per API URL, so a staging login and a production one sit
 * side by side rather than overwriting each other.
 */

import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Cosmoner } from "@cosmoner/sdk";

import { readValue, UsageError, type ParsedArgs } from "./args";

export const DEFAULT_API_URL = "https://api.cosmoner.com";

/** A project as `cosmoner use` saved it. */
export interface SavedProject {
  id: string;
  slug: string | null;
  name: string;
}

/** An account-level CLI session. */
export interface SessionLogin {
  kind: "session";
  sessionId: string;
  /** The machine name the session was approved under. */
  sessionName: string;
  user: { id: string; email: string; name: string };
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  /** The session ends here unless it is refreshed first. */
  idleExpiresAt: string;
  /** The session ends here whatever its use. */
  expiresAt: string;
  /** Set by `cosmoner use`; absent until then. */
  defaultProject?: SavedProject;
}

/** A login saved by a CLI from before sessions: one project's API key. */
export interface LegacyKeyLogin {
  kind?: "project-key";
  apiKey: string;
  keyId: string;
  projectId: string;
  projectName: string;
  /** ISO timestamp, or null for a key that does not expire. */
  expiresAt: string | null;
}

/** One saved login. */
export type StoredLogin = SessionLogin | LegacyKeyLogin;

interface CredentialsFile {
  version: 2;
  logins: Record<string, StoredLogin>;
}

/** True for a login saved by `cosmoner login` before sessions existed. */
export function isLegacyLogin(login: StoredLogin): login is LegacyKeyLogin {
  return login.kind !== "session";
}

/** The API URL a command talks to, without a trailing slash. */
export function apiUrl(env: NodeJS.ProcessEnv): string {
  return (env.COSMONER_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

/**
 * Where the credentials file lives, or null when there is no home to put it in.
 *
 * Read from `env` alone, never from `os.homedir()`: commands are handed their
 * environment explicitly, and a lookup that went around it would let a test —
 * or a CI job with a scrubbed environment — pick up whoever's login happens to
 * be on the machine.
 */
export function credentialsPath(env: NodeJS.ProcessEnv): string | null {
  if (env.COSMONER_CONFIG_DIR) return join(env.COSMONER_CONFIG_DIR, "credentials.json");
  if (process.platform === "win32" && env.APPDATA) return join(env.APPDATA, "cosmoner", "credentials.json");
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "cosmoner", "credentials.json");
  if (env.HOME) return join(env.HOME, ".config", "cosmoner", "credentials.json");
  return null;
}

/**
 * Reads the credentials file, treating a missing or unreadable one as empty.
 *
 * A version 1 file holds only project-key logins, which read as legacy logins
 * as they are; it is rewritten as version 2 the next time anything is saved.
 */
function readFile(path: string): CredentialsFile {
  if (!existsSync(path)) return { version: 2, logins: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { logins?: Record<string, StoredLogin> };
    return { version: 2, logins: parsed.logins ?? {} };
  } catch {
    return { version: 2, logins: {} };
  }
}

/**
 * Writes the file readable by its owner alone.
 *
 * The mode is set on creation and again afterwards, because `writeFileSync`
 * only applies it to a file it creates — an existing file keeps whatever mode
 * it had.
 */
function writeFile(path: string, contents: CredentialsFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** The saved login for this API URL, or null. */
export function readLogin(env: NodeJS.ProcessEnv): StoredLogin | null {
  const path = credentialsPath(env);
  if (!path) return null;
  return readFile(path).logins[apiUrl(env)] ?? null;
}

/** Saves a login for this API URL, replacing any earlier one. */
export function saveLogin(env: NodeJS.ProcessEnv, login: StoredLogin): string {
  const path = credentialsPath(env);
  if (!path) throw new Error("Cannot tell where to save the login: set HOME or COSMONER_CONFIG_DIR");
  const file = readFile(path);
  file.logins[apiUrl(env)] = login;
  writeFile(path, file);
  return path;
}

/** Forgets the login for this API URL, removing the file once it holds none. */
export function removeLogin(env: NodeJS.ProcessEnv): void {
  const path = credentialsPath(env);
  if (!path || !existsSync(path)) return;
  const file = readFile(path);
  delete file.logins[apiUrl(env)];
  if (Object.keys(file.logins).length === 0) rmSync(path, { force: true });
  else writeFile(path, file);
}

/** True when a saved login can no longer be used: its key, or its session, has ended. */
export function isExpired(login: StoredLogin, now = Date.now()): boolean {
  if (isLegacyLogin(login)) return login.expiresAt !== null && Date.parse(login.expiresAt) <= now;
  return Date.parse(login.expiresAt) <= now || Date.parse(login.idleExpiresAt) <= now;
}

// ─── Refreshing a session ───────────────────────────────────────────────────

/**
 * How long a command's access token must stay valid when it starts. Covers a
 * typical command with room to spare; a refresh is one request, so renewing a
 * little early costs nothing.
 */
export const DEFAULT_TOKEN_VALIDITY_MS = 15 * 60 * 1000;

/** How long a stale lock is honoured before it is taken over. */
const LOCK_STALE_MS = 30_000;

/** How long a refresh waits for another process's refresh to finish. */
const LOCK_WAIT_MS = 15_000;

/** The pair the refresh endpoint returns. */
interface RefreshedTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  session: { id: string; name: string; expiresAt: string; idleExpiresAt: string };
}

/**
 * Takes the lock that serialises refreshes across processes on this machine.
 *
 * A refresh token is good for one exchange, and the API revokes the whole
 * session when it sees one used twice. Two commands started together — a
 * Makefile running `deploy` for two apps in parallel — would otherwise both
 * refresh with the same token and sign the machine out. The lock makes the
 * second wait and then find the first one's tokens already saved.
 */
async function acquireRefreshLock(path: string): Promise<() => void> {
  const lockPath = `${path}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_WAIT_MS;

  for (;;) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      closeSync(fd);
      return () => rmSync(lockPath, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    // A lock left behind by a process that died mid-refresh.
    try {
      if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) rmSync(lockPath, { force: true });
    } catch {
      // Removed by its owner between the two calls, which is the outcome wanted.
    }

    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for another cosmoner command to refresh the login (${lockPath})`);
    }
    await sleep(100);
  }
}

/** True when the session's access token stays valid for at least `forMs`. */
function accessTokenLasts(login: SessionLogin, forMs: number, now = Date.now()): boolean {
  return Date.parse(login.accessTokenExpiresAt) - now >= forMs;
}

/** Explains why a session can no longer be refreshed, by the API's error code. */
function endedMessage(code: string | undefined): string {
  switch (code) {
    case "CLI_SESSION_REVOKED":
      return "Your CLI session was signed out. Run cosmoner login again";
    case "CLI_SESSION_EXPIRED":
      return "Your CLI session has expired. Run cosmoner login again";
    default:
      return "Your CLI login is no longer valid. Run cosmoner login again";
  }
}

/**
 * Exchanges the refresh token for a new pair and saves it.
 *
 * Saved before returning, so the new refresh token is never held only in
 * memory: losing it would leave the file with a spent token, whose next use
 * signs the machine out.
 */
async function refreshSession(env: NodeJS.ProcessEnv, login: SessionLogin): Promise<SessionLogin> {
  const response = await fetch(`${apiUrl(env)}/v1/cli/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ refreshToken: login.refreshToken }),
  });
  const parsed = (await response.json().catch(() => ({}))) as {
    data?: RefreshedTokens;
    error?: { code?: string; message?: string };
  };

  if (response.status === 401 || response.status === 403) {
    // The session is over on the server's side; a refresh token for it is
    // worth nothing, so it goes rather than being retried by every command.
    removeLogin(env);
    throw new UsageError(endedMessage(parsed.error?.code));
  }
  if (!response.ok || !parsed.data) {
    throw new Error(`Could not refresh the CLI login: ${parsed.error?.message ?? `HTTP ${response.status}`}`);
  }

  const refreshed: SessionLogin = {
    ...login,
    accessToken: parsed.data.accessToken,
    accessTokenExpiresAt: parsed.data.accessTokenExpiresAt,
    refreshToken: parsed.data.refreshToken,
    idleExpiresAt: parsed.data.session.idleExpiresAt,
    expiresAt: parsed.data.session.expiresAt,
  };
  saveLogin(env, refreshed);
  return refreshed;
}

/**
 * The saved session with an access token valid for at least `forMs`,
 * refreshing it first when it is not.
 *
 * Re-read under the lock: another command may have refreshed while this one
 * waited, and its tokens are the ones to use — this process's copy of the
 * refresh token is already spent.
 */
export async function freshSession(env: NodeJS.ProcessEnv, login: SessionLogin, forMs: number): Promise<SessionLogin> {
  if (accessTokenLasts(login, forMs)) return login;

  const path = credentialsPath(env);
  if (!path) throw new Error("Cannot tell where the login is saved: set HOME or COSMONER_CONFIG_DIR");

  const release = await acquireRefreshLock(path);
  try {
    const current = readLogin(env);
    if (!current || isLegacyLogin(current) || current.sessionId !== login.sessionId) {
      throw new UsageError("Your CLI login changed while this command was starting. Run it again");
    }
    if (accessTokenLasts(current, forMs)) return current;
    return await refreshSession(env, current);
  } finally {
    release();
  }
}

// ─── Picking a credential ───────────────────────────────────────────────────

/** A credential and project for a command, and where the credential came from. */
export interface ResolvedCredentials {
  apiKey: string;
  /** Undefined only when the caller passed `requireProject: false` and none was named. */
  projectId: string | undefined;
  source: "env" | "login" | "session";
}

/** How a command wants its credential resolved. */
export interface CredentialOptions {
  /** How long the credential must stay valid. Defaults to `DEFAULT_TOKEN_VALIDITY_MS`. */
  forMs?: number;
  /**
   * False for a command that works across the account rather than in one
   * project — `cosmoner projects get` — so a missing project is not an error.
   */
  requireProject?: boolean;
}

/**
 * Picks the credential and project for a command that talks to the API.
 *
 * The project is the first of `--project`, `COSMONER_PROJECT_ID`, and then
 * whatever the saved login implies: a session's `cosmoner use` default, or a
 * legacy key's own project. An environment key never borrows the saved
 * login's project — it is bound to its own, which may not be the one the user
 * last picked, and the API would refuse the pair with a message that points
 * nowhere useful.
 *
 * `forMs` is how long the command needs its credential to stay valid; a
 * session is refreshed first if its access token would lapse sooner.
 */
export async function resolveCredentials(
  args: ParsedArgs,
  env: NodeJS.ProcessEnv,
  scope: string,
  options: CredentialOptions = {}
): Promise<ResolvedCredentials> {
  const forMs = options.forMs ?? DEFAULT_TOKEN_VALIDITY_MS;
  const requireProject = options.requireProject ?? true;
  const flagProject = readValue(args, "project");

  if (env.COSMONER_API_KEY) {
    const projectId = flagProject ?? env.COSMONER_PROJECT_ID;
    if (!projectId && requireProject) throw new UsageError("Pass --project or set COSMONER_PROJECT_ID");
    return { apiKey: env.COSMONER_API_KEY, projectId, source: "env" };
  }

  const login = readLogin(env);
  if (!login) {
    throw new UsageError(`Run cosmoner login, or set COSMONER_API_KEY to an API key with ${scope}`);
  }
  if (isExpired(login)) {
    throw new UsageError("Your CLI login has expired. Run cosmoner login again");
  }

  if (isLegacyLogin(login)) {
    const projectId = flagProject ?? env.COSMONER_PROJECT_ID ?? login.projectId;
    if (projectId !== login.projectId) {
      console.error(
        `Your saved login is a key for ${login.projectName} only. Run cosmoner login to reach your other projects.`
      );
    }
    return { apiKey: login.apiKey, projectId, source: "login" };
  }

  const projectId = flagProject ?? env.COSMONER_PROJECT_ID ?? login.defaultProject?.id;
  if (!projectId && requireProject) {
    throw new UsageError("Pass --project <project>, or set a default with cosmoner use <project>");
  }

  const session = await freshSession(env, login, forMs);
  return { apiKey: session.accessToken, projectId, source: "session" };
}

/** Builds an authenticated client from `resolveCredentials`. */
export async function makeClient(
  args: ParsedArgs,
  env: NodeJS.ProcessEnv,
  scope: string,
  options: CredentialOptions = {}
): Promise<Cosmoner> {
  const { apiKey, projectId } = await resolveCredentials(args, env, scope, options);
  return new Cosmoner({ apiKey, projectId: projectId || undefined, baseUrl: env.COSMONER_API_URL || undefined });
}

/** True when the command would run on a saved session, whose access token lapses within the hour. */
export function usesSession(env: NodeJS.ProcessEnv): boolean {
  if (env.COSMONER_API_KEY) return false;
  const login = readLogin(env);
  return login !== null && !isLegacyLogin(login);
}
