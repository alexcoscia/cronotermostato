"""Parity between the server rules and the JavaScript validation.

``tests/frontend/cases.json`` is shared: this module runs it against
``program_from_dict`` and ``tests/frontend/validate.test.mjs`` runs it against
``frontend/lib/validate.js``. Both must give the same outcome ("valid" or the
same error code), so the editor never accepts what the server refuses or the
other way round. ``serialization.json`` holds drafts and the payload the
editor must send; the payload must be accepted by the server.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from custom_components.cronotermostato.engine.models import (
    ProgramError,
    program_from_dict,
)

_DIR = Path(__file__).parent / "frontend"
CASES = json.loads((_DIR / "cases.json").read_text(encoding="utf-8"))
SERIALIZATION = json.loads((_DIR / "serialization.json").read_text(encoding="utf-8"))

# Server message fragment -> error code shared with lib/validate.js.
_CODES = (
    ("Invalid time", "bad_time"),
    ("Band start out of range", "bad_time"),
    ("Band end out of range", "bad_time"),
    ("Band times must be integers", "bad_time"),
    ("Band end must be after start", "end_before_start"),
    ("Overlapping bands", "overlap"),
    ("Unknown mode", "bad_mode"),
    ("needs a temperature or a preset", "missing_setting"),
    ("takes no temperature", "off_with_setting"),
    ("takes no preset", "off_with_setting"),
    ("Temperature must be", "bad_temperature"),
    ("Preset must be", "bad_preset"),
    ("Invalid band", "bad_band"),
    ("'auto' must be", "bad_band"),
    ("Bands must be a list", "bad_band"),
    ("Invalid program", "bad_program"),
    ("Program ", "bad_program"),
    ("A program needs exactly", "bad_program"),
)


def build_program(case: dict[str, Any]) -> dict[str, Any]:
    """Same construction as ``tests/frontend/helpers.mjs``."""
    days = case.get("days", 7)
    week: list[Any] = [[] for _ in range(days)]
    if days > 0:
        week[0] = case.get("day") or []
    for i in range(1, days):
        if f"day{i}" in case:
            week[i] = case[f"day{i}"]
    return {
        "id": "p1",
        "name": case.get("program_name", "Program"),
        "week": week,
        "holiday": case.get("holiday", []),
    }


def outcome(program: dict[str, Any]) -> str:
    try:
        program_from_dict(program)
    except ProgramError as err:
        for fragment, code in _CODES:
            if fragment in str(err):
                return code
        pytest.fail(f"Unmapped server error: {err}")
    return "valid"


def test_cases_are_present_and_cover_both_outcomes() -> None:
    assert len(CASES) > 40
    expected = {c["expect"] for c in CASES}
    assert "valid" in expected
    assert {
        "bad_time", "end_before_start", "overlap", "bad_mode", "missing_setting",
        "off_with_setting", "bad_temperature", "bad_preset", "bad_band", "bad_program",
    } <= expected


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_server_matches_shared_case(case: dict[str, Any]) -> None:
    assert outcome(build_program(case)) == case["expect"]


@pytest.mark.parametrize("case", SERIALIZATION, ids=[c["name"] for c in SERIALIZATION])
def test_editor_payload_is_accepted_by_server(case: dict[str, Any]) -> None:
    payload = {"id": "p1", **case["expected"]}
    program = program_from_dict(payload)
    assert program.name == case["expected"]["name"]
