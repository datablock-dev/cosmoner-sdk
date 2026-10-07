/**
 * `cosmoner login` — sign the CLI in through the browser.
 *
 * The terminal asks the API for a short code, opens the approval page, and
 * polls until the user approves it there. What comes back is an account-level
 * CLI session — an hour-long access token and the refresh token that renews
 * it — which reaches every project the user is a member of. Commands pick the
 * project with `--project` or the default `cosmoner use` sets. No password or
 * key is ever typed into the terminal.
 */

import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { rejectUnknownFlags, type ParsedArgs } from "../args";
import { openBrowser } from "../browser";
import { apiUrl, isLegacyLogin, readLogin, saveLogin, type SessionLogin, type StoredLogin } from "../credentials";

export const LOGIN_HELP = `cosmoner login [options]

Signs the CLI in through your browser. The terminal shows a code and opens a
page where you check the code and approve. The CLI is then signed in to your
account and reaches every project you are a member of. Pick one per command
with --project, or set a default with cosmoner use <project>.

The login acts as you: it can do what your role allows in each project.
Members, API keys and billing stay in the control panel. It stays signed in
while you use it, and ends after 7 days unused or 30 days after approval. Each machine is listed under Account → Security, where you can sign
it out.

Options
  --no-browser   Print the approval link instead of opening it.

Environment
  COSMONER_API_URL     API base URL. Defaults to https://api.cosmoner.com.
  COSMONER_CONFIG_DIR  Where to save the login. Defaults to ~/.config/cosmoner.

COSMONER_API_KEY, when set, is used instead of the saved login, so CI keeps
using the key it was given.`;

const FLAGS = ["no-browser", "help"];

/** Added to the interval each time the API says the CLI is polling too fast (RFC 8628 §3.5). */
const SLOW_DOWN_STEP_SECONDS = 5;

interface StartedLogin {
  deviceCode: string;
  userCode: string;
  expiresIn: number;
  interval: number;
  verificationUri: string;
  verificationUriComplete: string;
}

interface ApprovedLogin {
  status: "approved";
  user: { id: string; email: string; name: string };
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  session: { id: string; name: string; expiresAt: string; idleExpiresAt: string };
}

interface ApiReply<T> {
  status: number;
  data?: T;
  error?: { code?: string; message?: string };
}

/** POSTs JSON to the API and reads the envelope, whatever the status. */
async function post<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<ApiReply<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json().catch(() => ({}))) as { data?: T; error?: ApiReply<T>["error"] };
  return { status: response.status, data: parsed.data, error: parsed.error };
}

/** Runs `cosmoner login`, returning the exit code. */
export async function runLogin(args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<number> {
  rejectUnknownFlags(args, FLAGS);
  const base = apiUrl(env);

  const started = await post<StartedLogin>(`${base}/v1/cli/login`, {
    clientName: hostname().slice(0, 60) || "cosmoner-cli",
    credential: "cli_session",
  });
  if (started.status !== 201 || !started.data) {
    console.error(`Could not start a login: ${started.error?.message ?? `HTTP ${started.status}`}`);
    return 1;
  }
  const login = started.data;

  console.log(`Your code is ${login.userCode}\n`);
  const opened = args.flags.get("no-browser") !== true && openBrowser(login.verificationUriComplete);
  console.log(opened
    ? `Opened ${login.verificationUriComplete} in your browser.`
    : `Open ${login.verificationUriComplete} in a browser to continue.`);
  console.log(`Or go to ${login.verificationUri} and enter the code.\n`);
  console.log("Waiting for approval…");

  const deadline = Date.now() + login.expiresIn * 1000;
  let interval = login.interval;

  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const poll = await post<{ status: "pending" } | ApprovedLogin>(`${base}/v1/cli/login/token`, {
      deviceCode: login.deviceCode,
    });

    if (poll.status === 202) continue;
    if (poll.status === 429 && poll.error?.code === "SLOW_DOWN") {
      interval += SLOW_DOWN_STEP_SECONDS;
      continue;
    }
    if (poll.status === 200 && poll.data?.status === "approved") {
      return finish(env, poll.data, readLogin(env));
    }

    const reason =
      poll.error?.code === "ACCESS_DENIED"
        ? "The login was denied in the browser."
        : poll.error?.code === "EXPIRED_TOKEN"
          ? "The code expired before it was approved. Run cosmoner login again."
          : `Login failed: ${poll.error?.message ?? `HTTP ${poll.status}`}`;
    console.error(reason);
    return 1;
  }

  console.error("The code expired before it was approved. Run cosmoner login again.");
  return 1;
}

/**
 * Saves an approved login and says where the CLI now stands.
 *
 * Whatever the machine held before is signed out first, so logging in again
 * leaves one session per machine on the account page rather than a trail of
 * them. A project picked with `cosmoner use` under an earlier session carries
 * over, and a legacy login's project becomes the default, so the commands a
 * user already ran keep pointing where they did.
 */
async function finish(env: NodeJS.ProcessEnv, approved: ApprovedLogin, previous: StoredLogin | null): Promise<number> {
  if (previous) await revokePrevious(env, previous);

  const defaultProject = previous
    ? isLegacyLogin(previous)
      ? { id: previous.projectId, slug: null, name: previous.projectName }
      : previous.defaultProject
    : undefined;

  const login: SessionLogin = {
    kind: "session",
    sessionId: approved.session.id,
    sessionName: approved.session.name,
    user: approved.user,
    accessToken: approved.accessToken,
    accessTokenExpiresAt: approved.accessTokenExpiresAt,
    refreshToken: approved.refreshToken,
    idleExpiresAt: approved.session.idleExpiresAt,
    expiresAt: approved.session.expiresAt,
    ...(defaultProject ? { defaultProject } : {}),
  };
  const path = saveLogin(env, login);

  console.log(`\nLogged in as ${approved.user.email}, until ${approved.session.expiresAt.slice(0, 10)} at the latest.`);
  console.log(`Saved to ${path}`);
  if (defaultProject) {
    console.log(`Default project: ${defaultProject.name}. Change it with cosmoner use <project>.`);
  } else {
    console.log("Pick a default project with cosmoner use <project>, or pass --project to each command.");
  }
  if (env.COSMONER_API_KEY) {
    console.log("COSMONER_API_KEY is set, and takes priority over this login until you unset it.");
  }
  return 0;
}

/**
 * Signs out the credential the machine held before this login, best effort.
 *
 * A failure is not worth failing the login over — the new session is already
 * issued — so it is reported and left to the account page.
 */
async function revokePrevious(env: NodeJS.ProcessEnv, previous: StoredLogin): Promise<void> {
  const base = apiUrl(env);
  try {
    const reply = isLegacyLogin(previous)
      ? await post(`${base}/v1/cli/logout`, {}, { Authorization: `Bearer ${previous.apiKey}` })
      : await post(`${base}/v1/cli/logout`, { refreshToken: previous.refreshToken });
    if (reply.status >= 400 && reply.status !== 401) throw new Error(`HTTP ${reply.status}`);
  } catch (err) {
    const what = isLegacyLogin(previous) ? `the old key for ${previous.projectName}` : "the previous CLI session";
    console.error(`Could not sign out ${what} (${err instanceof Error ? err.message : String(err)}).`);
  }
}
