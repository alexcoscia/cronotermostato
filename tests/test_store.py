"""Tests for the program store."""

from datetime import UTC, datetime, timedelta, timezone

import pytest

from custom_components.cronotermostato.engine.models import (
    Band,
    ProgramError,
)
from custom_components.cronotermostato.store import (
    Assignment,
    CronoStore,
    Override,
)

DAY = (Band(480, 720, "heat", 23.0),)
WEEK = (DAY,) * 5 + ((),) * 2
HOLIDAY = (Band(0, 1440, "heat", 18.0),)
ROOM = "climate.salotto"


async def _store(hass) -> CronoStore:
    store = CronoStore(hass)
    await store.async_load()
    return store


async def test_create_update_delete(hass):
    store = await _store(hass)
    prog = await store.async_create_program("Casa", WEEK, HOLIDAY)
    assert store.programs[prog.id] == prog
    assert prog.name == "Casa"

    new_week = ((Band(60, 120, "cool", 25.0),),) * 7
    upd = await store.async_update_program(prog.id, name="Casa 2", week=new_week)
    assert upd.id == prog.id
    assert upd.name == "Casa 2"
    assert upd.week == new_week
    assert upd.holiday == HOLIDAY  # untouched
    assert store.programs[prog.id] == upd

    await store.async_delete_program(prog.id)
    assert prog.id not in store.programs


async def test_ids_are_stable_and_unique(hass):
    store = await _store(hass)
    a = await store.async_create_program("Casa mia", WEEK, HOLIDAY)
    b = await store.async_create_program("Casa mia", WEEK, HOLIDAY)
    c = await store.async_create_program("!!!", WEEK, HOLIDAY)
    assert a.id == "casa_mia"
    assert b.id == "casa_mia_2"
    assert c.id == "programma"
    # rename does not change id
    upd = await store.async_update_program(a.id, name="Altro")
    assert upd.id == "casa_mia"


async def test_invalid_input_rejected(hass):
    store = await _store(hass)
    with pytest.raises(ProgramError):
        await store.async_create_program("  ", WEEK, HOLIDAY)
    with pytest.raises(ProgramError):
        await store.async_create_program("x", WEEK[:6], HOLIDAY)
    bad = (Band(480, 720, "heat", 23.0), Band(700, 800, "heat", 20.0))
    with pytest.raises(ProgramError):
        await store.async_create_program("x", (bad,) * 7, HOLIDAY)
    with pytest.raises(ProgramError):
        await store.async_update_program("nope", name="x")
    with pytest.raises(ProgramError):
        await store.async_delete_program("nope")
    assert not store.programs


async def test_auto_bands_are_discarded(hass):
    store = await _store(hass)
    auto = Band(0, 480, "off", None, auto=True)
    week = (((auto,) + DAY),) * 7
    prog = await store.async_create_program("Casa", week, (auto,))
    assert prog.week == (DAY,) * 7
    assert prog.holiday == ()
    upd = await store.async_update_program(prog.id, holiday=(auto,) + HOLIDAY)  # auto overlaps: ignored
    assert upd.holiday == HOLIDAY


async def test_delete_assigned_refused(hass):
    store = await _store(hass)
    prog = await store.async_create_program("Casa", WEEK, HOLIDAY)
    await store.async_assign(ROOM, prog.id)
    with pytest.raises(ProgramError):
        await store.async_delete_program(prog.id)
    assert prog.id in store.programs
    await store.async_unassign(ROOM)
    await store.async_delete_program(prog.id)


async def test_assign_unknown_program_raises(hass):
    store = await _store(hass)
    with pytest.raises(ProgramError):
        await store.async_assign(ROOM, "nope")
    assert ROOM not in store.assignments


async def test_assign_pause_and_reassign(hass):
    store = await _store(hass)
    a = await store.async_create_program("A", WEEK, HOLIDAY)
    b = await store.async_create_program("B", WEEK, HOLIDAY)
    await store.async_assign(ROOM, a.id)
    await store.async_set_paused(ROOM, True)
    assert store.assignments[ROOM] == Assignment(a.id, True)
    await store.async_assign(ROOM, b.id)
    assert store.assignments[ROOM].program_id == b.id
    with pytest.raises(ProgramError):
        await store.async_set_paused("climate.altro", True)


async def test_unassign_clears_override(hass):
    store = await _store(hass)
    prog = await store.async_create_program("Casa", WEEK, HOLIDAY)
    await store.async_assign(ROOM, prog.id)
    until = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
    await store.async_set_override(ROOM, Override("heat", 24.0, until))
    assert ROOM in store.overrides
    await store.async_unassign(ROOM)
    assert ROOM not in store.assignments
    assert ROOM not in store.overrides
    await store.async_unassign(ROOM)  # idempotent


async def test_override_requires_assignment_and_aware_until(hass):
    store = await _store(hass)
    prog = await store.async_create_program("Casa", WEEK, HOLIDAY)
    until = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
    with pytest.raises(ProgramError):
        await store.async_set_override(ROOM, Override("heat", 24.0, until))
    await store.async_assign(ROOM, prog.id)
    with pytest.raises(ProgramError):
        await store.async_set_override(
            ROOM, Override("heat", 24.0, datetime(2026, 11, 2, 12, 0))
        )
    with pytest.raises(ProgramError):
        await store.async_set_override(ROOM, Override("heat", None, until))
    await store.async_set_override(ROOM, Override("off", None, until))
    await store.async_clear_override(ROOM)
    assert ROOM not in store.overrides
    await store.async_clear_override(ROOM)  # idempotent


async def test_persist_roundtrip(hass):
    store = await _store(hass)
    prog = await store.async_create_program("Casa", WEEK, HOLIDAY)
    await store.async_assign(ROOM, prog.id)
    await store.async_set_paused(ROOM, True)
    # a non-UTC aware datetime: must come back as the same instant, with tz
    until = datetime(2026, 11, 2, 12, 0, tzinfo=timezone(timedelta(hours=1)))
    await store.async_set_override(ROOM, Override("heat", 24.0, until))

    other = await _store(hass)
    assert other.programs == store.programs
    assert other.assignments == {ROOM: Assignment(prog.id, True)}
    ov = other.overrides[ROOM]
    assert ov.mode == "heat"
    assert ov.temperature == 24.0
    assert ov.until == until
    assert ov.until.tzinfo is not None
    assert ov.until.utcoffset() == timedelta(0)  # stored in UTC


async def test_load_drops_orphans(hass):
    store = await _store(hass)
    prog = await store.async_create_program("Casa", WEEK, HOLIDAY)
    await store.async_assign(ROOM, prog.id)
    store._store._data = None  # noqa: SLF001
    await store._store.async_save(  # noqa: SLF001
        {
            "programs": [],
            "assignments": {ROOM: {"program_id": prog.id, "paused": False}},
            "overrides": {},
        }
    )
    other = await _store(hass)
    assert other.assignments == {}


async def test_listener_called(hass):
    store = await _store(hass)
    calls = []
    remove = store.async_add_listener(lambda: calls.append(1))
    prog = await store.async_create_program("Casa", WEEK, HOLIDAY)
    assert len(calls) == 1
    await store.async_update_program(prog.id, name="X")
    await store.async_assign(ROOM, prog.id)
    await store.async_set_paused(ROOM, True)
    until = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
    await store.async_set_override(ROOM, Override("off", None, until))
    await store.async_clear_override(ROOM)
    await store.async_unassign(ROOM)
    await store.async_delete_program(prog.id)
    assert len(calls) == 8
    remove()
    await store.async_create_program("Y", WEEK, HOLIDAY)
    assert len(calls) == 8
