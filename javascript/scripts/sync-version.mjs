/**
 * Rewrites `src/version.ts` from package.json.
 *
 * The version reaches the User-Agent through a constant, because the bundled
 * SDK has no manifest to read at runtime — so something has to keep that
 * constant honest. The release workflow runs this immediately after
 * `npm version` and commits the result alongside package.json.
 *
 * Prints what it did, which is why `scripts/**` turns off the no-console rule
 * the rest of the package is held to: a release step that changes a committed
 * file in silence is one nobody can check afterwards from the log.
 *
 * Idempotent: running it on a file that is already current does nothing and
 * still succeeds, so the release workflow does not need to know which it is.
 * `version.test.ts` is what turns a stale file into a failure.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "src", "version.ts");

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const current = readFileSync(target, "utf8");
const updated = current.replace(
  /export const VERSION = "[^"]*";/,
  `export const VERSION = "${version}";`
);

if (updated === current) {
  console.log(`src/version.ts is already ${version}`);
} else {
  writeFileSync(target, updated);
  console.log(`Set src/version.ts to ${version}`);
}
