/**
 * Rendering findings, in the three shapes a caller might want them.
 */

import type { DeploymentIssue } from "@cosmoner/sdk";

import type { Position } from "./positions";

/** One finding, with the position the CLI managed to give it. */
export type LocatedIssue = DeploymentIssue & { position?: Position };

/** One file's findings, ready to print. */
export interface FileReport {
  path: string;
  valid: boolean;
  issues: LocatedIssue[];
}

/** How findings are rendered. */
export type ReportFormat = "text" | "json" | "github";

export const REPORT_FORMATS = ["text", "json", "github"] as const;

// Written as escapes rather than literal control characters so the file stays
// safe to grep, diff and paste through tooling that strips them.
const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";
const GREEN = "\u001b[32m";
const BOLD = "\u001b[1m";

/** Renders the reports. Returns the text to print, without a trailing newline. */
export function render(reports: FileReport[], format: ReportFormat, color: boolean): string {
  switch (format) {
    case "json":
      return renderJson(reports);
    case "github":
      return renderGitHub(reports);
    case "text":
      return renderText(reports, color);
  }
}

/**
 * eslint's layout, because it is the one a reader of CI logs already knows: the
 * file on its own line, then each finding indented under it.
 */
function renderText(reports: FileReport[], color: boolean): string {
  const paint = (text: string, code: string): string => (color ? `${code}${text}${RESET}` : text);

  const lines: string[] = [];
  let errors = 0;
  let warnings = 0;

  for (const report of reports) {
    if (report.issues.length === 0) {
      lines.push(`${paint("✓", GREEN)} ${report.path}`);
      continue;
    }

    lines.push(paint(report.path, BOLD));
    const width = Math.max(...report.issues.map((issue) => locationOf(issue).length));

    for (const issue of report.issues) {
      if (issue.severity === "error") errors += 1;
      else warnings += 1;

      const severity =
        issue.severity === "error" ? paint("error  ", RED) : paint("warning", YELLOW);

      lines.push(
        `  ${paint(locationOf(issue).padEnd(width), DIM)}  ${severity}  ` +
          `${issue.message}  ${paint(issue.path, DIM)}`
      );
    }
    lines.push("");
  }

  if (errors > 0 || warnings > 0) {
    lines.push(
      paint(`${count(errors, "error")}, ${count(warnings, "warning")}`, errors > 0 ? RED : YELLOW)
    );
  }
  return lines.join("\n");
}

/** `12:5` when the finding could be placed, blank when it could not. */
function locationOf(issue: LocatedIssue): string {
  return issue.position ? `${issue.position.line}:${issue.position.column}` : "";
}

/** Pluralises a count for the summary line. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The whole run as one object, for a script that wants to act on it. */
function renderJson(reports: FileReport[]): string {
  return JSON.stringify(
    {
      valid: reports.every((report) => report.valid),
      files: reports.map((report) => ({
        path: report.path,
        valid: report.valid,
        issues: report.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
          severity: issue.severity,
          line: issue.position?.line ?? null,
          column: issue.position?.column ?? null,
        })),
      })),
    },
    null,
    2
  );
}

/**
 * Workflow commands, so findings appear on the diff in a pull request rather
 * than only in the log.
 *
 * Newlines are percent-encoded because a workflow command is one line; a raw
 * newline would truncate the message at the first one.
 */
function renderGitHub(reports: FileReport[]): string {
  return reports
    .flatMap((report) =>
      report.issues.map((issue) => {
        const position = issue.position
          ? `,line=${issue.position.line},col=${issue.position.column}`
          : "";
        const message = `${issue.message} (${issue.path})`
          .replaceAll("%", "%25")
          .replaceAll("\r", "%0D")
          .replaceAll("\n", "%0A");
        return `::${issue.severity} file=${report.path}${position}::${message}`;
      })
    )
    .join("\n");
}
