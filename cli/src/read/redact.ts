/**
 * Keeps credentials out of what the read commands print.
 *
 * The API returns some credentials on ordinary reads — a database's
 * connection string, a hosting site's SFTP password — because the control
 * panel shows them. The CLI is run by people in CI logs and by AI agents whose
 * every line of output becomes part of a transcript, so it never prints one,
 * in any format. Whoever needs a credential fetches it on purpose, from the
 * control panel or the SDK.
 *
 * Matching is by field name rather than per resource, so a credential field
 * the API adds later is hidden without anyone remembering to list it here. It
 * is deliberately broad: hiding a field that was harmless costs a reader one
 * value, printing one that was not cannot be taken back.
 */

/** The placeholder a hidden value is replaced with, so a reader sees that the field exists. */
export const HIDDEN = "[hidden]";

/** Field names whose string values are credentials. */
const CREDENTIAL_FIELD = /password|passwd|passphrase|secret|token|credential|private_?key|access_?key|api_?key|connection_?(string|uri|url)|^dsn$/i;

/**
 * A URL carrying a password in its userinfo: `scheme://user:password@host`, or
 * `scheme://:password@host` with no user, as Redis URLs usually are.
 */
const URL_WITH_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^:@/\s]*):[^@/\s]+@/gi;

/**
 * Returns a copy of `value` with every credential hidden.
 *
 * Only string values under a matching field name are replaced; a count or a
 * flag under the same name (`hasPassword`, `secretCount`) says nothing that
 * needs hiding and is kept. Any other string has a password in a URL masked,
 * which catches connection strings under names the pattern does not know.
 */
export function redact<T>(value: T): T {
  return redactValue(value, false) as T;
}

/** Walks one value; `underCredential` is true when its field name matched. */
function redactValue(value: unknown, underCredential: boolean): unknown {
  if (typeof value === "string") {
    if (underCredential && value !== "") return HIDDEN;
    return value.replace(URL_WITH_PASSWORD, `$1:${HIDDEN}@`);
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, underCredential));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      out[key] = redactValue(field, underCredential || CREDENTIAL_FIELD.test(key));
    }
    return out;
  }
  return value;
}
