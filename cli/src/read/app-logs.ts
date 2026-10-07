/**
 * `cosmoner apps logs <app>` — the recent lines of an app's build or run log.
 *
 * Log text is whatever the app printed, so it passes through the same
 * redaction as every read: a connection string an app logged at startup is
 * masked here rather than copied into an agent's transcript.
 */

import { CosmonerError, type AppLogType } from "@cosmoner/sdk";

import { describeApiError } from "../api-error";
import { readChoice, rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";
import { makeClient } from "../credentials";
import { redact } from "./redact";

export const APP_LOGS_VALUE_FLAGS = ["project", "format", "type"];
const FLAGS = [...APP_LOGS_VALUE_FLAGS, "help"];

const TYPES = ["run", "build"] as const;
const FORMATS = ["text", "json"] as const;

/** Help for `cosmoner apps logs`. */
export const APP_LOGS_HELP = `cosmoner apps logs <app> [options]

Prints the most recent lines of an app's log. <app> is its name or id.

Options
  --type run|build     The running app's log, or its last build. Defaults to run.
  --project <project>  Defaults to COSMONER_PROJECT_ID, then cosmoner use.
  --format text|json   json prints { lines: [{ message, timestamp }] }.

Passwords in URLs within log lines are masked.

Needs apps:read.`;

/** Runs `cosmoner apps logs <app>`, returning the exit code. */
export async function runAppLogs(args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<number> {
  rejectUnknownFlags(args, FLAGS);
  const [, ref, ...extra] = args.positional;
  if (ref === undefined) throw new UsageError("Name the app: cosmoner apps logs <app>");
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}"`);
  const type = readChoice(args, "type", TYPES, "run").toUpperCase() as AppLogType;
  const format = readChoice(args, "format", FORMATS, "text");

  const client = await makeClient(args, env, "apps:read");
  try {
    const { data: apps } = await client.apps.list();
    const app = apps.find((candidate) => candidate.id === ref) ?? apps.find((candidate) => candidate.name === ref);
    if (!app) {
      console.error(`No app "${ref}" in this project.`);
      return 1;
    }

    const { data } = await client.apps.logs(app.id, { type });
    const safe = redact(data);
    if (format === "json") {
      console.log(JSON.stringify(safe, null, 2));
    } else if (safe.lines.length === 0) {
      console.log(`No ${type === "BUILD" ? "build" : "run"} log lines for ${app.name}.`);
    } else {
      console.log(safe.lines.map((line) => `${line.timestamp}  ${line.message}`).join("\n"));
    }
    return 0;
  } catch (err) {
    console.error(err instanceof CosmonerError ? describeApiError(err) : err instanceof Error ? err.message : String(err));
    return 1;
  }
}
