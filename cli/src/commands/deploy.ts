/**
 * `cosmoner deploy` — roll an image app onto a new image and wait for it.
 *
 * The one command that needs an account. It reads its credentials from the
 * environment or the saved `cosmoner login`, never from flags, so an API key
 * never lands in a CI log or a shell history.
 */

import {
  CosmonerError,
  type Cosmoner,
  type App,
  type AppDeployment,
  type DeployAppParams,
} from "@cosmoner/sdk";

import { describeApiError } from "../api-error";
import { readChoice, readValue, rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";
import { makeClient, usesSession } from "../credentials";

export const DEPLOY_HELP = `cosmoner deploy <app> [options]

Deploys an image app — one that runs an image from a Cosmoner registry — and
waits for the rollout to finish. <app> is the app's name or id.

With neither --tag nor --digest, the image the app already names is pulled
again, which picks up a tag that was pushed over.

Options
  --tag <tag>          Deploy this tag from the app's repository. A commit SHA
                       pushed as a tag goes here.
  --digest <digest>    Deploy this exact image: sha256:<64 hex characters>. The
                       sha256: prefix may be left off.
  --project <project>  Project the app is in, by slug or id. Defaults to
                       COSMONER_PROJECT_ID, then the one set with cosmoner use.
  --no-wait            Return once the deploy is accepted, without waiting.
  --timeout <seconds>  How long to wait for the rollout. Defaults to 600.
  --format <format>    text (default) or json.

Environment
  COSMONER_API_KEY     API key to use instead of cosmoner login. Needs
                       apps:read and apps:write.
  COSMONER_PROJECT_ID  Project to use when --project is not given.
  COSMONER_API_URL     API base URL. Defaults to https://api.cosmoner.com.

Exit code is 0 when the deploy went live (or, with --no-wait, was accepted), 1
when it failed, timed out or was refused by the API, and 2 when the command
itself was wrong.`;

/** Flags taking a separate value. */
export const DEPLOY_VALUE_FLAGS = ["tag", "digest", "project", "timeout", "format"];

/** Flags this command understands. Anything else is a typo worth refusing. */
const FLAGS = [...DEPLOY_VALUE_FLAGS, "no-wait", "help"];

const FORMATS = ["text", "json"] as const;
type DeployFormat = (typeof FORMATS)[number];

const DEFAULT_TIMEOUT_SECONDS = 600;

/** How often the deployment is polled while waiting. */
export const POLL_INTERVAL_MS = 3_000;

/**
 * The longest stretch a saved CLI session waits on one access token.
 *
 * A session's access token lives an hour, and `--timeout` can be longer than
 * that. The SDK's wait cannot swap credentials mid-loop, so a long wait is cut
 * into windows, each started on a token refreshed to outlast it.
 */
export const SESSION_WAIT_WINDOW_MS = 40 * 60 * 1000;

/** Slack on top of a window, for the requests either side of the wait. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

const SCOPE = "apps:read and apps:write";

/** Runs `cosmoner deploy`, returning the exit code. */
export async function runDeploy(args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<number> {
  rejectUnknownFlags(args, FLAGS);

  const [appRef, ...extra] = args.positional;
  if (appRef === undefined) throw new UsageError("Name the app to deploy");
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}"`);

  const target = readTarget(args);
  const wait = args.flags.get("no-wait") !== true;
  const timeoutSeconds = readTimeout(args);
  const format = readChoice<DeployFormat>(args, "format", FORMATS, "text");

  const windowMs = usesSession(env) ? SESSION_WAIT_WINDOW_MS : Number.POSITIVE_INFINITY;
  const firstWindowMs = wait ? Math.min(timeoutSeconds * 1000, windowMs) : 0;
  let client = await makeClient(args, env, SCOPE, firstWindowMs + TOKEN_MARGIN_MS);
  const say = format === "text" ? (line: string) => console.log(line) : () => {};

  try {
    const app = await findApp(client, appRef);
    if (app.gitRepo) {
      throw new Error(`${app.name} is built from ${app.gitRepo}; push to its branch to deploy it`);
    }

    say(`Deploying ${app.name} (${describeTarget(target, app)})`);
    const { data: started } = await client.apps.deploy(app.id, target);

    if (!wait) {
      say(`Accepted as deployment ${started.id}`);
      if (format === "json") printJson(app, started);
      return 0;
    }

    const startedAt = Date.now();
    let lastPhase = started.phase;
    say(`  ${lastPhase}`);

    const deadline = startedAt + timeoutSeconds * 1000;
    let finished: AppDeployment | undefined;
    while (finished === undefined) {
      const windowEnd = Math.min(deadline, Date.now() + windowMs);
      try {
        finished = await client.apps.waitForDeployment(app.id, started.id, {
          interval: POLL_INTERVAL_MS,
          timeout: Math.max(1, windowEnd - Date.now()),
          onPoll: (deployment) => {
            if (deployment.phase === lastPhase) return;
            lastPhase = deployment.phase;
            say(`  ${lastPhase}`);
          },
        });
      } catch (err) {
        // Only a window running out is waited past. An API error, or the
        // whole --timeout elapsing, ends the wait as it always did.
        const windowRanOut = !(err instanceof CosmonerError) && Date.now() >= windowEnd;
        if (!windowRanOut) throw err;
        if (windowEnd >= deadline) {
          throw new Error(`Deployment ${started.id} was still ${lastPhase} after ${timeoutSeconds}s`, { cause: err });
        }
        client = await makeClient(args, env, SCOPE, Math.min(deadline - Date.now(), windowMs) + TOKEN_MARGIN_MS);
      }
    }

    if (format === "json") printJson(app, finished);

    if (finished.phase === "ACTIVE") {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      say(`✓ ${app.name} is live on ${finished.imageRef ?? "its image"} after ${seconds}s`);
      return 0;
    }

    console.error(explainFailure(app, finished));
    return 1;
  } catch (err) {
    console.error(err instanceof CosmonerError ? describeApiError(err) : messageOf(err));
    return 1;
  }
}

/** Reads --tag or --digest into the deploy body, normalising a bare digest. */
function readTarget(args: ParsedArgs): DeployAppParams {
  const tag = readValue(args, "tag");
  const digest = readValue(args, "digest");
  if (tag !== undefined && digest !== undefined) {
    throw new UsageError("Pass either --tag or --digest, not both");
  }
  if (digest !== undefined) {
    const normalised = digest.toLowerCase().replace(/^(sha256:)?/, "sha256:");
    if (!/^sha256:[a-f0-9]{64}$/.test(normalised)) {
      throw new UsageError("--digest must be sha256:<64 hex characters>");
    }
    return { digest: normalised };
  }
  if (tag !== undefined && !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) {
    throw new UsageError(`"${tag}" is not a valid image tag`);
  }
  return tag === undefined ? {} : { tag };
}

/** Reads --timeout as a whole number of seconds. */
function readTimeout(args: ParsedArgs): number {
  const value = readValue(args, "timeout");
  if (value === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new UsageError("--timeout must be a whole number of seconds");
  }
  return seconds;
}

/**
 * Finds the app by id or by name.
 *
 * An id is checked first so an app named like another app's id still resolves
 * to the one that id belongs to. Names are unique within a project, so a name
 * matches at most one app.
 */
async function findApp(client: Cosmoner, ref: string): Promise<App> {
  const { data: apps } = await client.apps.list();
  const app = apps.find((candidate) => candidate.id === ref) ??
    apps.find((candidate) => candidate.name === ref);
  if (!app) throw new Error(`No app named "${ref}" in this project`);
  return app;
}

/** Says which image is about to be deployed, for the first line of output. */
function describeTarget(target: DeployAppParams, app: App): string {
  if (target.tag) return `tag ${target.tag}`;
  if (target.digest) return target.digest;
  return app.containerImage ? `current image ${app.containerImage}` : "current image";
}

/** Explains a deployment that finished without going live. */
function explainFailure(app: App, deployment: AppDeployment): string {
  switch (deployment.phase) {
    case "SUPERSEDED":
      return `✗ ${app.name}: a newer deployment replaced this one before it went live`;
    case "CANCELED":
      return `✗ ${app.name}: the deployment was canceled`;
    default:
      return `✗ ${app.name} failed to deploy${deployment.error ? `: ${deployment.error}` : ""}`;
  }
}

/** Prints the outcome as one object, for a script that wants to act on it. */
function printJson(app: App, deployment: AppDeployment): void {
  console.log(JSON.stringify({ app: { id: app.id, name: app.name }, deployment }, null, 2));
}

/** A readable message from anything thrown. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
