/**
 * `cosmoner init` — write a starter deployment file.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { APP_SCHEMA_URL, validateDeployment } from "@cosmoner/sdk";

import { rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";

export const INIT_HELP = `cosmoner init [file]

Writes a starter .cosmoner/deployment.yaml, with a $schema header so an editor
validates and completes it as you type. With no file, it goes to the location
the platform checks first.

Options
  --name <name>    Service name. Lowercase letters, numbers and hyphens.
                   Defaults to web.
  --type <type>    service (default) for a long-lived process, or static for a
                   site built once and served as files.
  --force          Overwrite an existing file.`;

const FLAGS = ["name", "type", "force", "help"];

/** Flags that take a value, for the argument parser. */
export const INIT_VALUE_FLAGS = ["name", "type"];

/** Where the platform looks first, and so where a new file belongs. */
const DEFAULT_PATH = join(".cosmoner", "deployment.yaml");

export function runInit(args: ParsedArgs, cwd: string): number {
  rejectUnknownFlags(args, FLAGS);

  if (args.positional.length > 1) throw new UsageError("init takes at most one file");

  const path = args.positional[0] ?? join(cwd, DEFAULT_PATH);
  const name = readString(args, "name", "web");
  const type = readString(args, "type", "service");

  if (type !== "service" && type !== "static") {
    throw new UsageError("--type must be one of: service, static");
  }
  if (existsSync(path) && args.flags.get("force") !== true) {
    throw new UsageError(`${path} already exists. Pass --force to overwrite it.`);
  }

  const contents = template(name, type);

  // A starter file that does not pass `cosmoner validate` would be a poor
  // introduction, and --name takes a value this command does not otherwise
  // check. Validating what we are about to write catches both.
  const result = validateDeployment(contents);
  if (!result.valid) {
    throw new UsageError(
      `Cannot write that file: ${result.issues.map((issue) => issue.message).join("; ")}`
    );
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");

  console.log(`Wrote ${path}`);
  console.log("Check it with `cosmoner validate`.");
  return 0;
}

/** Reads a flag that must carry a value rather than standing alone. */
function readString(args: ParsedArgs, flag: string, fallback: string): string {
  const value = args.flags.get(flag);
  if (value === undefined) return fallback;
  if (value === true) throw new UsageError(`--${flag} needs a value`);
  return value;
}

/**
 * The starter file.
 *
 * Written out rather than generated from the schema: what a new file needs is
 * the handful of fields someone actually sets on their first deploy, with the
 * rest mentioned in a comment. A generated file listing every optional field
 * would be longer and less useful.
 */
function template(name: string, type: "service" | "static"): string {
  const header = `# yaml-language-server: $schema=${APP_SCHEMA_URL}\n`;

  if (type === "static") {
    return (
      header +
      `services:
  - name: ${name}
    type: static
    # Directory this site is built from. Defaults to the repository root.
    source_dir: .
    build:
      command: npm run build
      # Where the build writes the site, relative to source_dir.
      output_dir: dist
`
    );
  }

  return (
    header +
    `services:
  - name: ${name}
    type: service
    # Directory this service is built from. Defaults to the repository root.
    source_dir: .
    build:
      command: npm run build
    run_command: npm start
    # The app is given its port in PORT, so a service that listens on $PORT
    # needs nothing here. Set it only if yours listens on a fixed port.
    # port: 3000
    envs:
      - key: NODE_ENV
        value: production
      # Never commit a secret. Either mark it and fill the value in during the
      # deploy, or link one already stored in the project:
      # - key: DATABASE_URL
      #   from_secret: DATABASE_URL
`
  );
}
