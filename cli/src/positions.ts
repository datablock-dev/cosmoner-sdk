/**
 * Mapping a finding's path back to a line and column in the file.
 *
 * The SDK's validator reports paths, not positions — it has to, because it also
 * validates documents that were never text. The CLI is the one place a file
 * definitely exists, and a CI annotation is worth much more when it lands on
 * the offending line, so the source is parsed a second time here purely to
 * index positions.
 *
 * Deliberately best-effort. The SDK stays the authority on what is wrong;
 * nothing in this file can change a verdict, only decorate one.
 */

import { LineCounter, parseDocument, type Document } from "yaml";

/** A one-based position in the file. */
export interface Position {
  line: number;
  column: number;
}

/** Looks up where each reported path sits in the source. */
export class PositionIndex {
  private readonly doc: Document | null;
  private readonly lineCounter: LineCounter;

  constructor(source: string) {
    this.lineCounter = new LineCounter();
    let doc: Document | null = null;
    try {
      doc = parseDocument(source, { lineCounter: this.lineCounter });
    } catch {
      // A file too broken to parse still gets reported, just without positions.
      doc = null;
    }
    this.doc = doc;
  }

  /**
   * Returns where a reported path sits.
   *
   * A "Required" finding names a key that is not in the file, so there is
   * nothing to point at; the walk falls back to the nearest ancestor that does
   * exist, which puts the annotation on the mapping that is missing the key.
   */
  public find(path: string): Position | undefined {
    if (this.doc === null) return undefined;
    if (path === "(root)") return { line: 1, column: 1 };

    const parts: (string | number)[] = path
      .split(".")
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part));

    for (let length = parts.length; length > 0; length -= 1) {
      const position = this.positionOf(parts.slice(0, length));
      if (position) return position;
    }
    return { line: 1, column: 1 };
  }

  /** Resolves one exact path to a position, if the node is there and located. */
  private positionOf(parts: (string | number)[]): Position | undefined {
    let node: unknown;
    try {
      node = this.doc?.getIn(parts, true);
    } catch {
      return undefined;
    }

    const range = (node as { range?: [number, number, number] } | undefined)?.range;
    if (!range) return undefined;

    const { line, col } = this.lineCounter.linePos(range[0]);
    return { line, column: col };
  }
}
