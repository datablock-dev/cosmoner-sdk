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
}

/** Flags every read command takes. */
export const READ_VALUE_FLAGS = ["project", "format"];
const READ_FLAGS = [...READ_VALUE_FLAGS, "help"];

const FORMATS = ["text", "json"] as const;
type ReadFormat = (typeof FORMATS)[number];

/** Verbs a read command understands. `list` is `get` without a reference. */
const VERBS = ["get", "list"] as const;

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
