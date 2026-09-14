import { describe, expect, it } from "vitest";

import { DEPLOYMENT_FILE_PATHS, MAX_DEPLOYMENT_BYTES } from "./spec";
import { validateDeployment, validateDeploymentDocument } from "./validate";

describe("validateDeployment", () => {
  it("applies the defaults the platform applies", () => {
    const { template } = validateDeployment("services:\n  - name: web\n");

    expect(template).toEqual({
      version: 1,
      services: [{ name: "web", type: "service" }],
    });
  });

  it("drops unknown keys, as the platform does", () => {
    // The warning says the field is ignored; the template has to show it being
    // ignored, or the two halves of the answer disagree.
    const { template, issues } = validateDeployment(
      "services:\n  - name: web\n    replicas: 3\n"
    );

    expect(template?.services[0]).toEqual({ name: "web", type: "service" });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("keeps a file with only warnings valid", () => {
    const { valid, issues } = validateDeployment("services:\n  - name: web\n    prot: 3000\n");

    expect(valid).toBe(true);
    expect(issues[0].severity).toBe("warning");
  });

  it("fails the same file under strict", () => {
    const { valid, issues } = validateDeployment("services:\n  - name: web\n    prot: 3000\n", {
      strict: true,
    });

    expect(valid).toBe(false);
    // strict changes the verdict, not the finding — the field is still only a
    // warning as far as the platform is concerned.
    expect(issues[0].severity).toBe("warning");
  });

  it("still reports what the platform reads under strict", () => {
    const { template } = validateDeployment("services:\n  - name: web\n    prot: 3000\n", {
      strict: true,
    });

    expect(template?.services[0].name).toBe("web");
  });

  it("refuses a file past the size limit without parsing it", () => {
    const padding = "#".repeat(MAX_DEPLOYMENT_BYTES + 1);
    const { valid, issues } = validateDeployment(padding);

    expect(valid).toBe(false);
    expect(issues).toEqual([
      { path: "(root)", message: "File exceeds the 64 KiB limit", severity: "error" },
    ]);
  });

  it("measures the limit in bytes, not characters", () => {
    // A file of multi-byte characters is over the limit well before it is
    // MAX_DEPLOYMENT_BYTES characters long.
    const source = "é".repeat(MAX_DEPLOYMENT_BYTES - 10);

    expect(validateDeployment(source).issues[0].message).toContain("exceeds");
  });

  it("reports the YAML parser's own message for a syntax error", () => {
    const { issues } = validateDeployment("services: [{name: web}\n");

    expect(issues[0].path).toBe("(root)");
    expect(issues[0].message).toMatch(/^Invalid YAML: /);
  });
});

describe("validateDeploymentDocument", () => {
  it("checks a document that never was a file", () => {
    const { valid, issues } = validateDeploymentDocument({
      services: [{ name: "web", type: "static", run_command: "npm start" }],
    });

    expect(valid).toBe(false);
    expect(issues.map((i) => i.path)).toEqual(["services.0.run_command"]);
  });

  it("treats an absent document as an empty file", () => {
    expect(validateDeploymentDocument(null).issues[0].message).toBe("File is empty");
  });
});

describe("DEPLOYMENT_FILE_PATHS", () => {
  it("puts the documented location first", () => {
    // The platform reads the first of these that exists, so the order is part
    // of the contract, not a list of equivalents.
    expect(DEPLOYMENT_FILE_PATHS[0]).toBe(".cosmoner/deployment.yaml");
  });

  it("keeps the superseded location last", () => {
    expect(DEPLOYMENT_FILE_PATHS.at(-1)).toBe(".datablock/app.yml");
  });
});
