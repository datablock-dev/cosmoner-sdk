/**
 * `cosmoner login` — sign the CLI in through the browser.
 *
 * The terminal asks the API for a short code, opens the approval page, and
 * polls until the user approves it there. What comes back is an ordinary API
 * key bound to the project they picked, saved for the other commands to use.
 * No password or key is ever typed into the terminal.
 */

import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { rejectUnknownFlags, type ParsedArgs } from "../args";
import { openBrowser } from "../browser";
import { apiUrl, saveLogin } from "../credentials";

export const LOGIN_HELP = `cosmoner login [options]

Signs the CLI in through your browser. The terminal shows a code and opens a
page where you check the code, pick a project and approve. The CLI then saves
an API key for that project, which expires after 90 days.

The key can deploy apps, upload to web hosting, and manage secrets and
variables. It is listed with the project's API keys, where you can revoke it.

Options
  --no-browser   Print the approval link instead of opening it.

Environment
  COSMONER_API_URL     API base URL. Defaults to https://api.cosmoner.com.
  COSMONER_CONFIG_DIR  Where to save the login. Defaults to ~/.config/cosmoner.

COSMONER_API_KEY, when set, is used instead of the saved login, so CI keeps
using the key it was given.`;

const FLAGS = ["no-browser", "help"];

/**
 * The scopes a login asks for: what `deploy`, `upload`, `secrets` and
 * `variables` need, and `projects:read` for `whoami`. Shown on the approval
 * page before anything is issued. A command that needs more has to add it here.
 */
export const LOGIN_PERMISSIONS: Record<string, string[]> = {
  projects: ["read"],
  apps: ["read", "write"],
  hosting: ["read"],
  secrets: ["read", "write"],
  variables: ["read", "write"],
};

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
  apiKey: string;
  keyId: string;
  expiresAt: string | null;
  project: { id: string; name: string };
}

interface ApiReply<T> {
  status: number;
  data?: T;
  error?: { code?: string; message?: string };
}

/** POSTs JSON to the API and reads the envelope, whatever the status. */
async function post<T>(url: string, body: unknown): Promise<ApiReply<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
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
    permissions: LOGIN_PERMISSIONS,
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
      return finish(env, poll.data);
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

/** Saves an approved login and says where the CLI now points. */
function finish(env: NodeJS.ProcessEnv, approved: ApprovedLogin): number {
  const path = saveLogin(env, {
    apiKey: approved.apiKey,
    keyId: approved.keyId,
    projectId: approved.project.id,
    projectName: approved.project.name,
    expiresAt: approved.expiresAt,
  });

  const expiry = approved.expiresAt ? `, until ${approved.expiresAt.slice(0, 10)}` : "";
  console.log(`\nLogged in to ${approved.project.name}${expiry}.`);
  console.log(`Saved to ${path}`);
  if (env.COSMONER_API_KEY) {
    console.log("COSMONER_API_KEY is set, and takes priority over this login until you unset it.");
  }
  return 0;
}
