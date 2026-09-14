import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { APP_SCHEMA_URL, BUILD_FIELDS, ENV_FIELDS, ROOT_FIELDS, SERVICE_FIELDS, type FieldTable } from "./spec";

/**
 * Holds the field table to the platform's published JSON Schema.
 *
 * `schemas/app-schema.json` is a verbatim copy of what the platform serves, and
 * CI checks that the copy is current. This walks it against `spec.ts` so that a
 * field added, retyped, re-bounded or deprecated upstream fails here instead of
 * being discovered by a customer whose valid file this SDK calls invalid.
 *
 * It deliberately says nothing about the cross-field rules in `validate.ts` —
 * JSON Schema cannot express them, which is why they are hand-written. The
 * conformance suite is what pins those.
 */

type Node = Record<string, any>;

const SCHEMA: Node = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../schemas/app-schema.json"),
    "utf8"
  )
);

/** Compares one field table against the schema node that should describe it. */
function expectTableMatches(table: FieldTable, node: Node, where: string): void {
  expect(Object.keys(table).toSorted(), `${where}: field names`).toEqual(
    Object.keys(node.properties).toSorted()
  );

  const required = new Set<string>(node.required ?? []);
  for (const [key, spec] of Object.entries(table)) {
    const field: Node = node.properties[key];
    const at = `${where}.${key}`;

    expect(Boolean(spec.required), `${at}: required`).toBe(required.has(key));
    expect(Boolean(spec.deprecated), `${at}: deprecated`).toBe(field.deprecated === true);
    expect(spec.default, `${at}: default`).toBe(field.default);

    switch (spec.kind) {
      case "string":
        expect(field.type, `${at}: type`).toBe("string");
        expect(spec.minLength, `${at}: minLength`).toBe(field.minLength);
        expect(spec.maxLength, `${at}: maxLength`).toBe(field.maxLength);
        expect(spec.pattern?.source, `${at}: pattern`).toBe(field.pattern);
        expect(spec.enum, `${at}: enum`).toEqual(field.enum);
        break;
      case "integer":
        expect(field.type, `${at}: type`).toBe("integer");
        expect(spec.minimum, `${at}: minimum`).toBe(field.minimum);
        expect(spec.maximum, `${at}: maximum`).toBe(field.maximum);
        break;
      case "boolean":
        expect(field.type, `${at}: type`).toBe("boolean");
        break;
      case "const":
        expect(spec.value, `${at}: const`).toBe(field.const);
        break;
      case "object":
        expect(field.type, `${at}: type`).toBe("object");
        expectTableMatches(spec.fields, field, at);
        break;
      case "array": {
        expect(field.type, `${at}: type`).toBe("array");
        expect(spec.minItems, `${at}: minItems`).toBe(field.minItems);
        expect(spec.maxItems, `${at}: maxItems`).toBe(field.maxItems);
        expect(spec.item.kind, `${at}: item kind`).toBe("object");
        if (spec.item.kind === "object") {
          expectTableMatches(spec.item.fields, field.items, `${at}[]`);
        }
        break;
      }
    }
  }
}

describe("spec matches the published schema", () => {
  it("is the schema this SDK claims to implement", () => {
    expect(SCHEMA.$id).toBe(APP_SCHEMA_URL);
  });

  it("describes the same document", () => {
    expectTableMatches(ROOT_FIELDS, SCHEMA, "root");
  });

  it("reaches the nested tables the walk covers", () => {
    // expectTableMatches recurses, so SERVICE_FIELDS and the two below it are
    // already compared. Naming them here keeps the assertion honest if the
    // document is ever restructured so the walk no longer reaches them.
    expect(Object.keys(SERVICE_FIELDS)).toContain("build");
    expect(Object.keys(SERVICE_FIELDS)).toContain("envs");
    expect(Object.keys(BUILD_FIELDS).length).toBeGreaterThan(0);
    expect(Object.keys(ENV_FIELDS).length).toBeGreaterThan(0);
  });
});
