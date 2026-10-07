/**
 * `cosmoner` — the Cosmoner command line: a project's resources, deploys, and
 * the deployment file.
 *
 * The file commands run offline. Validating a file needs no account, and a
 * check that reaches the network is a check that fails when the network does,
 * which is not what anyone wants guarding a push. Every other command reads a
 * credential.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseArgs, UsageError, type ParsedArgs } from "./args";
import { AGENTS_HELP, runAgents } from "./commands/agents";
import { DEPLOY_HELP, DEPLOY_VALUE_FLAGS, runDeploy } from "./commands/deploy";
import { FMT_HELP, runFmt } from "./commands/fmt";
import { INIT_HELP, INIT_VALUE_FLAGS, runInit } from "./commands/init";
import { LOGIN_HELP, runLogin } from "./commands/login";
import { LOGOUT_HELP, runLogout } from "./commands/logout";
import { runSchema, SCHEMA_HELP } from "./commands/schema";
import { runSecrets, SECRETS_HELP, SECRETS_VALUE_FLAGS } from "./commands/secrets";
import { runUpload, UPLOAD_HELP, UPLOAD_VALUE_FLAGS } from "./commands/upload";
import { runUse, USE_HELP } from "./commands/use";
import { runValidate, VALIDATE_HELP } from "./commands/validate";
import { runVariables, VARIABLES_HELP, VARIABLES_VALUE_FLAGS } from "./commands/variables";
import { runWhoami, WHOAMI_HELP } from "./commands/whoami";
import { APP_LOGS_HELP, APP_LOGS_VALUE_FLAGS, runAppLogs } from "./read/app-logs";
import { OVERVIEW_HELP, runOverview } from "./read/overview";
import { PRODUCTS } from "./read/products";
import { productHelp, productValueFlags, READ_VALUE_FLAGS, runProduct } from "./read/resource";
import { checkAgentsFile, checkForUpdate } from "./update-check";

/** The top-level help. Exported so a test can hold it to every command that exists. */
export const HELP = `cosmoner — the Cosmoner command line

Usage
  cosmoner <command> [options]
  cosmoner <product> <verb> [<name>] [options]

What a project has
  apps  servers  databases  redis  buckets  registries  hosting  domains
  email  iam  ssh-keys  webhooks  secrets  variables  members  projects

  cosmoner <product> get [<name>]   List everything, or show one item.
  cosmoner get --all                Every product in the project at once.
  cosmoner <product> create <name>  Order or add one. Paid orders show the
                                    price and ask first.
  cosmoner <product> delete <name>  Delete one. Asks first.
  cosmoner <product> --help         Every verb a product has: update, resize,
                                    start, stop, verify, logs, sizes and more.

  --project <project> picks the project; the default is set with use.
  --format json prints the API's objects, for scripts and agents.
  --yes answers a confirmation in advance, for scripts.

Deploying
  deploy     Deploy an image app and wait for it to go live.
  upload     Upload a folder to a web hosting site over SFTP.

Deployment files — offline: no account, no API key, no network
  validate   Check a deployment file against the format the platform reads.
  fmt        Rewrite a deployment file in canonical form.
  init       Write a starter deployment file.
  schema     Print the JSON Schema for the file.
  agents     Write instructions for coding agents into AGENTS.md.

Signing in
  login      Sign in through the browser, to every project you are a member of.
  use        Set the project commands act on by default.
  whoami     Show who the CLI is signed in as, and the default project.
  logout     Sign this machine out.

cosmoner <command> --help for a command's options.`;

