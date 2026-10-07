/**
 * `cosmoner <product> get [<ref>]` — the read command every product shares.
 *
 * One verb for both shapes of read, the way `kubectl get` works: with no
 * reference it lists everything, with one it shows that item. `list` is
 * accepted as an alias for the no-reference form.
 *
 * Built for two readers. A person gets a table, or a field list for one item.
 * An AI agent passes `--format json` and gets the API's own objects — an array
 * for a listing, one object for a single item — so it can rely on the shape
 * the API documents rather than on column layout. Either way, credentials are
 * hidden before anything is printed (redact.ts).
 */

import { CosmonerError, type Cosmoner } from "@cosmoner/sdk";

import { describeApiError } from "../api-error";
import { readChoice, rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";
import { renderTable } from "../commands/config-entries";
import { makeClient } from "../credentials";
import { confirm, refusal } from "../write/confirm";
import { redact } from "./redact";

/** One column of a listing. */
export interface Column<T> {
  header: string;
  value: (row: T) => unknown;
}

/** What a product tells the shared command about itself. */
export interface ReadableResource<T> {
  /** The command word, e.g. `apps`. */
  command: string;
  /** Singular, for messages: "No app named …". */
  noun: string;
  /** What a reference may be, for help text: "name or id". */
  refHelp: string;
  /** The API-key scope reads need, named when the credential is missing. */
  scope: string;
  /** False for reads that span the account rather than one project. */
  projectScoped: boolean;
  /** Lists every item. */
  list: (client: Cosmoner) => Promise<T[]>;
  /** Whether a listed item is the one a reference names. */
  matches: (row: T, ref: string) => boolean;
  /**
   * Fetches one item's full detail once the listing has resolved the
   * reference. Absent when the API has no single-item read, in which case the
   * listed item is shown as it is.
   */
  fetch?: (client: Cosmoner, row: T) => Promise<unknown>;
  /** Columns for the listing table. */
  columns: Column<T>[];
  /** Extra lines under the help text: what the product's fields mean. */
  notes?: string;
  /**
   * Deletes the item a reference resolved to. Absent when the product cannot
   * be deleted from the CLI.
   */
  remove?: (client: Cosmoner, row: T) => Promise<unknown>;
  /** What a delete takes with it, said in the confirmation. */
  removeWarning?: string;
  /** The scope writes need, named when the credential is missing. */
  writeScope?: string;
  /** Verbs beyond get, list and delete — create, update, verify — keyed by verb. */
  actions?: Record<string, ProductAction<T>>;
}

/** A product-specific verb, such as `cosmoner ssh-keys create`. */
export interface ProductAction<T> {
  /** The usage line after `cosmoner <product> `: `create <name> --public-key <file>`. */
  usage: string;
  /** Its help text, under the usage line. */
  help: string;
  /** Flags that take a value, for the argument parser. */
  valueFlags: readonly string[];
  /** Flags that take no value. `help` is always accepted. */
  switches?: readonly string[];
  /** Runs the verb. `resource` is the product it belongs to, for resolving names. */
  run: (args: ParsedArgs, env: NodeJS.ProcessEnv, resource: ReadableResource<T>) => Promise<number>;
}

/** Flags every read command takes. */
export const READ_VALUE_FLAGS = ["project", "format"];
const READ_FLAGS = [...READ_VALUE_FLAGS, "help"];
const DELETE_FLAGS = [...READ_VALUE_FLAGS, "yes", "help"];

const FORMATS = ["text", "json"] as const;
type ReadFormat = (typeof FORMATS)[number];

/** Verbs a read command understands. `list` is `get` without a reference. */
const VERBS = ["get", "list"] as const;

/** `rm` is accepted for delete, as `cosmoner secrets rm` already is. */
const DELETE_VERBS = ["delete", "rm"] as const;

/** Every flag that takes a value anywhere in a product's commands, for the argument parser. */
export function productValueFlags<T>(resource: ReadableResource<T>): string[] {
  const actions = Object.values(resource.actions ?? {});
  return [...new Set([...READ_VALUE_FLAGS, ...actions.flatMap((action) => action.valueFlags)])];
}

/** Runs `cosmoner <product> <verb> …`, returning the exit code. */
export function runProduct<T>(resource: ReadableResource<T>, args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<number> {
  const verb = args.positional[0];
  if (verb !== undefined && (DELETE_VERBS as readonly string[]).includes(verb) && resource.remove) {
    return runDelete(resource, args, env);
  }
  const action = verb === undefined ? undefined : resource.actions?.[verb];
  if (action) {
    rejectUnknownFlags(args, [...action.valueFlags, ...(action.switches ?? []), "help"]);
    return action.run(args, env, resource);
  }
  return runRead(resource, args, env);
}

/** The help text for a product's read command, followed by its write verbs. */
export function productHelp<T>(resource: ReadableResource<T>): string {
  const sections = [readHelp(resource)];
  if (resource.remove) sections.push(deleteHelp(resource));
  for (const action of Object.values(resource.actions ?? {})) {
    sections.push(`cosmoner ${resource.command} ${action.usage}\n\n${action.help}`);
  }
  return sections.join("\n\n");
}

/** The help text for `cosmoner <product> delete`. */
function deleteHelp<T>(resource: ReadableResource<T>): string {
  return `cosmoner ${resource.command} delete <${resource.noun}> [--yes]

Deletes the ${resource.noun} named by its ${resource.refHelp}, for good. \`rm\` is the
same.${resource.removeWarning ? `\n${resource.removeWarning}` : ""}

Asks first in a terminal; --yes skips the question. Without a terminal and
without --yes it changes nothing and exits 2.

Needs ${resource.writeScope ?? resource.scope.replace(/:read$/, ":write")}.`;
}

/** The help text for a product's read command. */
export function readHelp<T>(resource: ReadableResource<T>): string {
  const project = resource.projectScoped
    ? `  --project <project>  Project to read, by slug or id. Defaults to
                       COSMONER_PROJECT_ID, then the one set with cosmoner use.\n`
    : "";
  return `cosmoner ${resource.command} get [<${resource.noun}>] [options]

With no <${resource.noun}>, lists every ${resource.noun}. With one, shows it.
<${resource.noun}> is its ${resource.refHelp}. \`list\` is the same as \`get\`
with no <${resource.noun}>.

Options
${project}  --format text|json   json prints the API's objects: an array for a
                       listing, one object for a single ${resource.noun}.

Credentials the API returns — passwords, connection strings, keys — are never
printed; they show as [hidden].${resource.notes ? `\n\n${resource.notes}` : ""}

Needs ${resource.scope}.`;
}

/** Runs `cosmoner <product> get|list [<ref>]`, returning the exit code. */
export async function runRead<T>(resource: ReadableResource<T>, args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<number> {
  rejectUnknownFlags(args, READ_FLAGS);

  const [verb, ref, ...extra] = args.positional;
  if (verb === undefined) throw new UsageError(`Name what to do: cosmoner ${resource.command} get`);
  if (!(VERBS as readonly string[]).includes(verb)) {
    throw new UsageError(`Unknown subcommand "cosmoner ${resource.command} ${verb}"`);
  }
  if (verb === "list" && ref !== undefined) {
    throw new UsageError(`cosmoner ${resource.command} list takes no ${resource.noun}; use get <${resource.noun}>`);
  }
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}"`);
  const format = readChoice<ReadFormat>(args, "format", FORMATS, "text");

  const client = await makeClient(args, env, resource.scope, { requireProject: resource.projectScoped });

  try {
    const rows = await resource.list(client);

    if (ref === undefined) {
      printListing(resource, rows, format);
      return 0;
    }

    const row = rows.find((candidate) => resource.matches(candidate, ref));
    if (!row) {
      console.error(`No ${resource.noun} "${ref}"${resource.projectScoped ? " in this project" : ""}.`);
      return 1;
    }

    const detail = resource.fetch ? await resource.fetch(client, row) : row;
    printOne(detail, format);
    return 0;
  } catch (err) {
    console.error(err instanceof CosmonerError ? describeApiError(err) : err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/**
 * Finds the listed item a reference names, saying so on stderr when nothing
 * matches. Write verbs resolve names the same way `get` does.
 */
export async function findRow<T>(resource: ReadableResource<T>, client: Cosmoner, ref: string): Promise<T | undefined> {
  const row = (await resource.list(client)).find((candidate) => resource.matches(candidate, ref));
  if (!row) console.error(`No ${resource.noun} "${ref}"${resource.projectScoped ? " in this project" : ""}.`);
  return row;
}

/** Runs `cosmoner <product> delete <ref>`, returning the exit code. */
async function runDelete<T>(resource: ReadableResource<T>, args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<number> {
  rejectUnknownFlags(args, DELETE_FLAGS);
  const [verb, ref, ...extra] = args.positional;
  if (ref === undefined) throw new UsageError(`Name the ${resource.noun}: cosmoner ${resource.command} ${verb} <${resource.noun}>`);
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}"`);
  const format = readChoice<ReadFormat>(args, "format", FORMATS, "text");
  const remove = resource.remove as NonNullable<ReadableResource<T>["remove"]>;

  const scope = resource.writeScope ?? resource.scope.replace(/:read$/, ":write");
  const client = await makeClient(args, env, scope, { requireProject: resource.projectScoped });

  try {
    const row = await findRow(resource, client, ref);
    if (!row) return 1;

    const summary = `This deletes ${resource.noun} "${ref}".${resource.removeWarning ? ` ${resource.removeWarning}` : ""} It cannot be undone.`;
    const refused = refusal(await confirm(args, summary, `Delete ${resource.noun} "${ref}"?`));
    if (refused !== null) return refused;

    await remove(client, row);
    if (format === "json") console.log(JSON.stringify({ deleted: redact(row) }, null, 2));
    else console.log(`Deleted ${resource.noun} "${ref}".`);
    return 0;
  } catch (err) {
    console.error(err instanceof CosmonerError ? describeApiError(err) : err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/** Prints a listing as a table, or as a JSON array. */
function printListing<T>(resource: ReadableResource<T>, rows: T[], format: ReadFormat): void {
  if (format === "json") {
    console.log(JSON.stringify(redact(rows), null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log(`No ${resource.command}.`);
    return;
  }
  console.log(renderListing(resource.columns, redact(rows)));
}

/** Renders already-redacted rows as a table with the given columns. */
export function renderListing<T>(columns: Column<T>[], rows: T[]): string {
  return renderTable(
    columns.map((column) => column.header),
    rows.map((row) => columns.map((column) => cell(column.value(row))))
  );
}

/**
 * Prints one item: every scalar field as `key: value`, nested objects
 * flattened with dotted keys, so the text form shows everything the JSON form
 * does without a reader having to parse it.
 */
function printOne(detail: unknown, format: ReadFormat): void {
  const safe = redact(detail);
  if (format === "json") {
    console.log(JSON.stringify(safe, null, 2));
    return;
  }
  const lines = flatten(safe, "");
  const width = Math.max(...lines.map(([key]) => key.length));
  console.log(lines.map(([key, value]) => `${`${key}:`.padEnd(width + 2)}${value}`).join("\n"));
}

/** Flattens an object into `[dotted.key, printable value]` pairs. */
function flatten(value: unknown, prefix: string): Array<[string, string]> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, field]) => flatten(field, prefix ? `${prefix}.${key}` : key));
  }
  if (Array.isArray(value) && value.some((item) => item !== null && typeof item === "object")) {
    return value.flatMap((item, index) => flatten(item, `${prefix}[${index}]`));
  }
  return [[prefix || "value", cell(value)]];
}

/** One value as a table cell. */
function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.map(cell).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
