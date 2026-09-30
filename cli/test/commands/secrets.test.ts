import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../../src/cli";
import type * as Stdin from "../../src/stdin";
import { readStdin, stdinIsTty } from "../../src/stdin";

/**
 * Drives `cosmoner secrets` through the real entry point against a mocked API.
 *
 * Stdin is mocked rather than fed: the command runs in this process, where the
 * real stdin belongs to the test runner and reading it would hang.
 */

vi.mock("../../src/stdin", async (importOriginal) => ({
  ...(await importOriginal<typeof Stdin>()),
  readStdin: vi.fn(),
  stdinIsTty: vi.fn(),
}));

const API = "https://api.test.dev/v1/projects/proj-1/secrets";
const ENV = {
  COSMONER_API_KEY: "key-123",
  COSMONER_PROJECT_ID: "proj-1",
  COSMONER_API_URL: "https://api.test.dev",
};

const ACTOR = { id: "user-1", name: "Ada", email: "ada@example.com" };

const SECRET = {
  id: "sec-1",
  name: "DB_PASSWORD",
  description: null,
  environment: "production",
  version: 1,
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

/** A JSON response with the API's error envelope. */
function fail(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Runs `cosmoner secrets` with the given arguments. */
async function secrets(argv: string[], env: Record<string, string> = ENV) {
  const code = await run(["secrets", ...argv], workspace, false, env);
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
  workspace = mkdtempSync(join(tmpdir(), "cosmoner-secrets-"));
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

describe("secrets list", () => {
  it("lists every environment when none is named", async () => {
    fetchSpy.mockResolvedValueOnce(ok([SECRET]));

    const result = await secrets(["list"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("DB_PASSWORD");
    expect(result.stdout).toContain("production");
    expect(fetchSpy).toHaveBeenCalledWith(API, expect.objectContaining({ method: "GET" }));
  });

  it("narrows to one environment when asked", async () => {
    fetchSpy.mockResolvedValueOnce(ok([SECRET]));

    await secrets(["list", "--environment", "production"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      `${API}?environment=production`,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("says so when there are none", async () => {
    fetchSpy.mockResolvedValueOnce(ok([]));

    const result = await secrets(["list"]);

    expect(result.stdout).toBe("No secrets.");
  });

  it("emits JSON without a value", async () => {
    fetchSpy.mockResolvedValueOnce(ok([SECRET]));

    const result = await secrets(["list", "--format", "json"]);

    expect(JSON.parse(result.stdout)).toEqual([SECRET]);
  });
});

describe("secrets set", () => {
  it("creates a secret from a piped value and never prints it", async () => {
    vi.mocked(stdinIsTty).mockReturnValue(false);
    vi.mocked(readStdin).mockReturnValue("hunter2\n");
    fetchSpy
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok({ ...SECRET, value: "hunter2", maskedValue: "hu••••r2" }, 201));

    const result = await secrets(["set", "DB_PASSWORD", "--environment", "production"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("✓ Created DB_PASSWORD as hu••••r2 in production");
    expect(`${result.stdout}${result.stderr}`).not.toContain("hunter2");
    expect(bodyOf(1)).toEqual({
      name: "DB_PASSWORD",
      value: "hunter2",
      environment: "production",
    });
  });

  it("strips exactly one trailing newline from a pipe", async () => {
    vi.mocked(stdinIsTty).mockReturnValue(false);
    vi.mocked(readStdin).mockReturnValue("hunter2\n\n");
    fetchSpy.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok(SECRET, 201));

    await secrets(["set", "DB_PASSWORD"]);

    expect(bodyOf(1).value).toBe("hunter2\n");
  });

  it("updates an existing name in the same environment instead of creating a duplicate", async () => {
    vi.mocked(stdinIsTty).mockReturnValue(false);
    vi.mocked(readStdin).mockReturnValue("hunter3");
    fetchSpy
      .mockResolvedValueOnce(ok([SECRET]))
      .mockResolvedValueOnce(
        ok({ ...SECRET, version: 2, value: "hunter3", maskedValue: "hu••••r3" })
      );

    const result = await secrets(["set", "DB_PASSWORD", "--environment", "production"]);

    expect(result.stdout).toContain("✓ Set DB_PASSWORD to hu••••r3 in production, version 2");
    expect(fetchSpy).toHaveBeenLastCalledWith(
      `${API}/sec-1`,
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("reads the value from a file", async () => {
    writeFileSync(join(workspace, "pw.txt"), "from-a-file\n");
    fetchSpy.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok(SECRET, 201));

    await secrets(["set", "DB_PASSWORD", "--from-file", "pw.txt"]);

    expect(bodyOf(1).value).toBe("from-a-file");
  });

  it("takes --value literally, newline and all", async () => {
    fetchSpy.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok(SECRET, 201));

    await secrets(["set", "DB_PASSWORD", "--value", "  spaced  "]);

    expect(bodyOf(1).value).toBe("  spaced  ");
  });

  it("prefers --value over a non-terminal stdin, as a CI runner leaves it", async () => {
    vi.mocked(stdinIsTty).mockReturnValue(false);
    vi.mocked(readStdin).mockReturnValue("");
    fetchSpy.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok(SECRET, 201));

    const result = await secrets(["set", "DB_PASSWORD", "--value", "from-a-flag"]);

    expect(result.code).toBe(0);
    expect(bodyOf(1).value).toBe("from-a-flag");
  });

  it("drops the plaintext from JSON output", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok({ ...SECRET, value: "hunter2", maskedValue: "hu••••r2" }, 201));

    const result = await secrets(["set", "DB_PASSWORD", "--value", "hunter2", "--format", "json"]);

    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("value");
    expect(parsed.maskedValue).toBe("hu••••r2");
    expect(parsed.created).toBe(true);
  });

  it("refuses --value together with --from-file", async () => {
    const result = await secrets(["set", "DB_PASSWORD", "--value", "x", "--from-file", "pw.txt"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Pass --value or --from-file, not both");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses to guess when nothing is piped and no flag is given", async () => {
    const result = await secrets(["set", "DB_PASSWORD"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Pipe the value in");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces the secrets limit", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(fail(402, "PAYMENT_REQUIRED", "Secret limit reached"));

    const result = await secrets(["set", "DB_PASSWORD", "--value", "x"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Secret limit reached (PAYMENT_REQUIRED)");
  });

  it("surfaces a member's missing admin role", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(fail(403, "FORBIDDEN", "Only owners and admins can manage secrets"));

    const result = await secrets(["set", "DB_PASSWORD", "--value", "x"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Only owners and admins can manage secrets");
  });
});

describe("secrets rm", () => {
  it("removes a secret found by name", async () => {
    fetchSpy.mockResolvedValueOnce(ok([SECRET])).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await secrets(["rm", "DB_PASSWORD", "--environment", "production"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("✓ Removed DB_PASSWORD from production");
    expect(fetchSpy).toHaveBeenLastCalledWith(
      `${API}/sec-1`,
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("exits 1 for a name that is not there", async () => {
    fetchSpy.mockResolvedValueOnce(ok([]));

    const result = await secrets(["rm", "DB_PASSWORD", "--environment", "production"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No secret named DB_PASSWORD in production");
  });
});

describe("secrets usage errors", () => {
  it("rejects a missing subcommand", async () => {
    const result = await secrets([]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Name what to do: list, set, rm");
  });

  it("rejects an unknown subcommand", async () => {
    const result = await secrets(["rotate"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown subcommand "cosmoner secrets rotate"');
  });

  it("rejects an unknown environment", async () => {
    const result = await secrets(["list", "--environment", "prod"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--environment must be one of");
  });

  it("names the scope when the key is missing", async () => {
    const result = await secrets(["list"], { COSMONER_PROJECT_ID: "proj-1" });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("set COSMONER_API_KEY to an API key with secrets:read");
  });

  it("names the write scope for a write", async () => {
    const result = await secrets(["set", "DB_PASSWORD", "--value", "x"], {
      COSMONER_PROJECT_ID: "proj-1",
    });

    expect(result.stderr).toContain("set COSMONER_API_KEY to an API key with secrets:write");
  });

  it("rejects a name for rm that was not given", async () => {
    const result = await secrets(["rm"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Name the secret to remove");
  });
});
