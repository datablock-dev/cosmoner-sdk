/**
 * `cosmoner` — command line tools for Cosmoner deployment files.
 *
 * Every command here runs offline. Validating a file needs no account, and a
 * check that reaches the network is a check that fails when the network does,
 * which is not what anyone wants guarding a push. Commands that do need an API
 * key will come later, and will use `@cosmoner/sdk` for it; nothing in this
 * file should grow a credential in the meantime.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseArgs, UsageError, type ParsedArgs } from "./args";
import { FMT_HELP, runFmt } from "./commands/fmt";
import { INIT_HELP, INIT_VALUE_FLAGS, runInit } from "./commands/init";
import { runSchema, SCHEMA_HELP } from "./commands/schema";
import { runValidate, VALIDATE_HELP } from "./commands/validate";

const HELP = `cosmoner — tools for .cosmoner/deployment.yaml

Usage
  cosmoner <command> [options]

Commands
  validate   Check a deployment file against the format the platform reads.
  fmt        Rewrite a deployment file in canonical form.
  init       Write a starter deployment file.
  schema     Print the JSON Schema for the file.

  cosmoner <command> --help for a command's options.

Everything here works offline: no account, no API key, no network.`;

/** Flags taking a separate value, per command, for the argument parser. */
const VALUE_FLAGS: Record<string, readonly string[]> = {
  validate: ["format"],
  fmt: [],
  init: INIT_VALUE_FLAGS,
  schema: [],
};

const COMMAND_HELP: Record<string, string> = {
  validate: VALIDATE_HELP,
  fmt: FMT_HELP,
  init: INIT_HELP,
  schema: SCHEMA_HELP,
};

/**
 * Runs one command line.
 *
 * Returns the exit code instead of calling `process.exit`, so the tests can run
 * the real thing rather than a rearrangement of it.
 */
export function run(argv: string[], cwd: string, isTty: boolean): number {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    console.log(version());
    return 0;
  }
  if (!(command in COMMAND_HELP)) {
    console.error(`Unknown command "${command}".\n`);
    console.error(HELP);
    return 2;
  }

  let args: ParsedArgs;
  try {
    args = parseArgs(rest, VALUE_FLAGS[command]);
  } catch (err) {
    return reportUsage(err, command);
  }

  if (args.flags.get("help") === true) {
    console.log(COMMAND_HELP[command]);
    return 0;
  }

  try {
    switch (command) {
      case "validate":
        return runValidate(args, cwd, isTty);
      case "fmt":
        return runFmt(args, cwd);
      case "init":
        return runInit(args, cwd);
      case "schema":
        return runSchema(args);
      default:
        return 2;
    }
  } catch (err) {
    return reportUsage(err, command);
  }
}

/**
 * Turns a failure into a message and an exit code.
 *
 * 2 for "you asked for something I cannot do", leaving 1 to mean exactly one
 * thing: a file was checked and it did not pass. A CI job that treats any
 * non-zero code as a failing file would otherwise report a typo in its own
 * command line as a broken deployment file.
 */
function reportUsage(err: unknown, command: string): number {
  if (err instanceof UsageError) {
    console.error(`${err.message}\n`);
    console.error(COMMAND_HELP[command]);
    return 2;
  }
  throw err;
}

/**
 * The CLI's own version, read from the package it was installed as.
 *
 * Read rather than hardcoded because the release workflow bumps package.json
 * and nothing else; a constant here would be a second place to remember, and
 * the kind that is wrong for months before anyone notices.
 */
function version(): string {
  try {
    const manifest = readFileSync(join(__dirname, "..", "package.json"), "utf8");
    return (JSON.parse(manifest) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/* c8 ignore start — the process wrapper, exercised by the end-to-end tests. */
// Guarded because the tests import this module as ESM, where require does not
// exist; the built bundle is CommonJS, where it does.
if (typeof require !== "undefined" && require.main === module) {
  try {
    process.exitCode = run(process.argv.slice(2), process.cwd(), process.stdout.isTTY === true);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  }
}
/* c8 ignore stop */
