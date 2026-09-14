/**
 * `cosmoner schema` — print the JSON Schema for the deployment file.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { APP_SCHEMA_URL } from "@cosmoner/sdk";

import { rejectUnknownFlags, type ParsedArgs } from "../args";

export const SCHEMA_HELP = `cosmoner schema

Prints the JSON Schema for .cosmoner/deployment.yaml — the same document the
platform serves, shipped with this CLI so it works offline.

Editors usually want the URL rather than the file; the header cosmoner fmt adds
points at it already. Write the file out when the editor cannot fetch it:

  cosmoner schema > .cosmoner/app.schema.json

Options
  --url    Print the published URL instead of the document.`;

const FLAGS = ["url", "help"];

export function runSchema(args: ParsedArgs): number {
  rejectUnknownFlags(args, FLAGS);

  if (args.flags.get("url") === true) {
    console.log(APP_SCHEMA_URL);
    return 0;
  }

  console.log(readSchema().replace(/\n$/, ""));
  return 0;
}

/**
 * Reads the shipped schema.
 *
 * `scripts/copy-schema.mjs` puts it beside the built bundle, which is the only
 * place it exists once the package is installed. There is deliberately no
 * fallback to the repository's copy: a second path would only be exercised when
 * running from the source tree, where it would quietly paper over a build step
 * that had stopped copying the file. The CLI's own tests run the built binary
 * for this reason.
 */
export function readSchema(): string {
  const path = join(__dirname, "app-schema.json");

  if (!existsSync(path)) {
    throw new Error(
      "The bundled JSON Schema is missing. Reinstall @cosmoner/cli, or fetch it " +
        `from ${APP_SCHEMA_URL}.`
    );
  }
  return readFileSync(path, "utf8");
}
