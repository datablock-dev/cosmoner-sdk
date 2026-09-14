/**
 * `cosmoner validate` — check a deployment file without deploying anything.
 */

import { readFileSync } from "node:fs";

import { validateDeployment } from "@cosmoner/sdk";

import { readChoice, rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";
import { resolveTargets } from "../discover";
import { PositionIndex } from "../positions";
import {
  render,
  REPORT_FORMATS,
  type FileReport,
  type LocatedIssue,
  type ReportFormat,
} from "../report";

export const VALIDATE_HELP = `cosmoner validate [file...]

Checks a .cosmoner/deployment.yaml against the format the platform reads. With
no file, the one the platform would read is found the way the platform finds it.

Options
  --strict            Fail on warnings too — for a CI job that should not let a
                      misspelled key reach a deploy.
  --format <format>   text (default), json, or github for workflow annotations.
  --quiet             Print nothing; report through the exit code alone.
  --no-color          Never colourise. Colour is off by default when not a TTY.

Exit code is 0 when every file passes and 1 when any of them does not.`;

/** Flags this command understands. Anything else is a typo worth refusing. */
const FLAGS = ["strict", "format", "quiet", "no-color", "color", "help"];

export function runValidate(args: ParsedArgs, cwd: string, isTty: boolean): number {
  rejectUnknownFlags(args, FLAGS);

  const strict = args.flags.get("strict") === true;
  const quiet = args.flags.get("quiet") === true;
  const format = readChoice<ReportFormat>(args, "format", REPORT_FORMATS, "text");
  // Workflow commands are parsed by the runner, so colour would corrupt them.
  const color = format === "text" && useColor(args, isTty);

  const reports: FileReport[] = resolveTargets(args.positional, cwd).map((path) => {
    const source = read(path);
    const result = validateDeployment(source, { strict });
    const positions = new PositionIndex(source);

    return {
      path,
      valid: result.valid,
      issues: byPosition(
        result.issues.map((issue) => ({ ...issue, position: positions.find(issue.path) }))
      ),
    };
  });

  if (!quiet) {
    const output = render(reports, format, color);
    if (output !== "") console.log(output);
  }

  return reports.every((report) => report.valid) ? 0 : 1;
}

/**
 * Orders findings by where they are in the file.
 *
 * The SDK reports in a fixed order — unknown keys before known fields, rules
 * spanning several fields after both — which is what lets three languages agree
 * on it, but it is not the order someone reads a file in. Sorting here changes
 * nothing about the verdict; it just puts the first problem at the top.
 *
 * Stable, so findings that share a position keep the order the SDK gave them,
 * and findings with no position at all keep theirs.
 */
function byPosition(issues: LocatedIssue[]): LocatedIssue[] {
  return issues
    .map((issue, index) => ({ issue, index }))
    .toSorted((a, b) => {
      const left = a.issue.position;
      const right = b.issue.position;
      if (!left || !right) return a.index - b.index;
      return left.line - right.line || left.column - right.column || a.index - b.index;
    })
    .map((entry) => entry.issue);
}

/**
 * Colour follows the terminal unless asked otherwise, and NO_COLOR is honoured
 * because a CLI that ignores it is one more thing to configure per CI provider.
 */
function useColor(args: ParsedArgs, isTty: boolean): boolean {
  if (args.flags.get("no-color") === true || args.flags.get("color") === "false") return false;
  if (args.flags.get("color") === true || args.flags.get("color") === "always") return true;
  return isTty && !process.env.NO_COLOR;
}

/** Reads a file, turning the unreadable ones into a message rather than a stack. */
export function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new UsageError(`Could not read ${path}: ${reason}`);
  }
}
