/**
 * `cosmoner agents` — tell coding agents how this repository deploys.
 *
 * Writes a Cosmoner section into AGENTS.md, the file Codex, Cursor and others
 * read for repository instructions (Claude Code reads it through an `@AGENTS.md`
 * import in CLAUDE.md). The section sits between two HTML comments so it can be
 * refreshed in place: everything outside them belongs to the repository and is
 * never rewritten.
 *
 * The text is generated rather than shipped as a static file so that the
 * commands and flags it names come from the same release as the CLI that
 * wrote it. `test/agents.test.ts` checks every command it mentions against the
 * command table.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { APP_SCHEMA_URL, DEPLOYMENT_FILE_PATHS } from "@cosmoner/sdk";

import { rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";

export const AGENTS_HELP = `cosmoner agents [file]

Writes a short "Deploying to Cosmoner" section into AGENTS.md, so a coding agent
working in this repository knows how to validate, deploy and handle secrets
without guessing. With no file, AGENTS.md in the current directory.

The section sits between <!-- cosmoner:start --> and <!-- cosmoner:end -->.
Running again replaces only what is between them; the rest of the file is left
as it is. A file without the markers gets the section appended, and a missing
file is created.

Claude Code reads CLAUDE.md rather than AGENTS.md: add the line @AGENTS.md to
CLAUDE.md to import it, or pass CLAUDE.md as the file.

Exit code is 0 when the file was written or already current, 1 when its
markers are unbalanced and it was left alone, and 2 when the command itself
was wrong.`;

const FLAGS = ["help"];

/** The cross-tool file agents read their repository instructions from. */
export const AGENTS_FILE = "AGENTS.md";

export const SECTION_START = "<!-- cosmoner:start -->";
export const SECTION_END = "<!-- cosmoner:end -->";

const DOCS_URL = "https://cosmoner.com/docs";
const LLMS_TXT_URL = "https://cosmoner.com/llms.txt";
const DOCS_MCP_URL = "https://cosmoner.com/docs/mcp";

/** Raised when a file's markers cannot be matched up, so the file is left alone. */
export class MarkerError extends Error {}

/** What writing the section would do to one file. */
export interface AgentsPlan {
  path: string;
  contents: string;
  status: "created" | "updated" | "unchanged";
}

