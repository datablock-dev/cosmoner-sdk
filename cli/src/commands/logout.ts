/**
 * `cosmoner logout` — sign this machine out and forget the saved login.
 */

import { rejectUnknownFlags, type ParsedArgs } from "../args";
import { apiUrl, isLegacyLogin, readLogin, removeLogin, type StoredLogin } from "../credentials";

export const LOGOUT_HELP = `cosmoner logout

Signs this machine's CLI session out and removes it from this machine. A key in
COSMONER_API_KEY is not touched.

Environment
  COSMONER_API_URL     API base URL. Defaults to https://api.cosmoner.com.
  COSMONER_CONFIG_DIR  Where the login is saved. Defaults to ~/.config/cosmoner.`;

const FLAGS = ["help"];

/**
 * Asks the API to end the saved credential.
 *
 * A session sends its refresh token, which it still holds after the access
 * token has lapsed. A login saved by an older CLI presents its key, which
 * deletes itself.
 */
function revoke(env: NodeJS.ProcessEnv, login: StoredLogin): Promise<Response> {
  const legacy = isLegacyLogin(login);
  return fetch(`${apiUrl(env)}/v1/cli/logout`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(legacy ? { Authorization: `Bearer ${login.apiKey}` } : {}),
    },
    body: JSON.stringify(legacy ? {} : { refreshToken: login.refreshToken }),
  });
}

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
    const response = await revoke(env, login);
    // 401 means the credential no longer works — already revoked or expired —
    // which is the outcome logging out was after.
    revoked = response.ok || response.status === 401;
    if (!revoked) reason = `HTTP ${response.status}`;
  } catch (err) {
    revoked = false;
    reason = err instanceof Error ? err.message : String(err);
  }

  // Forgotten either way: keeping a credential the user asked to be rid of
  // would be the surprising outcome, and the panel can still revoke it.
  removeLogin(env);

  if (isLegacyLogin(login)) {
    if (!revoked) {
      console.error(`Logged out on this machine, but the key could not be revoked (${reason}).`);
      console.error(`Revoke "${login.keyId}" under API keys in ${login.projectName} to finish.`);
      return 1;
    }
    console.log(`Logged out of ${login.projectName}.`);
    return 0;
  }

  if (!revoked) {
    console.error(`Logged out on this machine, but the session could not be signed out (${reason}).`);
    console.error(`Sign out "${login.sessionName}" under Account → Security to finish.`);
    return 1;
  }
  console.log(`Logged out ${login.user.email} on this machine.`);
  return 0;
}
