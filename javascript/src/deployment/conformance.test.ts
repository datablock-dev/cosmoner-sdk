import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateDeployment } from "./validate";

/**
 * Runs the shared fixtures in `conformance/`, which the Python and PHP suites
 * run too. See that directory's README for why the assertions are exact.
 */

const CONFORMANCE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../conformance");

interface ExpectedIssue {
  path: string;
  severity: string;
  message?: string;
  messageStartsWith?: string;
}

interface ConformanceCase {
  name: string;
  valid: boolean;
  issues: ExpectedIssue[];
}

const cases: ConformanceCase[] = JSON.parse(
  readFileSync(join(CONFORMANCE_DIR, "cases.json"), "utf8")
).cases;

describe("deployment conformance", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
    const source = readFileSync(join(CONFORMANCE_DIR, "cases", `${testCase.name}.yaml`), "utf8");
    const result = validateDeployment(source);

    expect(result.issues.map((i) => `${i.severity} ${i.path}`)).toEqual(
      testCase.issues.map((i) => `${i.severity} ${i.path}`)
    );

    result.issues.forEach((issue, index) => {
      const expected = testCase.issues[index];
      if (expected.messageStartsWith !== undefined) {
        expect(issue.message.startsWith(expected.messageStartsWith)).toBe(true);
      } else {
        expect(issue.message).toBe(expected.message);
      }
    });

    expect(result.valid).toBe(testCase.valid);
    // A file the platform cannot read has nothing to hand back.
    expect(result.template === null).toBe(
      testCase.issues.some((i) => i.severity === "error")
    );
  });

  it("has an expectation for every fixture", () => {
    // A fixture nothing lists in cases.json would otherwise sit there unrun,
    // looking like coverage it is not providing.
    const fixtures = readdirSync(join(CONFORMANCE_DIR, "cases"))
      .filter((file) => file.endsWith(".yaml"))
      .map((file) => file.replace(/\.yaml$/, ""))
      .toSorted();

    expect(cases.map((c) => c.name).toSorted()).toEqual(fixtures);
  });
});
