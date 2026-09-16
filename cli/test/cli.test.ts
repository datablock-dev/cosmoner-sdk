import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../src/cli";

/**
 * Drives the CLI the way a user does — a directory, a command line, an exit
 * code — rather than testing the command functions in isolation. Exit codes are
 * the CLI's contract with CI, so they are what these assert on.
 */

let workspace: string;
let out: string[];
let err: string[];

/** Runs a command line in the temporary workspace, capturing what it printed. */
function cli(...argv: string[]): { code: number; stdout: string; stderr: string } {
  const code = run(argv, workspace, false);
  if (typeof code !== "number") throw new Error("offline commands must finish synchronously");
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

/** Writes a file into the workspace, creating directories as needed. */
function write(path: string, contents: string): string {
  const full = join(workspace, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, contents, "utf8");
  return full;
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "cosmoner-cli-"));
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usage", () => {
  it("prints help with no command", () => {
    expect(cli().stdout).toContain("cosmoner <command>");
  });

  it("exits 2 on an unknown command", () => {
    // 2, not 1: 1 has to keep meaning "a file was checked and did not pass", or
    // a CI job cannot tell a broken deployment file from a typo in its own
    // command line.
    expect(cli("deplyo").code).toBe(2);
  });

  it("exits 2 on an unknown option", () => {
    write("deployment.yaml", "services:\n  - name: web\n");

    expect(cli("validate", "--strick").code).toBe(2);
  });

  it("prints a command's help", () => {
    expect(cli("validate", "--help").stdout).toContain("--strict");
  });
});

describe("validate", () => {
  it("passes a good file", () => {
    write("deployment.yaml", "services:\n  - name: web\n");

    expect(cli("validate").code).toBe(0);
  });

  it("finds the file the platform would read", () => {
    // Both exist; the platform reads the first of its candidate paths, so this
    // has to report on that one and not on the valid one further down the list.
    write(".cosmoner/deployment.yaml", "services:\n  - name: Web Server\n");
    write("deployment.yaml", "services:\n  - name: web\n");

    const result = cli("validate");
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(".cosmoner/deployment.yaml");
  });

  it("fails a bad file", () => {
    write("deployment.yaml", "services:\n  - name: docs\n    type: static\n    run_command: x\n");

    expect(cli("validate").code).toBe(1);
  });

  it("passes a file with only warnings", () => {
    write("deployment.yaml", "services:\n  - name: web\n    prot: 3000\n");

    expect(cli("validate").code).toBe(0);
  });

  it("fails that same file under --strict", () => {
    write("deployment.yaml", "services:\n  - name: web\n    prot: 3000\n");

    expect(cli("validate", "--strict").code).toBe(1);
  });

  it("points at the line the problem is on", () => {
    write("deployment.yaml", "services:\n  - name: web\n    type: static\n    port: 3000\n");

    expect(cli("validate").stdout).toContain("4:11");
  });

  it("checks every file it is given", () => {
    write("a.yaml", "services:\n  - name: web\n");
    write("b.yaml", "services: []\n");

    const result = cli("validate", join(workspace, "a.yaml"), join(workspace, "b.yaml"));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("a.yaml");
    expect(result.stdout).toContain("b.yaml");
  });

  it("reports through the exit code alone under --quiet", () => {
    write("deployment.yaml", "services: []\n");

    const result = cli("validate", "--quiet");
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("emits workflow commands under --format github", () => {
    write("deployment.yaml", "services: []\n");

    expect(cli("validate", "--format", "github").stdout).toMatch(
      /^::error file=.*,line=1,col=\d+::At least one service is required/
    );
  });

  it("emits a parseable document under --format json", () => {
    write("deployment.yaml", "services: []\n");

    const parsed = JSON.parse(cli("validate", "--format=json").stdout) as {
      valid: boolean;
      files: { issues: { severity: string }[] }[];
    };
    expect(parsed.valid).toBe(false);
    expect(parsed.files[0].issues[0].severity).toBe("error");
  });

  it("exits 2 when there is no file to check", () => {
    const result = cli("validate");

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("No deployment file found");
  });

  it("exits 2 when a named file cannot be read", () => {
    const result = cli("validate", join(workspace, "nope.yaml"));

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Could not read");
  });
});

describe("fmt", () => {
  it("rewrites the file in place", () => {
    const path = write("deployment.yaml", "services:\n  - port: 3000\n    name: web\n");

    expect(cli("fmt").code).toBe(0);
    expect(readFileSync(path, "utf8")).toContain("  - name: web\n    port: 3000");
  });

  it("leaves an already formatted file alone", () => {
    const path = write("deployment.yaml", "services:\n  - name: web\n");
    cli("fmt");
    const once = readFileSync(path, "utf8");

    cli("fmt");
    expect(readFileSync(path, "utf8")).toBe(once);
  });

  it("exits 1 under --check when a file would change", () => {
    write("deployment.yaml", "services:\n  - port: 3000\n    name: web\n");

    expect(cli("fmt", "--check").code).toBe(1);
  });

  it("writes nothing under --check", () => {
    const source = "services:\n  - port: 3000\n    name: web\n";
    const path = write("deployment.yaml", source);

    cli("fmt", "--check");
    expect(readFileSync(path, "utf8")).toBe(source);
  });

  it("exits 0 under --check when the file is already formatted", () => {
    write("deployment.yaml", "services:\n  - name: web\n");
    cli("fmt");

    expect(cli("fmt", "--check").code).toBe(0);
  });

  it("refuses --check together with --stdout", () => {
    write("deployment.yaml", "services:\n  - name: web\n");

    expect(cli("fmt", "--check", "--stdout").code).toBe(2);
  });
});

describe("init", () => {
  it("writes a file the platform would read first", () => {
    expect(cli("init").code).toBe(0);
    expect(readFileSync(join(workspace, ".cosmoner", "deployment.yaml"), "utf8")).toContain(
      "name: web"
    );
  });

  it("writes a file that passes validate", () => {
    cli("init");

    expect(cli("validate").code).toBe(0);
  });

  it("writes a static site that passes validate", () => {
    cli("init", "--type", "static");

    expect(cli("validate").code).toBe(0);
  });

  it("takes the service name", () => {
    cli("init", "--name=api");

    expect(readFileSync(join(workspace, ".cosmoner", "deployment.yaml"), "utf8")).toContain(
      "name: api"
    );
  });

  it("refuses a service name the platform would not accept", () => {
    // Caught by validating the file before writing it, not by a second copy of
    // the naming rule living in this command.
    const result = cli("init", "--name=Web Server");

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Service names must be lowercase");
  });

  it("refuses an unknown type", () => {
    expect(cli("init", "--type=worker").code).toBe(2);
  });

  it("refuses to overwrite", () => {
    cli("init");

    expect(cli("init").code).toBe(2);
  });

  it("overwrites under --force", () => {
    cli("init");

    expect(cli("init", "--force", "--name=api").code).toBe(0);
  });
});

describe("schema", () => {
  it("prints the published URL", () => {
    expect(cli("schema", "--url").stdout).toBe("https://cosmoner.com/schemas/app.schema.json");
  });
});
