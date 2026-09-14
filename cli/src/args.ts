/**
 * A small argument parser.
 *
 * Hand-rolled rather than pulled in: this CLI has four commands and a handful
 * of flags between them, and a dependency here would be installed by everyone
 * running `npx @cosmoner/cli validate` in CI.
 */

/** One parsed command line. */
export interface ParsedArgs {
  /** Everything that was not a flag — file paths, mostly. */
  positional: string[];
  flags: Map<string, string | true>;
}

/** Raised for a command line this CLI cannot act on. */
export class UsageError extends Error {}

/**
 * Splits argv into positionals and flags.
 *
 * Accepts `--flag`, `--flag=value` and `--flag value`; `--` stops flag parsing
 * so a path that starts with a dash can still be passed.
 */
export function parseArgs(argv: string[], valueFlags: readonly string[] = []): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  let literal = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (literal || !arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    if (arg === "--") {
      literal = true;
      continue;
    }

    const [name, inline] = splitFlag(arg);
    if (inline !== undefined) {
      flags.set(name, inline);
      continue;
    }
    if (valueFlags.includes(name)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new UsageError(`--${name} needs a value`);
      }
      flags.set(name, value);
      i += 1;
      continue;
    }
    flags.set(name, true);
  }

  return { positional, flags };
}

/** Splits `--name=value` into its parts. `--name` yields an undefined value. */
function splitFlag(arg: string): [string, string | undefined] {
  const body = arg.replace(/^--?/, "");
  const equals = body.indexOf("=");
  return equals === -1
    ? [body, undefined]
    : [body.slice(0, equals), body.slice(equals + 1)];
}

/**
 * Reads a flag that must be one of a fixed set.
 *
 * A misspelled value is a usage error rather than a silent fallback to the
 * default — in CI, silently reporting in the wrong format looks like the check
 * passing.
 */
export function readChoice<T extends string>(
  args: ParsedArgs,
  name: string,
  choices: readonly T[],
  fallback: T
): T {
  const value = args.flags.get(name);
  if (value === undefined) return fallback;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  if (!(choices as readonly string[]).includes(value)) {
    throw new UsageError(`--${name} must be one of: ${choices.join(", ")}`);
  }
  return value as T;
}

/** Rejects any flag the command does not define, so a typo is not ignored. */
export function rejectUnknownFlags(args: ParsedArgs, known: readonly string[]): void {
  for (const name of args.flags.keys()) {
    if (!known.includes(name)) {
      throw new UsageError(`Unknown option --${name}`);
    }
  }
}
