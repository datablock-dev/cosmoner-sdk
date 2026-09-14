/**
 * Finding the deployment file when the command line does not name one.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { DEPLOYMENT_FILE_PATHS } from "@cosmoner/sdk";

import { UsageError } from "./args";

/**
 * Returns the file the platform would read, relative to `root`.
 *
 * The order of {@link DEPLOYMENT_FILE_PATHS} is the platform's own, and a
 * repository holding two of these files gets exactly one of them deployed — so
 * this stops at the first, rather than validating both and reporting on a file
 * that will never be read.
 */
export function discoverDeploymentFile(root: string): string {
  for (const candidate of DEPLOYMENT_FILE_PATHS) {
    const path = join(root, candidate);
    if (existsSync(path)) return path;
  }

  throw new UsageError(
    `No deployment file found. Looked for ${DEPLOYMENT_FILE_PATHS.join(", ")} — ` +
      "pass a path, or run `cosmoner init` to write one."
  );
}

/**
 * Returns the files a command should act on: the ones named, or the one the
 * platform would read.
 */
export function resolveTargets(positional: string[], root: string): string[] {
  return positional.length > 0 ? positional : [discoverDeploymentFile(root)];
}
