/**
 * Telling someone a newer CLI is out — rarely, and never where it gets in the
 * way.
 *
 * The registry is asked at most once a day, and the answer is remembered next
 * to the saved login. A failed or slow lookup counts as the day's lookup too,
 * so a machine without a network does not pay for it on every command. The
 * notice itself is shown at most once a day, after the command's own output,
 * on stderr — a `--format json` reply on stdout stays clean.
 *
 * It is skipped wherever it would be noise or a broken promise: in CI, when
 * stderr is not a terminal (a pipe, an agent's shell), when
 * COSMONER_NO_UPDATE_CHECK is set, and for the offline file commands, which
 * promise never to touch the network.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { credentialsPath } from "./credentials";

const REGISTRY_URL = "https://registry.npmjs.org/@cosmoner/cli/latest";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Longer than this and the lookup is abandoned; a command is never held up for an update notice. */
const LOOKUP_TIMEOUT_MS = 1500;

/** Commands that promise not to reach the network, plus the ones that print and leave. */
const SILENT_COMMANDS = new Set(["validate", "fmt", "init", "schema", "agents", "help", "--help", "-h", "--version", "-v"]);

/** What is remembered between runs. Times are epoch milliseconds. */
interface UpdateState {
  checkedAt?: number;
  latest?: string;
  notifiedAt?: number;
}

/** What the check needs from the process, so tests can supply their own. */
export interface UpdateCheckContext {
  env: NodeJS.ProcessEnv;
  /** The first argument: the command being run. */
  command: string | undefined;
  /** The running CLI's version. */
  current: string;
  stderrIsTty: boolean;
  /** True when the CLI was started by npx rather than installed. */
  viaNpx: boolean;
  fetch?: typeof fetch;
  now?: number;
}

/**
 * Looks up the latest version when the day's lookup is due, and returns the
 * notice to print, or null. Never throws: an update notice is not worth
 * failing a command over.
 */
export async function checkForUpdate(context: UpdateCheckContext): Promise<string | null> {
  try {
    const { env, command } = context;
    if (env.CI || env.COSMONER_NO_UPDATE_CHECK || !context.stderrIsTty) return null;
    if (command === undefined || SILENT_COMMANDS.has(command)) return null;
    const path = statePath(env);
    if (path === null || parse(context.current) === null) return null;

    const now = context.now ?? Date.now();
    const state = readState(path);
    if (state.checkedAt === undefined || now - state.checkedAt >= DAY_MS) {
      state.checkedAt = now;
      state.latest = (await lookUpLatest(context.fetch ?? fetch)) ?? state.latest;
      writeState(path, state);
    }

    if (state.latest === undefined || !isNewer(state.latest, context.current)) return null;
    if (state.notifiedAt !== undefined && now - state.notifiedAt < DAY_MS) return null;
    state.notifiedAt = now;
    writeState(path, state);

    const how = context.viaNpx ? "Run npx @cosmoner/cli@latest" : "Update with npm install -g @cosmoner/cli";
    return `cosmoner ${state.latest} is out; you have ${context.current}. ${how}.`;
  } catch {
    return null;
  }
}

/** Where the state lives: beside the saved login, in the CLI's config folder. */
function statePath(env: NodeJS.ProcessEnv): string | null {
  const credentials = credentialsPath(env);
  return credentials === null ? null : join(dirname(credentials), "update-check.json");
}

/** Reads the remembered state, treating a missing or unreadable file as empty. */
function readState(path: string): UpdateState {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as UpdateState;
  } catch {
    return {};
  }
}

/** Remembers the state for the next run. */
function writeState(path: string, state: UpdateState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state)}\n`);
}

/** The registry's latest version, or null when it cannot be had in time. */
async function lookUpLatest(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(REGISTRY_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const { version } = (await response.json()) as { version?: unknown };
    return typeof version === "string" && parse(version) !== null ? version : null;
  } catch {
    return null;
  }
}

/** `major.minor.patch` as numbers; null for anything else, pre-releases included. */
function parse(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Whether `candidate` is a later release than `current`. */
function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate);
  const b = parse(current);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
