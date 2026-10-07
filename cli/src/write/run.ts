/**
 * What every write verb shares: a client, one error path, and one way to
 * print a result.
 */

import { CosmonerError, type Cosmoner } from "@cosmoner/sdk";

import { describeApiError } from "../api-error";
import { readChoice, UsageError, type ParsedArgs } from "../args";
import { makeClient } from "../credentials";
import { redact } from "../read/redact";

const FORMATS = ["text", "json"] as const;
export type WriteFormat = (typeof FORMATS)[number];

/** Flags every write verb takes. */
export const WRITE_VALUE_FLAGS = ["project", "format"] as const;

/** Reads `--format`, defaulting to text. */
export function readFormat(args: ParsedArgs): WriteFormat {
  return readChoice<WriteFormat>(args, "format", FORMATS, "text");
}

/**
 * The positional arguments after the verb, exactly `count` of them, named in
 * the usage error when one is missing.
 */
export function operands(args: ParsedArgs, names: readonly string[], usage: string): string[] {
  const given = args.positional.slice(1);
  if (given.length < names.length) throw new UsageError(`Name the ${names[given.length]}: cosmoner ${usage}`);
  if (given.length > names.length) throw new UsageError(`Unexpected argument "${given[names.length]}"`);
  return given;
}

/**
 * Builds the client and runs `body`, turning an API refusal into its message
 * and exit 1. Usage errors pass through, so they still exit 2.
 */
export async function runWrite(
  args: ParsedArgs,
  env: NodeJS.ProcessEnv,
  scope: string,
  body: (client: Cosmoner) => Promise<number>
): Promise<number> {
  const client = await makeClient(args, env, scope);
  try {
    return await body(client);
  } catch (err) {
    if (err instanceof UsageError) throw err;
    console.error(err instanceof CosmonerError ? describeApiError(err) : err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/** Prints a write's result: the API's object as JSON, or a sentence. Credentials are hidden either way. */
export function printResult(format: WriteFormat, data: unknown, text: string): void {
  if (format === "json") console.log(JSON.stringify(redact(data), null, 2));
  else console.log(text);
}
