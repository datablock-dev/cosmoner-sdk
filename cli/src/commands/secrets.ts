/**
 * `cosmoner secrets` — list, set and remove a project's secrets.
 *
 * A secret's value is write-only: the API returns it once, as it is set, and
 * never again. This command never prints one. The value it would print is the
 * value the caller just supplied, so echoing it back buys nothing and puts a
 * plaintext secret in a CI log.
 */

import { type Cosmoner, type ProjectEnvironment, type ProjectSecret } from "@cosmoner/sdk";

import { readChoice, readValue, rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";
import {
  day,
  ENTRY_FLAGS,
  ENTRY_VALUE_FLAGS,
  explain,
  FORMATS,
  makeClient,
  readEntryValue,
  readEnvironment,
  readSubcommand,
  renderTable,
  type EntryFormat,
} from "./config-entries";

export const SECRETS_HELP = `cosmoner secrets <list|set|rm> [name] [options]

Manages a project's secrets — the values a deployment file refers to with
from_secret. A secret's value is encrypted and returned only as it is set, so
this command never prints one back.

  cosmoner secrets list
  cosmoner secrets set DB_PASSWORD --environment production < password.txt
  cosmoner secrets rm DB_PASSWORD --environment production

set stores a new secret, or replaces the value of one that already exists in
the same environment. It reads the value from --value, --from-file, or
whatever is piped in, in that order. Piping is safest: a value passed as
--value is recoverable from shell history and may be echoed by a CI runner.

Options
  --environment <env>  default (the default), development, staging or
                       production. set and rm address one name in one
                       environment.
  --value <value>      The value to store. Taken literally.
  --from-file <path>   Read the value from a file. One trailing newline is
                       stripped.
  --description <text> Set alongside the value.
  --project <id>       Project to work in. Defaults to COSMONER_PROJECT_ID.
  --format <format>    text (default) or json. json never includes a value.

Environment
  COSMONER_API_KEY     Required. Reads need secrets:read, writes secrets:write.
  COSMONER_PROJECT_ID  Project to use when --project is not given.
  COSMONER_API_URL     API base URL. Defaults to https://api.cosmoner.com.

Writing also needs the key's owner to be an owner or admin of the project; the
scope alone is not enough. Creating is rate-limited to 10 secrets per 10
minutes.

Exit code is 0 when the change was made, 1 when the API refused it, and 2 when
the command itself was wrong.`;

/** Flags taking a separate value. */
export const SECRETS_VALUE_FLAGS = ENTRY_VALUE_FLAGS;

/** Runs `cosmoner secrets`, returning the exit code. */
export async function runSecrets(
  args: ParsedArgs,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<number> {
  rejectUnknownFlags(args, ENTRY_FLAGS);

  const sub = readSubcommand(args.positional, "secrets");
  const [, name, ...extra] = args.positional;
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}"`);

  const format = readChoice<EntryFormat>(args, "format", FORMATS, "text");
  const environment = readEnvironment(args);
  const description = readValue(args, "description");
  // A bare `list` shows every environment; naming one narrows it. `set` and
  // `rm` always work in exactly one, which is why readEnvironment defaults.
  const environmentGiven = readValue(args, "environment") !== undefined;

  if (sub !== "list" && name === undefined) {
    throw new UsageError(`Name the secret to ${sub === "set" ? "set" : "remove"}`);
  }

  // Read the value before opening a connection, so a bad command line fails
  // as a usage error rather than after a round trip.
  const value = sub === "set" ? readEntryValue(args, cwd) : "";

  const client = makeClient(args, env, sub === "list" ? "secrets:read" : "secrets:write");

  try {
    if (sub === "list") {
      const { data } = await client.secrets.list({
        environment: environmentGiven ? environment : undefined,
      });
      report(data, format);
      return 0;
    }

    const existing = await find(client, name as string, environment);

    if (sub === "rm") {
      if (!existing) {
        console.error(`No secret named ${name as string} in ${environment}`);
        return 1;
      }
      await client.secrets.delete(existing.id);
      if (format === "json") {
        console.log(JSON.stringify({ removed: existing.name, environment }, null, 2));
      } else {
        console.log(`✓ Removed ${existing.name} from ${environment}`);
      }
      return 0;
    }

    const { data } = existing
      ? await client.secrets.update(existing.id, { value, description })
      : await client.secrets.create({ name: name as string, value, description, environment });

    if (format === "json") {
      // The plaintext is dropped deliberately: the caller supplied it a moment
      // ago, and putting it on stdout would write it into a CI log.
      const safe: Record<string, unknown> = { ...data, created: !existing };
      delete safe.value;
      console.log(JSON.stringify(safe, null, 2));
    } else {
      const what = existing ? `Set ${data.name} to` : `Created ${data.name} as`;
      const version = existing ? `, version ${data.version}` : "";
      console.log(`✓ ${what} ${data.maskedValue} in ${environment}${version}`);
    }
    return 0;
  } catch (err) {
    console.error(explain(err));
    return 1;
  }
}

/** Finds a secret by name within one environment, or nothing. */
async function find(
  client: Cosmoner,
  name: string,
  environment: ProjectEnvironment
): Promise<ProjectSecret | undefined> {
  const { data } = await client.secrets.list({ environment });
  return data.find((secret) => secret.name === name);
}

/** Prints a listing, as a table or as JSON. */
function report(secrets: ProjectSecret[], format: EntryFormat): void {
  if (format === "json") {
    console.log(JSON.stringify(secrets, null, 2));
    return;
  }
  if (secrets.length === 0) {
    console.log("No secrets.");
    return;
  }

  console.log(
    renderTable(
      ["NAME", "ENVIRONMENT", "VERSION", "UPDATED"],
      secrets.map((secret) => [
        secret.name,
        secret.environment,
        String(secret.version),
        day(secret.updatedAt),
      ])
    )
  );
}
