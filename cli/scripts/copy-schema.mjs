/**
 * Copies the vendored JSON Schema into the build output.
 *
 * `cosmoner schema` prints it, so it has to ship with the package — but a
 * second committed copy under `cli/` would be a second thing for CI's drift
 * check to keep current, and the one place it could fall behind unnoticed.
 * Copying at build time keeps `schemas/app-schema.json` the only copy in the
 * repository.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");

mkdirSync(dist, { recursive: true });
copyFileSync(join(here, "..", "..", "schemas", "app-schema.json"), join(dist, "app-schema.json"));

console.log("Copied app-schema.json into dist/");
