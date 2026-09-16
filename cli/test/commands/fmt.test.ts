import { describe, expect, it } from "vitest";

import { UsageError } from "../../src/args";
import { formatDeployment } from "../../src/commands/fmt";

describe("formatDeployment", () => {
  it("puts fields in the order the format documents them", () => {
    const formatted = formatDeployment("region: ams\nversion: 1\nservices:\n  - name: web\n");

    expect(formatted).toContain("version: 1\nregion: ams\nservices:");
  });

  it("orders the fields of a service, its build and its variables", () => {
    const formatted = formatDeployment(
      [
        "services:",
        "  - run_command: npm start",
        "    name: web",
        "    build:",
        "      output_dir: dist",
        "      command: npm run build",
        "    envs:",
        "      - value: production",
        "        key: NODE_ENV",
        "",
      ].join("\n")
    );

    expect(formatted).toContain("  - name: web\n");
    expect(formatted).toContain("      command: npm run build\n      output_dir: dist");
    expect(formatted).toContain("      - key: NODE_ENV\n        value: production");
  });

  it("keeps comments with the field they were written against", () => {
    const formatted = formatDeployment(
      "services:\n  - name: web\n    # why this port\n    port: 3000\n"
    );

    expect(formatted).toContain("# why this port\n    port: 3000");
  });

  it("keeps unknown fields, at the end of their mapping", () => {
    // The platform ignores them rather than rejecting them, so deleting one is
    // not a formatter's decision to make.
    const formatted = formatDeployment("services:\n  - replicas: 3\n    name: web\n");

    expect(formatted).toContain("  - name: web\n    replicas: 3");
  });

  it("keeps unknown fields in the order they were written", () => {
    const formatted = formatDeployment("services:\n  - zeta: 1\n    alpha: 2\n    name: web\n");

    expect(formatted).toContain("zeta: 1\n    alpha: 2");
  });

  it("adds the schema header", () => {
    expect(formatDeployment("services:\n  - name: web\n")).toMatch(
      /^# yaml-language-server: \$schema=https:\/\/cosmoner\.com\//
    );
  });

  it("does not add a second way of saying it", () => {
    const source = "$schema: https://cosmoner.com/schemas/app.schema.json\nservices:\n  - name: web\n";

    expect(formatDeployment(source)).not.toContain("yaml-language-server");
  });

  it("leaves an existing header alone", () => {
    const source = "# yaml-language-server: $schema=https://example.test/x.json\nservices:\n  - name: web\n";

    expect(formatDeployment(source).match(/yaml-language-server/g)).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = formatDeployment("region: ams\nservices:\n  - port: 3000\n    name: web\n");

    expect(formatDeployment(once)).toBe(once);
  });

  it("does not fold a long command onto several lines", () => {
    const command = `npm run build -- ${"--flag ".repeat(30)}`.trim();
    const formatted = formatDeployment(
      `services:\n  - name: web\n    build:\n      command: ${command}\n`
    );

    expect(formatted).toContain(`command: ${command}`);
  });

  it("refuses a file it could not parse", () => {
    // Reordering what we could not read would be a guess at what the author
    // meant, and writing that guess back over their file is worse than failing.
    expect(() => formatDeployment("services: [{name: web}\n")).toThrow(UsageError);
  });
});
