/**
 * `cosmoner logout` — revoke the saved login's key and forget it.
 */

import { rejectUnknownFlags, type ParsedArgs } from "../args";
import { apiUrl, readLogin, removeLogin } from "../credentials";

export const LOGOUT_HELP = `cosmoner logout

Revokes the API key saved by cosmoner login and removes it from this machine.
A key in COSMONER_API_KEY is not touched.

Environment
  COSMONER_API_URL     API base URL. Defaults to https://api.cosmoner.com.
  COSMONER_CONFIG_DIR  Where the login is saved. Defaults to ~/.config/cosmoner.`;

const FLAGS = ["help"];

/** Runs `cosmoner logout`, returning the exit code. */
export async function runLogout(args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<number> {
  rejectUnknownFlags(args, FLAGS);

  const login = readLogin(env);
  if (!login) {
    console.log("Not logged in.");
    return 0;
  }

  let revoked: boolean;
  let reason = "";
  try {
    const response = await fetch(`${apiUrl(env)}/v1/cli/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${login.apiKey}`, Accept: "application/json" },
    });
    // 401 means the key no longer verifies — already revoked or expired — which
    // is the outcome logging out was after.
    revoked = response.ok || response.status === 401;
    if (!revoked) reason = `HTTP ${response.status}`;
  } catch (err) {
    revoked = false;
    reason = err instanceof Error ? err.message : String(err);
  }

  // Forgotten either way: keeping a key the user asked to be rid of would be
  // the surprising outcome, and the panel can still revoke it.
  removeLogin(env);

  if (!revoked) {
    console.error(`Logged out on this machine, but the key could not be revoked (${reason}).`);
    console.error(`Revoke "${login.keyId}" under API keys in ${login.projectName} to finish.`);
    return 1;
  }

  console.log(`Logged out of ${login.projectName}.`);
  return 0;
}
