"""Parity between the server rules and the JavaScript validation.

``tests/frontend/cases.json`` is shared: this module runs it against
``program_from_dict`` and ``tests/frontend/validate.test.mjs`` runs it against
``frontend/lib/validate.js``. Both must give the same outcome ("valid" or the
same error code, ``ProgramError.code``), so the editor never accepts what the server refuses or the
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


def server_expect(case: dict[str, Any]) -> str:
    """Expected outcome of ``program_from_dict``.

    ``expect`` applies to both sides. A case may declare ``server_expect`` and
    ``client_expect`` instead when the two sides legitimately differ (only the
    automatic bands: the editor ignores them, the model validates them; the
    WebSocket commands discard them before validating).
    """
    if "expect" in case:
        assert "server_expect" not in case and "client_expect" not in case
        return case["expect"]
    return case["server_expect"]


def outcome(program: dict[str, Any]) -> str:
    try:
        program_from_dict(program)
    except ProgramError as err:
        return err.code
    return "valid"


def test_cases_are_present_and_cover_both_outcomes() -> None:
    assert len(CASES) > 40
    assert all(("expect" in c) != ("server_expect" in c) for c in CASES)
    assert all(("server_expect" in c) == ("client_expect" in c) for c in CASES)
    expected = {server_expect(c) for c in CASES}
    assert "valid" in expected
    assert {
        "bad_time", "end_before_start", "overlap", "bad_mode", "missing_setting",
        "off_with_setting", "bad_temperature", "bad_preset", "bad_band", "bad_program",
    } <= expected


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_server_matches_shared_case(case: dict[str, Any]) -> None:
    assert outcome(build_program(case)) == server_expect(case)


@pytest.mark.parametrize("case", SERIALIZATION, ids=[c["name"] for c in SERIALIZATION])
def test_editor_payload_is_accepted_by_server(case: dict[str, Any]) -> None:
    payload = {"id": "p1", **case["expected"]}
    program = program_from_dict(payload)
    assert program.name == case["expected"]["name"]
