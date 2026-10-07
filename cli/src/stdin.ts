/**
 * Reading a value piped into the process.
 *
 * Its own module so the tests can replace it: a test drives `run()` in-process,
 * where the real stdin is the test runner's own and reading it would hang.
 */

import { readFileSync } from "node:fs";

/** Reads everything piped in, as text. */
export function readStdin(): string {
  return readFileSync(0, "utf8");
}

/** Whether stdin is a terminal, meaning nothing was piped in. */
export function stdinIsTty(): boolean {
  return process.stdin.isTTY === true;
}

/**
 * Asks a yes/no question on the terminal and resolves true only for "y" or
 * "yes". The question goes to stderr so a `--format json` reply on stdout
 * stays parseable.
 */
export async function askYesNo(question: string): Promise<boolean> {
  const { createInterface } = await import("node:readline/promises");
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await prompt.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}
