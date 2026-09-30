/**
 * Shared machinery for `cosmoner secrets` and `cosmoner variables`.
 *
 * The two commands are the same shape over two API resources that differ in
 * one way that matters: a variable's value can be read back and a secret's
 * cannot. Everything that is not that difference lives here.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CosmonerError, type ProjectEnvironment } from "@cosmoner/sdk";

import { readValue, UsageError, type ParsedArgs } from "../args";
import { readStdin, stdinIsTty } from "../stdin";

export const ENVIRONMENTS: readonly ProjectEnvironment[] = [
  "default",
  "development",
  "staging",
  "production",
];

export const FORMATS = ["text", "json"] as const;
export type EntryFormat = (typeof FORMATS)[number];

export const SUBCOMMANDS = ["list", "set", "rm"] as const;
export type Subcommand = (typeof SUBCOMMANDS)[number];

/** Flags both commands take a separate value for. */
export const ENTRY_VALUE_FLAGS = [
  "environment",
  "description",
  "from-file",
  "value",
  "project",
  "format",
];

/** Flags both commands understand. Anything else is a typo worth refusing. */
export const ENTRY_FLAGS = [...ENTRY_VALUE_FLAGS, "help"];

/** Reads the subcommand, rejecting a missing or unknown one. */
export function readSubcommand(positional: string[], command: string): Subcommand {
  const [sub] = positional;
  if (sub === undefined) {
    throw new UsageError(`Name what to do: ${SUBCOMMANDS.join(", ")}`);
  }
  if (!(SUBCOMMANDS as readonly string[]).includes(sub)) {
    throw new UsageError(`Unknown subcommand "cosmoner ${command} ${sub}"`);
  }
  return sub as Subcommand;
}

/**
 * Reads the environment to work in.
 *
 * Defaults to `default` rather than to "every environment", because `set` and
 * `rm` address one entry by name and a name can exist in several environments
 * at once. Guessing which was meant is worse than always naming one.
 */
export function readEnvironment(args: ParsedArgs): ProjectEnvironment {
  const value = readValue(args, "environment");
  if (value === undefined) return "default";
  if (!(ENVIRONMENTS as readonly string[]).includes(value)) {
    throw new UsageError(`--environment must be one of: ${ENVIRONMENTS.join(", ")}`);
  }
  return value as ProjectEnvironment;
}

/**
 * Reads the value to store, from `--value`, `--from-file`, or whatever is piped in.
 *
 * Stdin is the last resort rather than a competing source: a CI runner often
 * hands a command a non-terminal stdin with nothing behind it, so treating
 * "not a terminal" as "a value was piped" would break `--value` exactly where
 * it is most used.
 *
 * A single trailing newline is stripped from a file or a pipe, because `echo x
 * |` and most editors add one and almost nobody means it. `--value` is taken
 * literally — it was typed out, so it is already exactly what was meant.
 */
export function readEntryValue(args: ParsedArgs, cwd: string): string {
  const inline = readValue(args, "value");
  const file = readValue(args, "from-file");

  if (inline !== undefined && file !== undefined) {
    throw new UsageError("Pass --value or --from-file, not both");
  }
  if (inline !== undefined) return inline;

  if (file !== undefined) {
    const path = resolve(cwd, file);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      throw new UsageError(`Cannot read ${file}`);
    }
    const value = stripOneNewline(text);
    if (!value) throw new UsageError(`${file} is empty`);
    return value;
  }

  if (stdinIsTty()) {
    throw new UsageError("Pipe the value in, or pass --from-file or --value");
  }

  const piped = stripOneNewline(readStdin());
  if (!piped) throw new UsageError("Nothing was piped in");
  return piped;
}

/** Drops one trailing newline, and the carriage return before it. */
function stripOneNewline(text: string): string {
  return text.replace(/\r?\n$/, "");
}

/** Lays out rows under headers, padded into columns. */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i].length))
  );
  const line = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();

  return [line(headers), ...rows.map(line)].join("\n");
}

/** The date part of an ISO timestamp, which is all a listing has room for. */
export function day(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** Turns a failure into the one line a terminal should see. */
export function explain(err: unknown): string {
  if (err instanceof CosmonerError) return `${err.message} (${err.code})`;
  return err instanceof Error ? err.message : String(err);
}
