/**
 * `cosmoner whoami` — say which credential the CLI would use, and for whom.
 */

import { rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";
import { apiUrl, freshSession, isExpired, isLegacyLogin, readLogin, type LegacyKeyLogin, type SessionLogin } from "../credentials";

export const WHOAMI_HELP = `cosmoner whoami

Shows which credential the CLI is using. For a saved login: who it is signed in
as, when the login ends, and the default project. The login is checked against
the API, so a signed-out session shows up here rather than halfway through a
deploy.

Exit code is 0 when there is a working credential, 1 when there is none or the
saved one no longer works.`;

const FLAGS = ["help"];

/** What `GET /v1/cli/session` returns. */
interface SessionInfo {
  user: { id: string; email: string; name: string };
  session: { id: string; name: string; expiresAt: string; idleExpiresAt: string };
}

/** Runs `cosmoner whoami`, returning the exit code. */
export function runWhoami(args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<number> {
  rejectUnknownFlags(args, FLAGS);
  const base = apiUrl(env);

  if (env.COSMONER_API_KEY) {
    console.log(`Using COSMONER_API_KEY against ${base}.`);
    if (env.COSMONER_PROJECT_ID) console.log(`Project: ${env.COSMONER_PROJECT_ID}`);
    return Promise.resolve(0);
  }

  const login = readLogin(env);
  if (!login) {
    console.error(`Not logged in to ${base}. Run cosmoner login.`);
    return Promise.resolve(1);
  }
  if (isExpired(login)) {
    const what = isLegacyLogin(login) ? `Your login to ${login.projectName}` : "Your CLI session";
    console.error(`${what} expired. Run cosmoner login again.`);
    return Promise.resolve(1);
  }

  return isLegacyLogin(login) ? whoamiLegacy(base, login) : whoamiSession(env, base, login);
}

/** `whoami` for a session: who it belongs to, when it ends, and the default project. */
async function whoamiSession(env: NodeJS.ProcessEnv, base: string, login: SessionLogin): Promise<number> {
  // Refreshing here is what proves the session is alive: an access token
  // expires within the hour whatever happens to the session behind it.
  let session: SessionLogin;
  try {
    session = await freshSession(env, login, 60_000);
  } catch (err) {
    // A session that cannot be renewed is the one thing whoami is for; it is
    // reported as a failed check (1), not as a bad command line (2).
    if (!(err instanceof UsageError)) throw err;
    console.error(`${err.message}.`);
    return 1;
  }

  const response = await fetch(`${base}/v1/cli/session`, {
    headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) {
    console.error("This CLI session was signed out. Run cosmoner login again.");
    return 1;
  }
  if (!response.ok) {
    console.error(`Could not check the CLI session: HTTP ${response.status}`);
    return 1;
  }
  const { data } = (await response.json()) as { data: SessionInfo };

  console.log(`Logged in as ${data.user.email} on ${base}, as "${data.session.name}".`);
  console.log(
    `Session lasts until ${data.session.idleExpiresAt.slice(0, 10)} if unused, and ends ${data.session.expiresAt.slice(0, 10)} at the latest.`
  );
  console.log(
    session.defaultProject
      ? `Default project: ${session.defaultProject.name} (${session.defaultProject.slug ?? session.defaultProject.id})`
      : "No default project. Set one with cosmoner use <project>."
  );
  return 0;
}

/** `whoami` for a login saved by an older CLI: one project's key. */
async function whoamiLegacy(base: string, login: LegacyKeyLogin): Promise<number> {
  const response = await fetch(`${base}/v1/projects/${encodeURIComponent(login.projectId)}`, {
    headers: { Authorization: `Bearer ${login.apiKey}`, Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) {
    console.error(`The saved key for ${login.projectName} no longer works. Run cosmoner login again.`);
    return 1;
  }
  if (!response.ok) {
    console.error(`Could not check the saved key: HTTP ${response.status}`);
    return 1;
  }

  console.log(`Logged in to ${login.projectName} (${login.projectId}) on ${base}.`);
  if (login.expiresAt) console.log(`Key expires ${login.expiresAt.slice(0, 10)}.`);
  console.log("This login is a key for one project. Run cosmoner login to reach all your projects.");
  return 0;
}
