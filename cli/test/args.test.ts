import { describe, expect, it } from "vitest";

import { parseArgs, readChoice, rejectUnknownFlags, UsageError } from "../src/args";

describe("parseArgs", () => {
  it("separates paths from flags", () => {
    const args = parseArgs(["a.yaml", "--strict", "b.yaml"]);

    expect(args.positional).toEqual(["a.yaml", "b.yaml"]);
    expect(args.flags.get("strict")).toBe(true);
  });

  it("reads a value from --flag=value", () => {
    expect(parseArgs(["--format=json"]).flags.get("format")).toBe("json");
  });

  it("reads a value from --flag value when the flag takes one", () => {
    expect(parseArgs(["--format", "json"], ["format"]).flags.get("format")).toBe("json");
  });

  it("does not swallow the next argument for a flag that takes no value", () => {
    // Without the valueFlags list, `--strict a.yaml` would lose the path.
    const args = parseArgs(["--strict", "a.yaml"]);

    expect(args.positional).toEqual(["a.yaml"]);
  });

  it("refuses a value flag with nothing after it", () => {
    expect(() => parseArgs(["--format"], ["format"])).toThrow(UsageError);
  });

  it("refuses to read the next flag as a value", () => {
    expect(() => parseArgs(["--format", "--strict"], ["format"])).toThrow(UsageError);
  });

  it("stops reading flags after --", () => {
    const args = parseArgs(["--", "--weird-name.yaml"]);

    expect(args.positional).toEqual(["--weird-name.yaml"]);
    expect(args.flags.size).toBe(0);
  });
});

describe("readChoice", () => {
  it("falls back when the flag is absent", () => {
    expect(readChoice(parseArgs([]), "format", ["text", "json"], "text")).toBe("text");
  });

  it("refuses a value outside the set", () => {
    // A misspelled format that quietly fell back to text would look, in CI,
    // exactly like the check passing.
    expect(() => readChoice(parseArgs(["--format=jsonn"]), "format", ["text", "json"], "text"))
      .toThrow(/must be one of/);
  });
});

describe("rejectUnknownFlags", () => {
  it("accepts the flags a command defines", () => {
    expect(() => rejectUnknownFlags(parseArgs(["--strict"]), ["strict"])).not.toThrow();
  });

  it("refuses anything else", () => {
    expect(() => rejectUnknownFlags(parseArgs(["--strick"]), ["strict"])).toThrow(
      /Unknown option --strick/
    );
  });
});
