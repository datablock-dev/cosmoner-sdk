"""Runs the shared fixtures in ``conformance/``.

The JavaScript and PHP suites run the same ones.

See that directory's README for why the assertions are exact.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from cosmoner.deployment import validate_deployment

CONFORMANCE_DIR = Path(__file__).resolve().parents[2] / "conformance"

CASES: list[dict[str, Any]] = json.loads(
    (CONFORMANCE_DIR / "cases.json").read_text(encoding="utf-8")
)["cases"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_conformance(case: dict[str, Any]) -> None:
    source = (CONFORMANCE_DIR / "cases" / f"{case['name']}.yaml").read_text(
        encoding="utf-8"
    )
    result = validate_deployment(source)

    assert [f"{i.severity} {i.path}" for i in result.issues] == [
        f"{i['severity']} {i['path']}" for i in case["issues"]
    ]

    for issue, expected in zip(result.issues, case["issues"]):
        if "messageStartsWith" in expected:
            assert issue.message.startswith(expected["messageStartsWith"])
        else:
            assert issue.message == expected["message"]

    assert result.valid is case["valid"]
    # A file the platform cannot read has nothing to hand back.
    assert (result.template is None) is any(
        i["severity"] == "error" for i in case["issues"]
    )


def test_every_fixture_has_an_expectation() -> None:
    # A fixture nothing lists in cases.json would otherwise sit there unrun,
    # looking like coverage it is not providing.
    fixtures = sorted(p.stem for p in (CONFORMANCE_DIR / "cases").glob("*.yaml"))

    assert sorted(case["name"] for case in CASES) == fixtures
