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
