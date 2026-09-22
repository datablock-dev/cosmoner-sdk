import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../../src/cli";
import type * as Stdin from "../../src/stdin";
import { readStdin, stdinIsTty } from "../../src/stdin";

/** Drives `cosmoner variables` through the real entry point against a mocked API. */

vi.mock("../../src/stdin", async (importOriginal) => ({
  ...(await importOriginal<typeof Stdin>()),
  readStdin: vi.fn(),
  stdinIsTty: vi.fn(),
}));

const API = "https://api.test.dev/v1/projects/proj-1/variables";
const ENV = {
  COSMONER_API_KEY: "key-123",
  COSMONER_PROJECT_ID: "proj-1",
  COSMONER_API_URL: "https://api.test.dev",
};

const ACTOR = { id: "user-1", name: "Ada", email: "ada@example.com" };

const VARIABLE = {
  id: "var-1",
  name: "LOG_LEVEL",
  description: null,
  value: "debug",
  environment: "development",
  createdBy: "user-1",
  updatedBy: "user-1",
  createdByUser: ACTOR,
  updatedByUser: ACTOR,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-02T12:00:00.000Z",
};

let out: string[];
let err: string[];
let fetchSpy: ReturnType<typeof vi.spyOn>;
let workspace: string;

/** A JSON response with the API's success envelope. */
function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Runs `cosmoner variables` with the given arguments. */
async function variables(argv: string[], env: Record<string, string> = ENV) {
  const code = await run(["variables", ...argv], workspace, false, env);
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

/** The body of the nth request the spy captured. */
function bodyOf(index: number): Record<string, unknown> {
  const init = fetchSpy.mock.calls[index][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  out = [];
  err = [];
  workspace = mkdtempSync(join(tmpdir(), "cosmoner-variables-"));
  vi.mocked(stdinIsTty).mockReturnValue(true);
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.mocked(readStdin).mockReset();
  vi.mocked(stdinIsTty).mockReset();
});

describe("variables", () => {
  it("lists variables with their values, unlike secrets", async () => {
    fetchSpy.mockResolvedValueOnce(ok([VARIABLE]));

    const result = await variables(["list"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("LOG_LEVEL");
    expect(result.stdout).toContain("debug");
  });

  it("says so when there are none", async () => {
    fetchSpy.mockResolvedValueOnce(ok([]));

    const result = await variables(["list"]);

    expect(result.stdout).toBe("No variables.");
  });

  it("creates a variable and echoes the value back", async () => {
    fetchSpy.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok(VARIABLE, 201));

    const result = await variables([
      "set",
      "LOG_LEVEL",
      "--value",
      "debug",
      "--environment",
      "development",
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("✓ Created LOG_LEVEL=debug in development");
    expect(bodyOf(1)).toEqual({
      name: "LOG_LEVEL",
      value: "debug",
      environment: "development",
    });
  });

  it("updates an existing name rather than creating a duplicate", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok([VARIABLE]))
      .mockResolvedValueOnce(ok({ ...VARIABLE, value: "info" }));

    const result = await variables([
      "set",
      "LOG_LEVEL",
      "--value",
      "info",
      "--environment",
      "development",
    ]);

    expect(result.stdout).toContain("✓ Set LOG_LEVEL=info in development");
    expect(fetchSpy).toHaveBeenLastCalledWith(
      `${API}/var-1`,
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("removes a variable found by name", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok([VARIABLE]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await variables(["rm", "LOG_LEVEL", "--environment", "development"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("✓ Removed LOG_LEVEL from development");
  });

  it("exits 1 for a name that is not there", async () => {
    fetchSpy.mockResolvedValueOnce(ok([]));

    const result = await variables(["rm", "LOG_LEVEL"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No variable named LOG_LEVEL in default");
  });

  it("names the variables scope when the key is missing", async () => {
    const result = await variables(["list"], { COSMONER_PROJECT_ID: "proj-1" });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("set COSMONER_API_KEY to an API key with variables:read");
  });

  it("names the variable to set before asking for a value", async () => {
    const result = await variables(["set"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Name the variable to set");
  });
});
