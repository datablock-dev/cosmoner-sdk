/**
 * The one gate in front of every change that costs money or cannot be undone.
 *
 * In a terminal the command says what it will do and asks. `--yes` answers in
 * advance, for scripts. With no terminal and no `--yes` — CI, or an agent's
 * shell — nobody can answer, so the command describes the change, refuses,
 * and exits 2 rather than waiting on input that will never come or going
 * ahead unasked.
 */

import type { ParsedArgs } from "../args";
import { askYesNo, stdinIsTty } from "../stdin";

/** The outcome of asking: go ahead, the person said no, or nobody could be asked. */
export type Confirmation = "confirmed" | "declined" | "unattended";

/**
 * Shows `summary` and asks `question`, unless `--yes` already answered it.
 *
 * Everything goes to stderr, so stdout carries only the command's result.
 */
export async function confirm(args: ParsedArgs, summary: string, question: string): Promise<Confirmation> {
  if (args.flags.get("yes") === true) return "confirmed";
  console.error(summary);
  if (!stdinIsTty()) return "unattended";
  return (await askYesNo(question)) ? "confirmed" : "declined";
}

/**
 * The exit code for a confirmation that did not go ahead, after saying why;
 * null when it did.
 */
export function refusal(outcome: Confirmation): number | null {
  if (outcome === "confirmed") return null;
  if (outcome === "declined") {
    console.error("Cancelled. Nothing was changed.");
    return 1;
  }
  console.error("Nothing was changed. Rerun with --yes to confirm.");
  return 2;
}
