/**
 * `cosmoner get --all` — everything one project has, in one command.
 *
 * Every product's listing, read in parallel. An agent getting its bearings
 * would otherwise run fifteen commands and stitch the results together; this
 * is that, done once, with one stable shape to parse.
 *
 * A product that cannot be read does not sink the rest. An API key usually
 * carries only some read scopes, so a refused listing is the normal case for
 * it, not a failure: the product's key is null and the reason is recorded
 * under `errors`, and the command still succeeds. It exits 1 only when nothing
 * at all could be read, which means the credential or the network is wrong.
 */

import { Cosmoner, CosmonerError } from "@cosmoner/sdk";

import { describeApiError } from "../api-error";
import { readChoice, rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";
import { day } from "../commands/config-entries";
import { resolveCredentials } from "../credentials";
import { PRODUCTS } from "./products";
import { redact } from "./redact";
import { READ_VALUE_FLAGS, renderListing, type Column } from "./resource";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- API objects are shown, not typed, here.

/** One product in the overview: how to list it and how to show the list. */
interface Section {
  command: string;
  list: (client: Cosmoner) => Promise<Row[]>;
  columns: Column<Row>[];
}

/**
 * Secrets and variables have commands of their own rather than entries in
 * PRODUCTS, because they also write; their listings are the same calls those
 * commands make. A secret's listing is metadata only — no route returns a
 * stored value.
 */
const CONFIG_SECTIONS: Section[] = [
  {
    command: "secrets",
    list: async (client) => (await client.secrets.list()).data as unknown as Row[],
    columns: [
      { header: "NAME", value: (row) => row.name },
      { header: "ENVIRONMENT", value: (row) => row.environment },
      { header: "VERSION", value: (row) => row.version },
      { header: "UPDATED", value: (row) => day(row.updatedAt) },
    ],
  },
  {
    command: "variables",
    list: async (client) => (await client.variables.list()).data as unknown as Row[],
    columns: [
      { header: "NAME", value: (row) => row.name },
      { header: "ENVIRONMENT", value: (row) => row.environment },
      { header: "VALUE", value: (row) => row.value },
      { header: "UPDATED", value: (row) => day(row.updatedAt) },
    ],
  },
];

/** Every section, in the order the text output shows them. */
const SECTIONS: Section[] = [
  ...Object.values(PRODUCTS).filter((product) => product.projectScoped),
  ...CONFIG_SECTIONS,
];

const FORMATS = ["text", "json"] as const;
type OverviewFormat = (typeof FORMATS)[number];

const OVERVIEW_FLAGS = [...READ_VALUE_FLAGS, "all", "help"];

/** What `cosmoner get --all --format json` prints. */
export interface Overview {
  /** The project itself, or null when it could not be read. */
  project: Row | null;
  /** Each product's listing, keyed by its command name; null when it could not be read. */
  [product: string]: Row | Row[] | null | Record<string, string>;
  /** Why each null entry above is null, keyed the same way. Empty when everything was read. */
  errors: Record<string, string>;
}

export const OVERVIEW_HELP = `cosmoner get --all [options]

Shows everything a project has in one go: every product's listing — the same
ones cosmoner <product> get prints — read in parallel.

Options
  --all                Required: read every product.
  --project <project>  Project to read, by slug or id. Defaults to
                       COSMONER_PROJECT_ID, then the one set with cosmoner use.
  --format text|json   json prints one object: "project", then a key per
                       product holding its listing as an array, then
                       "errors".

Products, in order
${wrap(SECTIONS.map((section) => section.command), 76)}

A product that cannot be read — most often an API key without its read scope —
is null in json, with the reason under "errors", and does not fail the
command. It exits 1 only when nothing could be read.

Credentials the API returns are never printed; they show as [hidden].

Needs each product's read scope for that product; a CLI login has them all.`;

/** Runs `cosmoner get --all`, returning the exit code. */
export async function runOverview(args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<number> {
  rejectUnknownFlags(args, OVERVIEW_FLAGS);
  if (args.positional.length > 0) {
    throw new UsageError(
      `cosmoner get takes no product; use cosmoner ${args.positional[0]} get, or cosmoner get --all for everything`
    );
  }
  if (args.flags.get("all") !== true) {
    throw new UsageError("Pass --all to read every product, or use cosmoner <product> get for one");
  }
  const format = readChoice<OverviewFormat>(args, "format", FORMATS, "text");

  const { apiKey, projectId } = await resolveCredentials(args, env, "the read scopes of the products to show");
  // resolveCredentials refuses a missing project before this point.
  const project = projectId as string;
  const client = new Cosmoner({ apiKey, projectId: project, baseUrl: env.COSMONER_API_URL || undefined });

  const [projectResult, ...sectionResults] = await Promise.allSettled([
    client.projects.get(project).then(({ data }) => data as unknown as Row),
    ...SECTIONS.map((section) => section.list(client)),
  ]);

  // Redacted piece by piece, not as a whole: the matching is by field name,
  // and the overview's own "secrets" key would hide every secret's name.
  const errors: Record<string, string> = {};
  const listings: Record<string, Row[] | null> = {};
  if (projectResult.status === "rejected") errors.project = reason(projectResult.reason);

  SECTIONS.forEach((section, index) => {
    const result = sectionResults[index];
    if (result.status === "fulfilled") {
      listings[section.command] = redact(result.value);
    } else {
      listings[section.command] = null;
      errors[section.command] = reason(result.reason);
    }
  });

  const overview: Overview = {
    project: projectResult.status === "fulfilled" ? redact(projectResult.value) : null,
    ...listings,
    errors,
  };

  if (format === "json") console.log(JSON.stringify(overview, null, 2));
  else console.log(renderText(overview, project));

  const readSomething = Object.keys(errors).length < SECTIONS.length + 1;
  return readSomething ? 0 : 1;
}

/** The text form: a heading per product with its table, or why it is missing. */
function renderText(overview: Overview, projectRef: string): string {
  const project = overview.project;
  const blocks = [project ? `Project ${project.name} (${project.slug})` : `Project ${projectRef}`];

  for (const section of SECTIONS) {
    const rows = overview[section.command] as Row[] | null;
    const title = section.command.toUpperCase();
    if (rows === null) {
      blocks.push(`${title}\nNot read: ${overview.errors[section.command]}`);
    } else if (rows.length === 0) {
      blocks.push(`${title} (0)\nNone.`);
    } else {
      blocks.push(`${title} (${rows.length})\n${renderListing(section.columns, rows)}`);
    }
  }

  return blocks.join("\n\n");
}

/** Joins words into indented lines no wider than `width`. */
function wrap(words: string[], width: number): string {
  const lines: string[] = [];
  let line = " ";
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = " ";
    }
    line += ` ${word}`;
  }
  return [...lines, line].join("\n");
}

/** Why a read failed, in the words the per-product commands use. */
function reason(err: unknown): string {
  const message = err instanceof CosmonerError ? describeApiError(err).replaceAll("\n", " ") : err instanceof Error ? err.message : String(err);
  return redact(message);
}
