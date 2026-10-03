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
  return err.docsUrl ? `${line}\nSee ${err.docsUrl}` : line;
}