/** Flags taking a separate value, per command, for the argument parser. */
const VALUE_FLAGS: Record<string, readonly string[]> = {
  validate: ["format"],
  fmt: [],
  init: INIT_VALUE_FLAGS,
  schema: [],
  agents: [],
  deploy: DEPLOY_VALUE_FLAGS,
  upload: UPLOAD_VALUE_FLAGS,
  secrets: SECRETS_VALUE_FLAGS,
  variables: VARIABLES_VALUE_FLAGS,
  login: [],
  use: [],
  logout: [],
  whoami: [],
  get: READ_VALUE_FLAGS,
  ...Object.fromEntries(
    Object.entries(PRODUCTS).map(([name, product]) => [
      name,
      name === "apps" ? [...new Set([...productValueFlags(product), ...APP_LOGS_VALUE_FLAGS])] : productValueFlags(product),
    ])
  ),
};

/**
 * Every command and its help text. Exported so the tests can hold the AGENTS.md
 * section to the commands and flags that actually exist.
 */
export const COMMAND_HELP: Record<string, string> = {
  validate: VALIDATE_HELP,
  fmt: FMT_HELP,
  init: INIT_HELP,
  schema: SCHEMA_HELP,
  agents: AGENTS_HELP,
  deploy: DEPLOY_HELP,
  upload: UPLOAD_HELP,
  secrets: SECRETS_HELP,
  variables: VARIABLES_HELP,
  login: LOGIN_HELP,
  use: USE_HELP,
  logout: LOGOUT_HELP,
  whoami: WHOAMI_HELP,
  get: OVERVIEW_HELP,
  ...Object.fromEntries(
    Object.entries(PRODUCTS).map(([name, product]) => [
      name,
      name === "apps" ? `${productHelp(product)}\n\n${APP_LOGS_HELP}` : productHelp(product),
    ])
  ),
};

/**
 * Runs one command line.
 *
 * Returns the exit code instead of calling `process.exit`, so the tests can run
 * the real thing rather than a rearrangement of it. Only the commands that reach
 * the API return it as a promise; the offline commands stay synchronous.
 */
export function run(
  argv: string[],
  cwd: string,
  isTty: boolean,
  env: NodeJS.ProcessEnv = process.env
): number | Promise<number> {
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
      case "agents":
        return runAgents(args, cwd);
      case "deploy":
        return runDeploy(args, env).catch((err: unknown) => reportUsage(err, command));
      case "upload":
        return runUpload(args, cwd, env).catch((err: unknown) => reportUsage(err, command));
      case "secrets":
        return runSecrets(args, cwd, env).catch((err: unknown) => reportUsage(err, command));
      case "variables":
        return runVariables(args, cwd, env).catch((err: unknown) => reportUsage(err, command));
      case "login":
        return runLogin(args, env).catch((err: unknown) => reportUsage(err, command));
      case "use":
        return runUse(args, env).catch((err: unknown) => reportUsage(err, command));
      case "logout":
        return runLogout(args, env).catch((err: unknown) => reportUsage(err, command));
      case "whoami":
        return runWhoami(args, env).catch((err: unknown) => reportUsage(err, command));
      case "get":
        return runOverview(args, env).catch((err: unknown) => reportUsage(err, command));
      default: {
        const product = PRODUCTS[command];
        if (!product) return 2;
        if (command === "apps" && args.positional[0] === "logs") {
          return runAppLogs(args, env).catch((err: unknown) => reportUsage(err, command));
        }
        return runProduct(product, args, env).catch((err: unknown) => reportUsage(err, command));
      }
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
  void (async () => {
    const argv = process.argv.slice(2);
    // Started alongside the command, so the day's registry lookup overlaps it.
    const update = checkForUpdate({
      env: process.env,
      command: argv[0],
      current: version(),
      stderrIsTty: process.stderr.isTTY === true,
      viaNpx: /[\\/]_npx[\\/]/.test(process.argv[1] ?? ""),
    });
    try {
      process.exitCode = await run(argv, process.cwd(), process.stdout.isTTY === true);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    }
    const notice = await update;
    if (notice !== null) console.error(`\n${notice}`);
    const agents = checkAgentsFile({ env: process.env, command: argv[0], cwd: process.cwd(), stderrIsTty: process.stderr.isTTY === true });
    if (agents !== null) console.error(`\n${agents}`);
  })();
}
/* c8 ignore stop */
