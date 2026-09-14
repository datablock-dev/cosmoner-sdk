/**
 * `cosmoner fmt` — rewrite a deployment file in canonical form.
 */

import { writeFileSync } from "node:fs";

import { APP_SCHEMA_URL, DEPLOYMENT_KEY_ORDER } from "@cosmoner/sdk";
import { isMap, isSeq, parseDocument, type Document, type Pair, type YAMLMap } from "yaml";

import { rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";
import { resolveTargets } from "../discover";
import { read } from "./validate";

export const FMT_HELP = `cosmoner fmt [file...]

Rewrites a deployment file in canonical form: fields in the order the format
documents them, consistent indentation, and a $schema header so an editor
validates the file as it is typed.

Comments are preserved and travel with the field they are attached to. Unknown
fields are kept — the platform ignores them rather than rejecting them, and
deleting something this CLI does not recognise is not a formatter's decision —
and are moved to the end of the mapping they are in.

Options
  --check    Do not write. Exit 1 if any file is not already formatted.
  --stdout   Write the result to stdout instead of back to the file.

Exit code is 0 unless --check found a file that would change.`;

const FLAGS = ["check", "stdout", "help"];

/** The header that points an editor at the schema. */
const SCHEMA_COMMENT = ` yaml-language-server: $schema=${APP_SCHEMA_URL}`;

export function runFmt(args: ParsedArgs, cwd: string): number {
  rejectUnknownFlags(args, FLAGS);

  const check = args.flags.get("check") === true;
  const toStdout = args.flags.get("stdout") === true;
  if (check && toStdout) throw new UsageError("--check and --stdout do not go together");

  let changed = 0;

  for (const path of resolveTargets(args.positional, cwd)) {
    const source = read(path);
    const formatted = formatDeployment(source, path);

    if (toStdout) {
      console.log(formatted.replace(/\n$/, ""));
      continue;
    }
    if (formatted === source) continue;

    changed += 1;
    if (check) {
      console.log(`${path} is not formatted`);
    } else {
      writeFileSync(path, formatted, "utf8");
      console.log(`Formatted ${path}`);
    }
  }

  if (!check && !toStdout && changed === 0) console.log("Already formatted");

  return check && changed > 0 ? 1 : 0;
}

/**
 * Returns the canonical form of a deployment file.
 *
 * Exported for the tests, which are easier to read against a string than
 * against the filesystem.
 */
export function formatDeployment(source: string, path = "input"): string {
  const doc = parseDocument(source, { keepSourceTokens: true });

  // Reordering the parts of a file we could not parse would be a guess at what
  // the author meant, and a formatter is the last place to be guessing.
  if (doc.errors.length > 0) {
    throw new UsageError(`Cannot format ${path}: ${doc.errors[0].message}`);
  }

  if (isMap(doc.contents)) {
    orderMap(doc.contents, DEPLOYMENT_KEY_ORDER.root);
    orderServices(doc.contents);
  }

  addSchemaHeader(doc, source);

  // lineWidth 0 turns folding off: a long build command wrapped across lines is
  // still valid YAML and still unreadable in a diff.
  return doc.toString({ lineWidth: 0, singleQuote: false });
}

/** Puts a mapping's pairs in the given order, with anything unlisted last. */
function orderMap(map: YAMLMap, order: readonly string[]): void {
  const rank = (pair: Pair): number => {
    const key = String((pair.key as { value?: unknown } | null)?.value ?? pair.key);
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };

  // A stable sort, so unknown fields keep the relative order the author gave
  // them instead of being shuffled among themselves on every run.
  map.items = map.items
    .map((pair, index) => ({ pair, index }))
    .toSorted((a, b) => rank(a.pair) - rank(b.pair) || a.index - b.index)
    .map((entry) => entry.pair);
}

/** Applies the service, build and env orders below the root. */
function orderServices(root: YAMLMap): void {
  const services = root.get("services", true);
  if (!isSeq(services)) return;

  for (const service of services.items) {
    if (!isMap(service)) continue;
    orderMap(service, DEPLOYMENT_KEY_ORDER.service);

    const build = service.get("build", true);
    if (isMap(build)) orderMap(build, DEPLOYMENT_KEY_ORDER.build);

    const envs = service.get("envs", true);
    if (!isSeq(envs)) continue;
    for (const env of envs.items) {
      if (isMap(env)) orderMap(env, DEPLOYMENT_KEY_ORDER.env);
    }
  }
}

/**
 * Adds the editor header, unless the file already points at a schema.
 *
 * A `$schema` key does the same job, so a file carrying one is left alone
 * rather than given two ways of saying it.
 *
 * Whether a header is already there is read off the source rather than off the
 * document: a leading comment attaches to whichever node follows it, which for
 * these files is the contents map and not the document, so checking
 * `doc.commentBefore` alone appends a second header to a file that has one.
 */
function addSchemaHeader(doc: Document, source: string): void {
  if (isMap(doc.contents) && doc.contents.has("$schema")) return;
  if (source.includes("yaml-language-server")) return;

  doc.commentBefore = doc.commentBefore
    ? `${SCHEMA_COMMENT}\n${doc.commentBefore}`
    : SCHEMA_COMMENT;
}
