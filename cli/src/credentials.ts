/**
 * The key `cosmoner login` saves, and how a command picks its credential.
 *
 * `COSMONER_API_KEY` always wins. CI sets it, and a saved login on a build
 * machine must never quietly replace the key the job was given. The saved
 * login is the fallback for a person at a terminal.
 *
 * Logins are stored per API URL, so a staging login and a production one sit
 * side by side rather than overwriting each other.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { Cosmoner } from "@cosmoner/sdk";

import { readValue, UsageError, type ParsedArgs } from "./args";

export const DEFAULT_API_URL = "https://api.cosmoner.com";

/** One saved login. */
export interface StoredLogin {
  apiKey: string;
  keyId: string;
  projectId: string;
  projectName: string;
  /** ISO timestamp, or null for a key that does not expire. */
  expiresAt: string | null;
}

interface CredentialsFile {
  version: 1;
  logins: Record<string, StoredLogin>;
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

/** Reads the credentials file, treating a missing or unreadable one as empty. */
function readFile(path: string): CredentialsFile {
  if (!existsSync(path)) return { version: 1, logins: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CredentialsFile>;
    return { version: 1, logins: parsed.logins ?? {} };
  } catch {
    return { version: 1, logins: {} };
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

/** True when a saved login's key has passed its expiry. */
export function isExpired(login: StoredLogin, now = Date.now()): boolean {
  return login.expiresAt !== null && Date.parse(login.expiresAt) <= now;
}

/** A credential and project for a command, and where the key came from. */
export interface ResolvedCredentials {
  apiKey: string;
  projectId: string;
  source: "env" | "login";
}

/**
 * Picks the key and project for a command that talks to the API.
 *
 * The saved login's project is used only with the saved login's key. An
 * environment key is bound to its own project, which may not be the one the
 * user last logged in to, so pairing the two would be refused by the API with a
 * message that points nowhere useful.
 */
export function resolveCredentials(args: ParsedArgs, env: NodeJS.ProcessEnv, scope: string): ResolvedCredentials {
  const flagProject = readValue(args, "project");

  if (env.COSMONER_API_KEY) {
    const projectId = flagProject ?? env.COSMONER_PROJECT_ID;
    if (!projectId) throw new UsageError("Pass --project or set COSMONER_PROJECT_ID");
    return { apiKey: env.COSMONER_API_KEY, projectId, source: "env" };
  }

  const login = readLogin(env);
  if (!login) {
    throw new UsageError(`Run cosmoner login, or set COSMONER_API_KEY to an API key with ${scope}`);
  }
  if (isExpired(login)) {
    throw new UsageError("Your CLI login has expired. Run cosmoner login again");
  }

  return {
    apiKey: login.apiKey,
    projectId: flagProject ?? env.COSMONER_PROJECT_ID ?? login.projectId,
    source: "login",
  };
}

/** Builds an authenticated client from `resolveCredentials`. */
export function makeClient(args: ParsedArgs, env: NodeJS.ProcessEnv, scope: string): Cosmoner {
  const { apiKey, projectId } = resolveCredentials(args, env, scope);
  return new Cosmoner({ apiKey, projectId, baseUrl: env.COSMONER_API_URL || undefined });
}