export function runAgents(args: ParsedArgs, cwd: string): number {
  rejectUnknownFlags(args, FLAGS);
  if (args.positional.length > 1) throw new UsageError("agents takes at most one file");

  const path = resolve(cwd, args.positional[0] ?? AGENTS_FILE);
  const deploymentFile = DEPLOYMENT_FILE_PATHS.find((candidate) => existsSync(join(cwd, candidate)));

  let plan: AgentsPlan;
  try {
    plan = planAgentsFile(
      path,
      agentsSection({
        deploymentFile: deploymentFile ?? DEPLOYMENT_FILE_PATHS[0],
        exists: deploymentFile !== undefined,
      })
    );
  } catch (err) {
    if (err instanceof MarkerError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }

  writeAgentsPlan(plan, cwd);
  return 0;
}

/**
 * The section, markers included.
 *
 * `deploymentFile` is the file's path relative to the repository root, with
 * forward slashes. A file at one of the locations the platform searches needs
 * no argument on the command line; any other path is passed explicitly, since
 * `validate` and `fmt` would not find it on their own.
 */
export function agentsSection(options: { deploymentFile: string; exists: boolean }): string {
  const file = options.deploymentFile;
  const searched = (DEPLOYMENT_FILE_PATHS as readonly string[]).includes(file);
  const fileArg = searched ? "" : ` ${file}`;

  const fileIntro = options.exists
    ? `\`${file}\` describes how this repository is built and run.`
    : `\`${file}\` will describe how this repository is built and run. It does not exist yet: \`cosmoner init\` writes a starter one (\`--type static\` for a site served as files).`;

  return [
    SECTION_START,
    "<!-- Written by `cosmoner agents`, which replaces everything between these markers. Edit outside them. -->",
    "## Deploying to Cosmoner",
    "",
    "This repository deploys to [Cosmoner](https://cosmoner.com) with the `cosmoner` CLI (`npx @cosmoner/cli` when it is not installed). `cosmoner <command> --help` lists a command's options; do not guess at flags.",
    "",
    "### Deployment file",
    "",
    `- ${fileIntro} Keep its first line, \`# yaml-language-server: $schema=${APP_SCHEMA_URL}\`; \`cosmoner schema\` prints that schema offline.`,
    `- After changing it, run \`cosmoner fmt${fileArg}\`, then \`cosmoner validate${fileArg} --strict --format json\`. Both work offline and need no credentials.`,
    `- An app built from this repository deploys when its branch is pushed, not through the CLI. Changes to the file reach an existing app only when that app is set to apply the file on push: ${DOCS_URL}/guides/app-templates.md`,
    "- Never put a secret value in the file: refer to a stored secret with `from_secret`, or a plain value with `from_variable`.",
    "",
    "### CLI",
    "",
    "- `cosmoner deploy <app> --tag <tag> --format json` deploys an image app (one running an image from a Cosmoner registry) and waits until it is live. It refuses apps built from a repository.",
    "- `cosmoner upload <site> <dir> --dry-run --format json` previews uploading a built folder to a web hosting site; drop `--dry-run` to upload.",
    "- `cosmoner secrets list` and `cosmoner variables list` show what the project has stored; `set` and `rm` change it.",
    "- Exit codes: `0` success, `1` the operation failed or a file did not validate, `2` the command line was wrong. On `2`, fix the command rather than retrying it.",
    "",
    "### Credentials and secrets",
    "",
    "- Credentials come only from `COSMONER_API_KEY` and `COSMONER_PROJECT_ID` in the environment, or from `cosmoner login`. No flag takes a key. Never write a key into a file, a command line or a commit. `cosmoner whoami` shows which credential is in use.",
    "- Secrets are write-only: a value is returned only by the call that sets it, and nothing reads it back. Never print, log or commit a secret value. Pipe it in, as `cosmoner secrets set <NAME> --environment <env>` reads stdin; `--value` leaves it in shell history.",
    "- A 403 when setting a secret or variable with a correctly scoped key means the key's owner is not a project owner or admin. Retrying will not help.",
    "",
    "### Docs",
    "",
    `- Every page, indexed: ${LLMS_TXT_URL}`,
    `- Any page as Markdown: add \`.md\` to its URL, e.g. ${DOCS_URL}/guides/secrets.md`,
    `- Docs MCP server (Streamable HTTP, no auth): ${DOCS_MCP_URL}. In Claude Code: \`claude mcp add --transport http cosmoner-docs ${DOCS_MCP_URL}\``,
    SECTION_END,
  ].join("\n");
}

/**
 * Puts `section` into `existing`, touching nothing outside the markers.
 *
 * - No file: the section alone.
 * - One start marker followed by one end marker: what lies between them, the
 *   markers included, is replaced.
 * - No markers at all: the section is appended after a blank line.
 *
 * Anything else — a lone marker, two sections, an end before its start — is
 * refused. Guessing which part of the file is ours could delete something that
 * is not.
 */
export function mergeSection(existing: string | null, section: string): string {
  if (existing === null) return `${section}\n`;

  const crlf = existing.includes("\r\n");
  const ours = crlf ? section.replaceAll("\n", "\r\n") : section;
  const newline = crlf ? "\r\n" : "\n";

  const starts = occurrences(existing, SECTION_START);
  const ends = occurrences(existing, SECTION_END);

  if (starts.length === 0 && ends.length === 0) {
    if (existing.trim() === "") return `${ours}${newline}`;
    const gap = existing.endsWith(newline + newline)
      ? ""
      : existing.endsWith(newline)
        ? newline
        : newline + newline;
    return `${existing}${gap}${ours}${newline}`;
  }

  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    throw new MarkerError(
      `Expected one ${SECTION_START} followed by one ${SECTION_END}, found ` +
        `${starts.length} and ${ends.length}${starts.length === 1 && ends.length === 1 ? " in the wrong order" : ""}. ` +
        "Fix the markers by hand; the file was left as it was."
    );
  }

  return existing.slice(0, starts[0]) + ours + existing.slice(ends[0] + SECTION_END.length);
}

/**
 * Works out what writing the section to `path` would do, without writing.
 *
 * Separate from writing so `init --agents` can find a problem with AGENTS.md
 * before it has written the deployment file, and leave both untouched.
 */
export function planAgentsFile(path: string, section: string): AgentsPlan {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
  const contents = mergeSection(existing, section);

  const status = existing === null ? "created" : existing === contents ? "unchanged" : "updated";
  return { path, contents, status };
}

/** Writes a plan, reporting what happened relative to `cwd`. */
export function writeAgentsPlan(plan: AgentsPlan, cwd: string): void {
  const shown = display(plan.path, cwd);

  if (plan.status === "unchanged") {
    console.log(`${shown} is already up to date`);
  } else {
    writeFileSync(plan.path, plan.contents, "utf8");
    console.log(`${plan.status === "created" ? "Wrote" : "Updated"} the Cosmoner section in ${shown}`);
  }

  if (basename(plan.path) === AGENTS_FILE && !importsAgentsFile(dirname(plan.path))) {
    console.log("Claude Code reads CLAUDE.md: add the line @AGENTS.md to it to pick this up.");
  }
}

/** The path relative to the repository root, with forward slashes, for the section. */
export function repositoryPath(path: string, root: string): string {
  const rel = relative(root, resolve(root, path));
  return rel.split(sep).join("/");
}

/** Whether a CLAUDE.md beside AGENTS.md already imports it. */
function importsAgentsFile(dir: string): boolean {
  const claude = join(dir, "CLAUDE.md");
  return existsSync(claude) && readFileSync(claude, "utf8").includes(`@${AGENTS_FILE}`);
}

/** Every index at which `needle` occurs in `haystack`. */
function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    found.push(at);
  }
  return found;
}

/** A path as the user would recognise it: relative when under `cwd`. */
function display(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}
