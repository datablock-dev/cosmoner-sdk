/**
 * `cosmoner whoami` — say which credential and project the CLI would use.
 */

import { rejectUnknownFlags, type ParsedArgs } from "../args";
import { apiUrl, isExpired, readLogin } from "../credentials";

export const WHOAMI_HELP = `cosmoner whoami

Shows which credential the CLI is using and, for a saved login, the project it
is bound to and when its key expires. The key is checked against the API, so a
revoked key shows up here rather than halfway through a deploy.

Exit code is 0 when there is a working credential, 1 when there is none or the
saved one no longer works.`;

const FLAGS = ["help"];

/** Runs `cosmoner whoami`, returning the exit code. */
export async function runWhoami(args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<number> {
  rejectUnknownFlags(args, FLAGS);
  const base = apiUrl(env);

  if (env.COSMONER_API_KEY) {
    console.log(`Using COSMONER_API_KEY against ${base}.`);
    if (env.COSMONER_PROJECT_ID) console.log(`Project: ${env.COSMONER_PROJECT_ID}`);
    return 0;
  }

  const login = readLogin(env);
  if (!login) {
    console.error(`Not logged in to ${base}. Run cosmoner login.`);
    return 1;
  }
  if (isExpired(login)) {
    console.error(`Your login to ${login.projectName} expired. Run cosmoner login again.`);
    return 1;
  }

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
  return 0;
}
