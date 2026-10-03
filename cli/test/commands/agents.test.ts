import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APP_SCHEMA_URL } from "@cosmoner/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMAND_HELP, run } from "../../src/cli";
import { agentsSection, SECTION_END, SECTION_START } from "../../src/commands/agents";

/**
 * Drives `cosmoner agents` and `cosmoner init --agents` through the real entry
 * point in a temporary directory, asserting on the files left behind and the
 * exit code.
 */

let workspace: string;
let out: string[];
let err: string[];

function cli(...argv: string[]): { code: number; stdout: string; stderr: string } {
  const code = run(argv, workspace, false);
  if (typeof code !== "number") throw new Error("offline commands must finish synchronously");
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

function write(path: string, contents: string): void {
  const full = join(workspace, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

function read(path: string): string {
  return readFileSync(join(workspace, path), "utf8");
}

/** The section as `agents` writes it for a project with the default file. */
const SECTION = agentsSection({ deploymentFile: ".cosmoner/deployment.yaml", exists: true });

/** Every inline code span in the text. */
function codeSpans(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "cosmoner-agents-"));
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

describe("agents", () => {
  it("creates AGENTS.md holding only the section", () => {
    write(".cosmoner/deployment.yaml", "services:\n  - name: web\n");

    expect(cli("agents").code).toBe(0);
    expect(read("AGENTS.md")).toBe(`${SECTION}\n`);
  });

  it("appends to a file without markers, keeping what was there", () => {
    write(".cosmoner/deployment.yaml", "services:\n  - name: web\n");
    write("AGENTS.md", "# Project\n\nRun `make test` before committing.");

    expect(cli("agents").code).toBe(0);
    expect(read("AGENTS.md")).toBe(
      `# Project\n\nRun \`make test\` before committing.\n\n${SECTION}\n`
    );
  });

  it("replaces only what is between the markers", () => {
    write(".cosmoner/deployment.yaml", "services:\n  - name: web\n");
    const before = "# Project\n\nOur own notes.\n\n";
    const after = "\n\n## Testing\n\nRun `make test`.\n";
    write("AGENTS.md", `${before}${SECTION_START}\nstale instructions\n${SECTION_END}${after}`);

    expect(cli("agents").code).toBe(0);
    expect(read("AGENTS.md")).toBe(`${before}${SECTION}${after}`);
  });

  it("is idempotent", () => {
    write("AGENTS.md", "# Project\n");
    cli("agents");
    const first = read("AGENTS.md");

    const second = cli("agents");

    expect(second.code).toBe(0);
    expect(second.stdout).toContain("already up to date");
    expect(read("AGENTS.md")).toBe(first);
  });

  it("keeps CRLF line endings in a file that uses them", () => {
    write("AGENTS.md", "# Project\r\n");

    cli("agents");
    expect(read("AGENTS.md")).not.toMatch(/[^\r]\n/);

    out = [];
    expect(cli("agents").stdout).toContain("already up to date");
  });

  it.each([
    ["a lone start marker", `${SECTION_START}\nours\n`],
    ["a lone end marker", `ours\n${SECTION_END}\n`],
    ["markers in the wrong order", `${SECTION_END}\n${SECTION_START}\n`],
    ["two sections", `${SECTION_START}\n${SECTION_END}\n${SECTION_START}\n${SECTION_END}\n`],
  ])("leaves a file with %s alone and exits 1", (_, contents) => {
    write("AGENTS.md", contents);

    const result = cli("agents");

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("left as it was");
    expect(read("AGENTS.md")).toBe(contents);
  });

  it("names the deployment file the platform would read", () => {
    write("deployment.yml", "services:\n  - name: web\n");

    cli("agents");

    expect(read("AGENTS.md")).toContain("`deployment.yml` describes");
  });

  it("points at cosmoner init when there is no deployment file yet", () => {
    cli("agents");

    expect(read("AGENTS.md")).toContain("does not exist yet: `cosmoner init`");
  });

  it("writes to another file when given one", () => {
    expect(cli("agents", "CLAUDE.md").code).toBe(0);
    expect(read("CLAUDE.md")).toContain(SECTION_START);
    expect(existsSync(join(workspace, "AGENTS.md"))).toBe(false);
  });

  it("suggests importing AGENTS.md into CLAUDE.md until it is", () => {
    expect(cli("agents").stdout).toContain("@AGENTS.md");

    write("CLAUDE.md", "@AGENTS.md\n");
    out = [];
    expect(cli("agents").stdout).not.toContain("Claude Code");
  });

  it("exits 2 on an unknown option or a second file", () => {
    expect(cli("agents", "--force").code).toBe(2);
    expect(cli("agents", "a.md", "b.md").code).toBe(2);
    expect(existsSync(join(workspace, "AGENTS.md"))).toBe(false);
  });
});

describe("init --agents", () => {
  it("writes the deployment file and AGENTS.md", () => {
    expect(cli("init", "--agents").code).toBe(0);

    expect(read(".cosmoner/deployment.yaml")).toContain("name: web");
    expect(read("AGENTS.md")).toBe(`${SECTION}\n`);
  });

  it("writes a deployment file that still validates", () => {
    cli("init", "--agents", "--type", "static");

    expect(cli("validate").code).toBe(0);
  });

  it("keeps the user's own AGENTS.md content", () => {
    write("AGENTS.md", "# Project\n\nOur own notes.\n");

    cli("init", "--agents");

    expect(read("AGENTS.md")).toBe(`# Project\n\nOur own notes.\n\n${SECTION}\n`);
  });

  it("passes a deployment file the platform would not find explicitly", () => {
    cli("init", "--agents", join(workspace, "deploy", "app.yaml"));

    expect(read("AGENTS.md")).toContain("`cosmoner validate deploy/app.yaml --strict --format json`");
  });

  it("refuses an existing deployment file and writes nothing, pointing at agents", () => {
    // An existing project: init must not touch its deployment file, and must
    // not write half of what it was asked to either.
    write(".cosmoner/deployment.yaml", "services:\n  - name: api\n");

    const result = cli("init", "--agents");

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cosmoner agents");
    expect(read(".cosmoner/deployment.yaml")).toBe("services:\n  - name: api\n");
    expect(existsSync(join(workspace, "AGENTS.md"))).toBe(false);
  });

  it("leaves an existing project to cosmoner agents, which keeps its file", () => {
    write(".cosmoner/deployment.yaml", "services:\n  - name: api\n");

    expect(cli("agents").code).toBe(0);
    expect(read(".cosmoner/deployment.yaml")).toBe("services:\n  - name: api\n");
    expect(read("AGENTS.md")).toBe(`${SECTION}\n`);
  });

  it("replaces only the section under --force", () => {
    write(".cosmoner/deployment.yaml", "services:\n  - name: api\n");
    write("AGENTS.md", `# Ours\n\n${SECTION_START}\nold\n${SECTION_END}\n`);

    expect(cli("init", "--agents", "--force").code).toBe(0);
    expect(read("AGENTS.md")).toBe(`# Ours\n\n${SECTION}\n`);
  });

  it("writes neither file when AGENTS.md has unbalanced markers", () => {
    write("AGENTS.md", `${SECTION_START}\n`);

    expect(cli("init", "--agents").code).toBe(1);
    expect(existsSync(join(workspace, ".cosmoner", "deployment.yaml"))).toBe(false);
  });

  it("does not write AGENTS.md without the flag", () => {
    cli("init");

    expect(existsSync(join(workspace, "AGENTS.md"))).toBe(false);
  });

  it("exits 2 on a misspelled flag, writing nothing", () => {
    expect(cli("init", "--agent").code).toBe(2);
    expect(existsSync(join(workspace, ".cosmoner", "deployment.yaml"))).toBe(false);
  });
});

describe("the section's content", () => {
  const sections = [
    SECTION,
    agentsSection({ deploymentFile: ".cosmoner/deployment.yaml", exists: false }),
    agentsSection({ deploymentFile: "deploy/app.yaml", exists: true }),
  ];

  it.each(sections)("names only commands and flags the CLI has", (section) => {
    const spans = codeSpans(section);
    let checked = 0;

    for (const span of spans) {
      if (span.startsWith("claude ") || span.startsWith("# ")) continue;

      const invocation = /^(?:cosmoner|npx @cosmoner\/cli)(?: (.*))?$/.exec(span);
      if (invocation) {
        const [command, ...rest] = (invocation[1] ?? "").split(" ");
        if (command === "" || command.startsWith("<")) continue;

        expect(COMMAND_HELP, `unknown command in \`${span}\``).toHaveProperty(command);
        for (const flag of rest.filter((word) => word.startsWith("--"))) {
          expect(COMMAND_HELP[command], `\`${flag}\` is not a ${command} flag`).toContain(flag);
        }
        checked += 1;
        continue;
      }

      // A flag quoted on its own still has to belong to some command.
      if (span.startsWith("--")) {
        const flag = span.split(" ")[0];
        expect(
          Object.values(COMMAND_HELP).some((help) => help.includes(flag)),
          `\`${flag}\` is no command's flag`
        ).toBe(true);
      }
    }

    expect(checked).toBeGreaterThan(5);
  });

  it("mentions every cosmoner command only inside code", () => {
    // Prose like "run cosmoner deplyo" would slip past the check above.
    const prose = SECTION.replaceAll(/`[^`\n]+`/g, "");

    expect(prose).not.toMatch(/\bcosmoner [a-z]/);
  });

  it("carries the schema header the CLI writes", () => {
    expect(SECTION).toContain(`\`# yaml-language-server: $schema=${APP_SCHEMA_URL}\``);
    cli("init");
    expect(read(".cosmoner/deployment.yaml").split("\n")[0]).toBe(
      `# yaml-language-server: $schema=${APP_SCHEMA_URL}`
    );
  });

  it("covers what an agent needs and nothing secret", () => {
    for (const needle of [
      "COSMONER_API_KEY",
      "COSMONER_PROJECT_ID",
      "cosmoner login",
      "write-only",
      "https://cosmoner.com/llms.txt",
      ".md",
      "https://cosmoner.com/docs/mcp",
      "`0`",
      "`1`",
      "`2`",
      "--format json",
    ]) {
      expect(SECTION).toContain(needle);
    }
  });
});
