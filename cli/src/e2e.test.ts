import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Runs the built binary rather than importing from `src`.
 *
 * Two things only exist after a build and so cannot be covered any other way:
 * the JSON Schema `scripts/copy-schema.mjs` places next to the bundle, and the
 * shebang that makes the file runnable. `npm test` builds first for this
 * reason — see package.json.
 */

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

/** Runs the built CLI, returning stdout and the exit code rather than throwing. */
function cosmoner(...argv: string[]): { code: number; stdout: string } {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [CLI, ...argv], { encoding: "utf8" }) };
  } catch (err) {
    const failure = err as { status?: number; stdout?: string };
    return { code: failure.status ?? 1, stdout: failure.stdout ?? "" };
  }
}

describe("the built CLI", () => {
  it("was built", () => {
    expect(existsSync(CLI), `${CLI} is missing — run npm run build`).toBe(true);
  });

  it("ships the JSON Schema beside the bundle", () => {
    const schema = JSON.parse(cosmoner("schema").stdout) as { $id?: string };

    expect(schema.$id).toBe("https://cosmoner.com/schemas/app.schema.json");
  });

  it("prints its own version", () => {
    expect(cosmoner("--version").stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("reports a bad file with exit code 1", () => {
    const result = cosmoner("validate", join(CLI, "..", "..", "..", "conformance", "cases", "static-port.yaml"));

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("port does not apply to a static site");
  });

  it("reports a good file with exit code 0", () => {
    const result = cosmoner("validate", join(CLI, "..", "..", "..", "conformance", "cases", "full.yaml"));

    expect(result.code).toBe(0);
  });
});
