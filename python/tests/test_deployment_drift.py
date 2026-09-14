"""Holds the field table to the platform's published JSON Schema.

``schemas/app-schema.json`` is a verbatim copy of what the platform serves, and
CI checks that the copy is current. This walks it against the table in
``cosmoner.deployment`` so that a field added, retyped, re-bounded or deprecated
upstream fails here instead of being discovered by a customer whose valid file
this SDK calls invalid.

It deliberately says nothing about the cross-field rules — JSON Schema cannot
express them, which is why they are hand-written. The conformance suite pins
those.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from cosmoner.deployment import (
    APP_SCHEMA_URL,
    BUILD_FIELDS,
    ENV_FIELDS,
    ROOT_FIELDS,
    SERVICE_FIELDS,
    _Field,
)

SCHEMA: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[2] / "schemas" / "app-schema.json").read_text(
        encoding="utf-8"
    )
)


def assert_table_matches(
    table: dict[str, _Field], node: dict[str, Any], where: str
) -> None:
    """Compares one field table against the schema node that should describe it."""
    assert sorted(table) == sorted(node["properties"]), f"{where}: field names"

    required = set(node.get("required", []))
    for key, spec in table.items():
        field = node["properties"][key]
        at = f"{where}.{key}"

        assert spec.required is (key in required), f"{at}: required"
        assert spec.deprecated is (field.get("deprecated") is True), f"{at}: deprecated"
        assert spec.default == field.get("default"), f"{at}: default"

        if spec.kind == "string":
            assert field["type"] == "string", f"{at}: type"
            assert spec.min_length == field.get("minLength"), f"{at}: minLength"
            assert spec.max_length == field.get("maxLength"), f"{at}: maxLength"
            assert spec.pattern == field.get("pattern"), f"{at}: pattern"
            expected_enum = field.get("enum")
            actual_enum = list(spec.choices) if spec.choices is not None else None
            assert actual_enum == expected_enum, f"{at}: enum"
        elif spec.kind == "integer":
            assert field["type"] == "integer", f"{at}: type"
            assert spec.minimum == field.get("minimum"), f"{at}: minimum"
            assert spec.maximum == field.get("maximum"), f"{at}: maximum"
        elif spec.kind == "boolean":
            assert field["type"] == "boolean", f"{at}: type"
        elif spec.kind == "const":
            assert spec.value == field.get("const"), f"{at}: const"
        elif spec.kind == "object":
            assert field["type"] == "object", f"{at}: type"
            assert spec.fields is not None
            assert_table_matches(spec.fields, field, at)
        elif spec.kind == "array":
            assert field["type"] == "array", f"{at}: type"
            assert spec.min_items == field.get("minItems"), f"{at}: minItems"
            assert spec.max_items == field.get("maxItems"), f"{at}: maxItems"
            assert spec.item is not None and spec.item.fields is not None
            assert_table_matches(spec.item.fields, field["items"], f"{at}[]")
        else:
            raise AssertionError(f"{at}: unknown kind {spec.kind!r}")


def test_is_the_schema_this_sdk_claims_to_implement() -> None:
    assert SCHEMA["$id"] == APP_SCHEMA_URL


def test_describes_the_same_document() -> None:
    assert_table_matches(ROOT_FIELDS, SCHEMA, "root")


def test_walk_reaches_the_nested_tables() -> None:
    # assert_table_matches recurses, so the tables below the root are already
    # compared. Naming them keeps the assertion honest if the document is ever
    # restructured so the walk no longer reaches them.
    assert "build" in SERVICE_FIELDS
    assert "envs" in SERVICE_FIELDS
    assert BUILD_FIELDS and ENV_FIELDS
