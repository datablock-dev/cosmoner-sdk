import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgents, SECTION_END, SECTION_START } from "../src/commands/agents";
import { checkAgentsFile, checkForUpdate, type AgentsCheckContext, type UpdateCheckContext } from "../src/update-check";

/**
 * The update notice: how often the registry is asked, how often the notice
 * shows, and everywhere it must stay silent. Then the same for the notice that
 * AGENTS.md is out of date.
 */

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 7, 12);

let dir: string;

/** A fetch that answers the registry with `version`, counting its calls. */
function registry(version: string | null) {
  return vi.fn(() =>
    Promise.resolve(
      version === null
        ? new Response("down", { status: 503 })
        : new Response(JSON.stringify({ name: "@cosmoner/cli", version }), { status: 200 })
    )
  );
}

/** A context for a networked command in a terminal, at `now`. */
function context(fetchImpl: typeof fetch, now: number, overrides: Partial<UpdateCheckContext> = {}): UpdateCheckContext {
  return {
    env: { COSMONER_CONFIG_DIR: dir },
    command: "apps",
    current: "0.9.0",
    stderrIsTty: true,
    viaNpx: false,
    fetch: fetchImpl,
    now,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cosmoner-update-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("checkForUpdate", () => {
  it("names the newer version and how to install it", async () => {
    const notice = await checkForUpdate(context(registry("0.10.1"), T0));

    expect(notice).toBe("cosmoner 0.10.1 is out; you have 0.9.0. Update with npm install -g @cosmoner/cli.");
  });

  it("tells an npx user to run the latest instead", async () => {
    const notice = await checkForUpdate(context(registry("0.10.1"), T0, { viaNpx: true }));

    expect(notice).toContain("Run npx @cosmoner/cli@latest");
  });

  it("asks the registry at most once a day", async () => {
    const fetchImpl = registry("0.10.1");

    await checkForUpdate(context(fetchImpl, T0));
    await checkForUpdate(context(fetchImpl, T0 + DAY - 1));
    await checkForUpdate(context(fetchImpl, T0 + DAY));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("shows the notice at most once a day", async () => {
    const fetchImpl = registry("0.10.1");

    const first = await checkForUpdate(context(fetchImpl, T0));
    const sameDay = await checkForUpdate(context(fetchImpl, T0 + 60_000));
    const nextDay = await checkForUpdate(context(fetchImpl, T0 + DAY));

    expect(first).not.toBeNull();
    expect(sameDay).toBeNull();
    expect(nextDay).not.toBeNull();
  });

  it("says nothing when the CLI is current or newer", async () => {
    expect(await checkForUpdate(context(registry("0.9.0"), T0))).toBeNull();
    expect(await checkForUpdate(context(registry("0.8.9"), T0 + DAY, { current: "0.9.0" }))).toBeNull();
  });

  it("compares versions numerically, not as text", async () => {
    expect(await checkForUpdate(context(registry("0.10.0"), T0, { current: "0.9.9" }))).not.toBeNull();
  });

  it("counts a failed lookup as the day's lookup, and stays silent", async () => {
    const fetchImpl = registry(null);

    expect(await checkForUpdate(context(fetchImpl, T0))).toBeNull();
    expect(await checkForUpdate(context(fetchImpl, T0 + 60_000))).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never asks in CI, without a terminal, when switched off, or for the offline commands", async () => {
    const fetchImpl = registry("0.10.1");

    for (const overrides of [
      { env: { COSMONER_CONFIG_DIR: dir, CI: "true" } },
      { env: { COSMONER_CONFIG_DIR: dir, COSMONER_NO_UPDATE_CHECK: "1" } },
      { stderrIsTty: false },
      { command: "validate" },
      { command: "fmt" },
      { command: undefined },
      { command: "--version" },
    ] satisfies Array<Partial<UpdateCheckContext>>) {
      expect(await checkForUpdate(context(fetchImpl, T0, overrides))).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps its state beside the saved login", async () => {
    await checkForUpdate(context(registry("0.10.1"), T0));

    const state = JSON.parse(readFileSync(join(dir, "update-check.json"), "utf8"));
    expect(state).toEqual({ checkedAt: T0, latest: "0.10.1", notifiedAt: T0 });
  });

  it("ignores a registry answer that is not a release version", async () => {
    expect(await checkForUpdate(context(registry("1.0.0-beta.1"), T0))).toBeNull();
  });
});

describe("checkAgentsFile", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "cosmoner-repo-"));
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  /** A context for a networked command in a terminal, in `repo`, at `now`. */
  function agentsContext(now: number, overrides: Partial<AgentsCheckContext> = {}): AgentsCheckContext {
    return { env: { COSMONER_CONFIG_DIR: dir }, command: "apps", cwd: repo, stderrIsTty: true, now, ...overrides };
  }

  /** Writes AGENTS.md with an older release's section between the markers. */
  function writeStale(): void {
    writeFileSync(join(repo, "AGENTS.md"), `# Notes\n\n${SECTION_START}\n## Deploying to Cosmoner\n\nOld text.\n${SECTION_END}\n`);
  }

  it("says so when the section is not what this CLI would write", () => {
    writeStale();

    expect(checkAgentsFile(agentsContext(T0))).toContain("Run cosmoner agents");
  });

  it("says nothing once cosmoner agents has refreshed it", () => {
    writeStale();
    expect(runAgents({ positional: [], flags: new Map() }, repo)).toBe(0);

    expect(checkAgentsFile(agentsContext(T0))).toBeNull();
  });

  it("says nothing without a file, or for a file with no Cosmoner section", () => {
    expect(checkAgentsFile(agentsContext(T0))).toBeNull();
    writeFileSync(join(repo, "AGENTS.md"), "# Notes\n");
    expect(checkAgentsFile(agentsContext(T0))).toBeNull();
  });

  it("says it at most once a day", () => {
    writeStale();

    expect(checkAgentsFile(agentsContext(T0))).not.toBeNull();
    expect(checkAgentsFile(agentsContext(T0 + 60_000))).toBeNull();
    expect(checkAgentsFile(agentsContext(T0 + DAY))).not.toBeNull();
  });

  it("stays silent in CI, without a terminal, when switched off, and for cosmoner agents itself", () => {
    writeStale();

    for (const overrides of [
      { env: { COSMONER_CONFIG_DIR: dir, CI: "true" } },
      { env: { COSMONER_CONFIG_DIR: dir, COSMONER_NO_UPDATE_CHECK: "1" } },
      { stderrIsTty: false },
      { command: "agents" },
    ] satisfies Array<Partial<AgentsCheckContext>>) {
      expect(checkAgentsFile(agentsContext(T0, overrides))).toBeNull();
    }
  });
});
