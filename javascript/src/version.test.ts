import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { USER_AGENT, VERSION } from "./version";

describe("VERSION", () => {
  it("is the version this package is published as", () => {
    // The constant exists because the bundled SDK has no manifest to read at
    // runtime, which makes it a second place the version lives. This is what
    // stops the two drifting — they had, by two releases, before it existed.
    const manifest = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
        "utf8"
      )
    ) as { version: string };

    expect(VERSION).toBe(manifest.version);
  });

  it("names the SDK in the User-Agent", () => {
    expect(USER_AGENT).toBe(`cosmoner-node/${VERSION}`);
  });
});
