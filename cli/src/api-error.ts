/**
 * How a failed API call reads in a terminal, shared by every command that
 * calls the API so the wording is the same wherever a key or a limit trips.
 */

import type { CosmonerError } from "@cosmoner/sdk";

/**
 * The message and code, then the API's docs link on a line of its own.
 *
 * The API links a page only for errors the caller can fix — a missing scope,
 * a rate limit, a failed validation — and older API versions never do, so the
 * second line is often absent. The link goes on its own line so a terminal
 * makes it clickable and a CI log does not wrap it into the message.
 */
export function describeApiError(err: CosmonerError): string {
  const line = `${err.message} (${err.code})`;
  const hint = HINTS[err.code];
  const lines = [line, ...(hint ? [hint] : []), ...(err.docsUrl ? [`See ${err.docsUrl}`] : [])];
  return lines.join("\n");
}

/**
 * What to do next, for refusals the API's own message cannot spell out in CLI
 * terms.
 *
 * A project API key acts as its project's service account, and a few actions
 * need a person behind the credential instead — someone to read a reply, pay
 * at checkout or authorise a third party. The API refuses those with
 * `SERVICE_ACCOUNT_NOT_ALLOWED`; from the CLI the way round is a credential
 * that is a person.
 */
const HINTS: Readonly<Record<string, string>> = {
  SERVICE_ACCOUNT_NOT_ALLOWED:
    "This needs a person, not a project API key: unset COSMONER_API_KEY and run cosmoner login, or set it to a personal access token.",
};
