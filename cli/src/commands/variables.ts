/**
 * `cosmoner variables` — list, set and remove a project's variables.
 *
 * The plaintext sibling of `cosmoner secrets`: a variable's value is returned
 * on every read, so unlike a secret it is printed back. Anything worth hiding
 * belongs in `cosmoner secrets`.
 */

import { type Cosmoner, type ProjectEnvironment, type ProjectVariable } from "@cosmoner/sdk";

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

export const VARIABLES_HELP = `cosmoner variables <list|set|rm> [name] [options]

Manages a project's variables — the non-sensitive values a deployment file
refers to with from_variable. A variable's value is held in plaintext and is
shown in full by list; put anything worth hiding in cosmoner secrets instead.

  cosmoner variables list
  cosmoner variables set LOG_LEVEL --value debug --environment development
  cosmoner variables rm LOG_LEVEL --environment development

set stores a new variable, or replaces the value of one that already exists in
the same environment. It reads the value from --value, --from-file, or
whatever is piped in, in that order.

Options
  --environment <env>  default (the default), development, staging or
                       production. set and rm address one name in one
                       environment.
  --value <value>      The value to store. Taken literally.
  --from-file <path>   Read the value from a file. One trailing newline is
                       stripped.
  --description <text> Set alongside the value.
  --project <id>       Project to work in. Defaults to COSMONER_PROJECT_ID.
  --format <format>    text (default) or json.

Environment
  COSMONER_API_KEY     Required. Reads need variables:read, writes
                       variables:write.
  COSMONER_PROJECT_ID  Project to use when --project is not given.
  COSMONER_API_URL     API base URL. Defaults to https://api.cosmoner.com.

Writing also needs the key's owner to be an owner or admin of the project; the
scope alone is not enough.

Exit code is 0 when the change was made, 1 when the API refused it, and 2 when
the command itself was wrong.`;

/** Flags taking a separate value. */
export const VARIABLES_VALUE_FLAGS = ENTRY_VALUE_FLAGS;

/** Runs `cosmoner variables`, returning the exit code. */
export async function runVariables(
  args: ParsedArgs,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<number> {
  rejectUnknownFlags(args, ENTRY_FLAGS);

  const sub = readSubcommand(args.positional, "variables");
  const [, name, ...extra] = args.positional;
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}"`);

  const format = readChoice<EntryFormat>(args, "format", FORMATS, "text");
  const environment = readEnvironment(args);
  const description = readValue(args, "description");
  // A bare `list` shows every environment; naming one narrows it. `set` and
  // `rm` always work in exactly one, which is why readEnvironment defaults.
  const environmentGiven = readValue(args, "environment") !== undefined;

  if (sub !== "list" && name === undefined) {
    throw new UsageError(`Name the variable to ${sub === "set" ? "set" : "remove"}`);
  }

  // Read the value before opening a connection, so a bad command line fails
  // as a usage error rather than after a round trip.
  const value = sub === "set" ? readEntryValue(args, cwd) : "";

  const client = makeClient(args, env, sub === "list" ? "variables:read" : "variables:write");

  try {
    if (sub === "list") {
      const { data } = await client.variables.list({
        environment: environmentGiven ? environment : undefined,
      });
      report(data, format);
      return 0;
    }

    const existing = await find(client, name as string, environment);

    if (sub === "rm") {
      if (!existing) {
        console.error(`No variable named ${name as string} in ${environment}`);
        return 1;
      }
      await client.variables.delete(existing.id);
      if (format === "json") {
        console.log(JSON.stringify({ removed: existing.name, environment }, null, 2));
      } else {
        console.log(`✓ Removed ${existing.name} from ${environment}`);
      }
      return 0;
    }

    const { data } = existing
      ? await client.variables.update(existing.id, { value, description })
      : await client.variables.create({ name: name as string, value, description, environment });

    if (format === "json") {
      console.log(JSON.stringify({ ...data, created: !existing }, null, 2));
    } else {
      console.log(
        `✓ ${existing ? "Set" : "Created"} ${data.name}=${data.value} in ${environment}`
      );
    }
    return 0;
  } catch (err) {
    console.error(explain(err));
    return 1;
  }
}

/** Finds a variable by name within one environment, or nothing. */
async function find(
  client: Cosmoner,
  name: string,
  environment: ProjectEnvironment
): Promise<ProjectVariable | undefined> {
  const { data } = await client.variables.list({ environment });
  return data.find((variable) => variable.name === name);
}

/** Prints a listing, as a table or as JSON. */
function report(variables: ProjectVariable[], format: EntryFormat): void {
  if (format === "json") {
    console.log(JSON.stringify(variables, null, 2));
    return;
  }
  if (variables.length === 0) {
    console.log("No variables.");
    return;
  }

  console.log(
    renderTable(
      ["NAME", "ENVIRONMENT", "VALUE", "UPDATED"],
      variables.map((variable) => [
        variable.name,
        variable.environment,
        variable.value,
        day(variable.updatedAt),
      ])
    )
  );
}
