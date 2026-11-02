"""Tests for the room and program entities."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from homeassistant.const import STATE_OFF, STATE_ON
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.cronotermostato.const import CONF_COUNTRY, CONF_SUBDIV, DOMAIN
from custom_components.cronotermostato.engine.models import Band
from custom_components.cronotermostato.sensor import (
    ProgramSensor,
    RoomProgramSensor,
)

TZ = ZoneInfo("Europe/Rome")
ROOM = "climate.salotto"
SENSOR = "sensor.salotto_programma"
SWITCH = "switch.salotto_automatico"
PROGRAM_SENSOR = "sensor.programma_casa"
DAY = (Band(480, 720, "heat", 23.0), Band(1080, 1380, "heat", 20.0))
WEEK = (DAY,) * 7
HOLIDAY = (Band(0, 1440, "heat", 18.0),)


def at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, day, hour, minute, tzinfo=TZ)


@pytest.fixture
async def env(hass, freezer):
    await hass.config.async_set_time_zone("Europe/Rome")
    freezer.move_to(at(26, 9))  # Monday
    calls = []

    async def _handle(call):
        key = {
            "set_hvac_mode": "hvac_mode",
            "set_preset_mode": "preset_mode",
            "set_temperature": "temperature",
        }[call.service]
        calls.append((call.data["entity_id"], call.service, call.data[key]))

    for name in ("set_hvac_mode", "set_preset_mode", "set_temperature"):
        hass.services.async_register("climate", name, _handle)
    hass.states.async_set(
        ROOM, "heat", {"hvac_modes": ["heat", "off"], "preset_modes": ["home", "eco"]}
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_COUNTRY: "IT", CONF_SUBDIV: None},
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    store = entry.runtime_data.store
    program = await store.async_create_program("Casa", WEEK, HOLIDAY)
    await hass.async_block_till_done()

    class Env:
        pass

    e = Env()
    e.hass, e.freezer, e.entry, e.store, e.program, e.calls = (
        hass, freezer, entry, store, program, calls
    )

    async def go(when):
        freezer.move_to(when)
        async_fire_time_changed(hass, when)
        await hass.async_block_till_done()

    e.go = go
    yield e
    await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()


async def test_rooms_appear_and_disappear(env):
    hass = env.hass
    assert hass.states.get(SENSOR) is None
    assert hass.states.get(SWITCH) is None
    assert hass.states.get(PROGRAM_SENSOR) is not None

    await env.store.async_assign(ROOM, env.program.id)
    await hass.async_block_till_done()
    assert hass.states.get(SENSOR).state == "Casa"
    assert hass.states.get(SWITCH).state == STATE_ON
    registry = er.async_get(hass)
    assert registry.async_get(SENSOR).unique_id == f"{ROOM}_program"
    assert registry.async_get(SWITCH).unique_id == f"{ROOM}_auto"
    assert hass.states.get(PROGRAM_SENSOR).attributes["rooms"] == [ROOM]
    assert dr.async_get(hass).async_get_device_by_identifier(
        (DOMAIN, ROOM), env.entry.entry_id
    ) is not None

    await env.store.async_unassign(ROOM)
    await hass.async_block_till_done()
    assert hass.states.get(SENSOR) is None
    assert hass.states.get(SWITCH) is None
    assert registry.async_get(SENSOR) is None
    assert registry.async_get(SWITCH) is None
    assert dr.async_get(hass).async_get_device_by_identifier(
        (DOMAIN, ROOM), env.entry.entry_id
    ) is None
    assert hass.states.get(PROGRAM_SENSOR).attributes["rooms"] == []

    await env.store.async_assign(ROOM, env.program.id)  # comes back
    await hass.async_block_till_done()
    assert hass.states.get(SENSOR).state == "Casa"


async def test_program_sensor_removed_and_recreated(env):
    hass = env.hass
    registry = er.async_get(hass)
    assert registry.async_get(PROGRAM_SENSOR) is not None
    await env.store.async_delete_program(env.program.id)
    await hass.async_block_till_done()
    assert hass.states.get(PROGRAM_SENSOR) is None
    assert registry.async_get(PROGRAM_SENSOR) is None

    # the store reuses the id of a deleted program
    await env.store.async_create_program("Casa", WEEK, HOLIDAY)
    await hass.async_block_till_done()
    assert hass.states.get(PROGRAM_SENSOR) is not None


async def test_room_attributes_at_start(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["slot"]["mode"] == "heat"
    assert attrs["slot"]["temperature"] == 23.0
    assert attrs["next_slot"]["auto"] is True
    assert attrs["manual"] is False
    assert attrs["override_until"] is None
    assert attrs["auto_slot"] is False
    assert attrs["holiday"] is False
    assert attrs["status"] == "ok"
    assert datetime.fromisoformat(attrs["slot_end"]) == at(26, 12)


async def test_attributes_after_boundary(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    await env.go(at(26, 12))
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["auto_slot"] is True
    assert attrs["slot"]["mode"] == "off"
    assert attrs["slot"]["temperature"] is None
    assert datetime.fromisoformat(attrs["slot_end"]) == at(26, 18)
    assert attrs["next_slot"]["mode"] == "heat"
    assert attrs["next_slot"]["temperature"] == 20.0
    assert datetime.fromisoformat(attrs["next_slot"]["start"]) == at(26, 18)


async def test_switch_off_sets_manual(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    env.calls.clear()
    await env.hass.services.async_call(
        "switch", "turn_off", {"entity_id": SWITCH}, blocking=True
    )
    await env.hass.async_block_till_done()
    override = env.store.overrides[ROOM]
    assert (override.mode, override.temperature) == ("heat", 23.0)
    assert override.until == at(26, 12)
    assert env.hass.states.get(SWITCH).state == STATE_OFF
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["manual"] is True
    assert datetime.fromisoformat(attrs["override_until"]) == at(26, 12)


async def test_switch_off_in_off_slot_has_no_temperature(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    await env.go(at(26, 13))
    await env.hass.services.async_call(
        "switch", "turn_off", {"entity_id": SWITCH}, blocking=True
    )
    override = env.store.overrides[ROOM]
    assert (override.mode, override.temperature) == ("off", None)


async def test_switch_on_resumes(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    await env.hass.services.async_call(
        "switch", "turn_off", {"entity_id": SWITCH}, blocking=True
    )
    await env.hass.async_block_till_done()
    assert ROOM in env.store.overrides
    await env.hass.services.async_call(
        "switch", "turn_on", {"entity_id": SWITCH}, blocking=True
    )
    await env.hass.async_block_till_done()
    assert ROOM not in env.store.overrides
    assert env.hass.states.get(SWITCH).state == STATE_ON
    assert env.hass.states.get(SENSOR).attributes["manual"] is False


async def test_program_sensor_has_auto_bands(env):
    state = env.hass.states.get(PROGRAM_SENSOR)
    day = state.attributes["week_full"][0]
    assert [(b["start"], b["end"], b["mode"], b["auto"]) for b in day] == [
        ("00:00", "08:00", "off", True),
        ("08:00", "12:00", "heat", False),
        ("12:00", "18:00", "off", True),
        ("18:00", "23:00", "heat", False),
        ("23:00", "24:00", "off", True),
    ]
    assert len(state.attributes["week"][0]) == 2  # only the user's bands
    assert state.attributes["holiday"][0]["end"] == "24:00"
    assert len(state.attributes["holiday_full"]) == 1
    assert state.attributes["rooms"] == []


async def test_program_sensor_follows_changes(env):
    await env.store.async_update_program(env.program.id, holiday=[])
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(PROGRAM_SENSOR).attributes
    assert attrs["holiday"] == []
    assert attrs["holiday_full"][0]["auto"] is True


async def test_program_sensor_name_follows_rename(env):
    hass = env.hass
    registry = er.async_get(hass)
    assert hass.states.get(PROGRAM_SENSOR).attributes["friendly_name"] == "Program Casa"
    await env.store.async_update_program(env.program.id, name="Altro")
    await hass.async_block_till_done()
    state = hass.states.get(PROGRAM_SENSOR)
    assert state.attributes["friendly_name"] == "Program Altro"
    assert registry.async_get(PROGRAM_SENSOR).original_name == "Program Altro"
    assert hass.states.get("sensor.programma_altro") is None


async def test_room_sensor_state_follows_program_rename(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    assert env.hass.states.get(SENSOR).state == "Casa"
    await env.store.async_update_program(env.program.id, name="Altro")
    await env.hass.async_block_till_done()
    assert env.hass.states.get(SENSOR).state == "Altro"


async def test_room_name_from_registry_when_state_missing(hass):
    from custom_components.cronotermostato.entity import room_name

    registry = er.async_get(hass)
    registry.async_get_or_create(
        "climate", "test", "u1", suggested_object_id="termostato_bagno",
        original_name="Bagno",
    )
    assert hass.states.get("climate.termostato_bagno") is None
    assert room_name(hass, "climate.termostato_bagno") == "Bagno"
    registry.async_update_entity("climate.termostato_bagno", name="Bagno grande")
    assert room_name(hass, "climate.termostato_bagno") == "Bagno grande"


async def test_room_name_from_state_then_object_id(hass):
    from custom_components.cronotermostato.entity import room_name

    hass.states.async_set("climate.cucina", "heat", {"friendly_name": "Cucina X"})
    assert room_name(hass, "climate.cucina") == "Cucina X"
    assert room_name(hass, "climate.sala_da_pranzo") == "sala da pranzo"


async def test_unrecorded():
    for cls in (ProgramSensor, RoomProgramSensor):
        assert isinstance(cls._unrecorded_attributes, frozenset)
    assert {"week", "holiday", "week_full", "holiday_full"} <= (
        ProgramSensor._unrecorded_attributes
    )
    assert {"slot", "next_slot"} <= RoomProgramSensor._unrecorded_attributes


async def test_platform_failure_stops_manager(hass):
    from unittest.mock import patch

    from custom_components.cronotermostato.manager import Manager

    entry = MockConfigEntry(
        domain=DOMAIN, data={CONF_COUNTRY: "IT", CONF_SUBDIV: None}, unique_id=DOMAIN
    )
    entry.add_to_hass(hass)
    stopped = []
    real_stop = Manager.async_stop

    async def _stop(self):
        stopped.append(self)
        await real_stop(self)

    with (
        patch.object(
            hass.config_entries,
            "async_forward_entry_setups",
            side_effect=RuntimeError("boom"),
        ),
        patch.object(Manager, "async_stop", _stop),
    ):
        assert not await hass.config_entries.async_setup(entry.entry_id)
    assert len(stopped) == 1


async def test_switch_off_out_of_climate_range_raises(env):
    env.hass.states.async_set(
        ROOM, "heat", {"hvac_modes": ["heat", "off"], "min_temp": 15, "max_temp": 22}
    )
    await env.store.async_assign(ROOM, env.program.id)  # slot is 23
    await env.hass.async_block_till_done()
    assert env.hass.states.get(SENSOR).attributes["status"] == "out_of_range"
    env.calls.clear()
    with pytest.raises(ServiceValidationError) as err:
        await env.hass.services.async_call(
            "switch", "turn_off", {"entity_id": SWITCH}, blocking=True
        )
    assert err.value.translation_key == "temperature_out_of_range"
    assert env.store.overrides == {}
    assert env.calls == []
    assert env.hass.states.get(SWITCH).state == STATE_ON


# -- preset -----------------------------------------------------------------


async def test_room_sensor_attributes_include_preset(env):
    day = (Band(480, 720, "heat", None, preset="home"),)
    prog = await env.store.async_create_program("Preset", (day,) * 7, ())
    await env.store.async_assign(ROOM, prog.id)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["slot"]["preset"] == "home"
    assert attrs["slot"]["temperature"] is None
    assert attrs["next_slot"]["preset"] is None
    assert attrs["status"] == "ok"
    assert env.calls == [(ROOM, "set_hvac_mode", "heat"), (ROOM, "set_preset_mode", "home")]


async def test_program_sensor_attributes_include_preset(env):
    day = (Band(480, 720, "heat", 21.0, preset="eco"),)
    await env.store.async_update_program(env.program.id, week=(day,) * 7)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(PROGRAM_SENSOR).attributes
    assert attrs["week"][0][0]["preset"] == "eco"
    assert attrs["week_full"][0][0]["preset"] is None
    assert attrs["week_full"][0][1]["preset"] == "eco"


async def test_room_sensor_shows_unsupported_preset(env):
    day = (Band(480, 720, "heat", None, preset="boost"),)
    prog = await env.store.async_create_program("Boost", (day,) * 7, ())
    await env.store.async_assign(ROOM, prog.id)
    await env.hass.async_block_till_done()
    assert env.hass.states.get(SENSOR).attributes["status"] == "unsupported_preset"
    assert env.calls == []


async def test_switch_off_keeps_preset_of_slot(env):
    day = (Band(480, 720, "heat", 21.0, preset="home"),)
    prog = await env.store.async_create_program("Preset", (day,) * 7, ())
    await env.store.async_assign(ROOM, prog.id)
    await env.hass.async_block_till_done()
    env.calls.clear()
    await env.hass.services.async_call(
        "switch", "turn_off", {"entity_id": SWITCH}, blocking=True
    )
    override = env.store.overrides[ROOM]
    assert (override.mode, override.preset, override.temperature) == (
        "heat", "home", 21.0
    )


async def test_switch_off_preset_only_slot(env):
    day = (Band(480, 720, "heat", None, preset="eco"),)
    prog = await env.store.async_create_program("Preset", (day,) * 7, ())
    await env.store.async_assign(ROOM, prog.id)
    await env.hass.async_block_till_done()
    await env.hass.services.async_call(
        "switch", "turn_off", {"entity_id": SWITCH}, blocking=True
    )
    override = env.store.overrides[ROOM]
    assert (override.mode, override.preset, override.temperature) == (
        "heat", "eco", None
    )


# -- flat attributes for the Tessera tile ------------------------------------

TILE_TODAY = ("today_start", "today_end", "today_mode", "today_temp", "today_auto")
NO_TEMP = -100.0


def _today(attrs):
    return {k: attrs[k] for k in TILE_TODAY}


async def test_tile_today_lists_with_auto_bands(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert _today(attrs) == {
        "today_start": [0, 480, 720, 1080, 1380],
        "today_end": [480, 720, 1080, 1380, 1440],
        "today_mode": [0, 1, 0, 1, 0],
        "today_temp": [NO_TEMP, 23.0, NO_TEMP, 20.0, NO_TEMP],
        "today_auto": [1, 0, 1, 0, 1],
    }


async def test_tile_flat_slot_attributes(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["slot_mode"] == 1
    assert attrs["slot_temp"] == 23.0
    assert datetime.fromisoformat(attrs["slot_start_time"]) == at(26, 8)
    assert datetime.fromisoformat(attrs["slot_end_time"]) == at(26, 12)
    assert attrs["slot_end_time"] == attrs["slot_end"]
    assert attrs["next_mode"] == 0
    assert attrs["next_temp"] is None
    assert datetime.fromisoformat(attrs["next_start_time"]) == at(26, 12)
    assert attrs["override_until_time"] is None


async def test_tile_attributes_follow_slot_change(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    await env.go(at(26, 12))
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["slot_mode"] == 0
    assert attrs["slot_temp"] is None
    assert attrs["next_mode"] == 1
    assert attrs["next_temp"] == 20.0
    assert datetime.fromisoformat(attrs["next_start_time"]) == at(26, 18)


async def test_tile_override_until_time(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    await env.hass.services.async_call(
        "switch", "turn_off", {"entity_id": SWITCH}, blocking=True
    )
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert datetime.fromisoformat(attrs["override_until_time"]) == at(26, 12)
    assert attrs["override_until_time"] == attrs["override_until"]
    assert attrs["today_mode"] == [0, 1, 0, 1, 0]  # the program, not the override


async def test_tile_unassigned_room_has_empty_lists(env):
    """An unassigned room has no sensor at all; a sensor that outlives its
    assignment for an instant still reports empty lists and None."""
    from custom_components.cronotermostato.controller import RoomState
    from custom_components.cronotermostato.sensor import _slot_flat

    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    controller = env.entry.runtime_data.manager.controllers[ROOM]
    await env.store.async_unassign(ROOM)
    await env.hass.async_block_till_done()
    assert controller.day_bands(at(26, 9).date()) == ()
    state = RoomState()
    assert _slot_flat(state.slot, "slot", "slot_start_time") == {
        "slot_mode": None, "slot_temp": None, "slot_start_time": None,
    }
    assert _slot_flat(state.next_slot, "next", "next_start_time") == {
        "next_mode": None, "next_temp": None, "next_start_time": None,
    }


async def test_tile_paused_room_has_empty_lists(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    await env.store.async_set_paused(ROOM, True)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["status"] == "paused"
    for key in TILE_TODAY:
        assert attrs[key] == []
    await env.store.async_set_paused(ROOM, False)
    await env.hass.async_block_till_done()
    assert env.hass.states.get(SENSOR).attributes["today_mode"] == [0, 1, 0, 1, 0]


async def test_tile_holiday_day_uses_holiday_bands(env):
    env.freezer.move_to(datetime(2026, 11, 1, 10, tzinfo=TZ))  # Sunday, All Saints
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["holiday"] is True
    assert _today(attrs) == {
        "today_start": [0], "today_end": [1440], "today_mode": [1],
        "today_temp": [18.0], "today_auto": [0],
    }


async def test_tile_changes_at_midnight_without_slot_boundary(env):
    """Night "off" bands merge over midnight: only the day change updates."""
    day = (Band(480, 720, "heat", 21.0),)
    prog = await env.store.async_create_program(
        "Lavoro", (day,) * 5 + ((),) * 2, ()
    )
    env.freezer.move_to(at(30, 23, 30))  # Friday night
    await env.store.async_assign(ROOM, prog.id)
    await env.hass.async_block_till_done()
    assert env.hass.states.get(SENSOR).attributes["today_mode"] == [0, 1, 0]
    slot_end = env.hass.states.get(SENSOR).attributes["slot_end"]
    await env.go(datetime(2026, 10, 31, 0, 0, 1, tzinfo=TZ))  # Saturday
    attrs = env.hass.states.get(SENSOR).attributes
    assert _today(attrs) == {
        "today_start": [0], "today_end": [1440], "today_mode": [0],
        "today_temp": [NO_TEMP], "today_auto": [1],
    }
    assert attrs["slot_end"] == slot_end  # same slot across midnight


async def test_tile_dst_days_keep_wall_clock_minutes(env):
    # 2026-03-29 has 23 hours in Rome, 2026-10-25 has 25: bands stay wall-clock.
    for when in (datetime(2026, 3, 29, 12, tzinfo=TZ), datetime(2026, 10, 25, 12, tzinfo=TZ)):
        env.freezer.move_to(when)
        await env.store.async_assign(ROOM, env.program.id)
        await env.hass.async_block_till_done()
        attrs = env.hass.states.get(SENSOR).attributes
        assert attrs["today_end"][-1] == 1440
        assert attrs["today_start"][1:] == attrs["today_end"][:-1]


async def test_tile_dst_gap_band_is_kept(env):
    # 02:15-02:45 does not exist on 29 March, but it is a band of the program:
    # the display edits the program (wall-clock minutes), so it must see it,
    # else saving would erase the band from every Sunday. (Before 0.3.2 the
    # lists were built from the real pieces of the clock and the band was
    # dropped here.) The slots stay real.
    day = (Band(135, 165, "heat", 21.0), Band(180, 300, "heat", 19.0))
    prog = await env.store.async_create_program("Gap", (day,) * 7, ())
    env.freezer.move_to(datetime(2026, 3, 29, 12, tzinfo=TZ))
    await env.store.async_assign(ROOM, prog.id)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["today_start"] == [0, 135, 165, 180, 300]
    assert attrs["today_end"] == [135, 165, 180, 300, 1440]
    assert attrs["today_flags"] == [1, 0, 1, 0, 1]
    assert attrs["edit_n"] == 5


@pytest.mark.parametrize(
    "when",
    [
        datetime(2027, 3, 28, 12, tzinfo=TZ),  # Easter Sunday: holiday, spring gap
        datetime(2027, 3, 21, 12, tzinfo=TZ),  # ordinary Sunday
        datetime(2027, 10, 31, 12, tzinfo=TZ),  # 25-hour day
        datetime(2026, 10, 25, 12, tzinfo=TZ),  # 25-hour day
        datetime(2027, 3, 29, 12, tzinfo=TZ),  # Monday after the change
    ],
)
async def test_tile_lists_ignore_dst_in_every_case(env, when):
    # A band 02:00-03:00 (the hour that disappears on 28 March 2027).
    day = (Band(120, 180, "heat", 21.0, preset="eco"),)
    prog = await env.store.async_create_program("Notte", (day,) * 7, day)
    env.freezer.move_to(when)
    await env.store.async_assign(ROOM, prog.id)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["today_start"] == [0, 120, 180]
    assert attrs["today_end"] == [120, 180, 1440]
    assert attrs["today_mode"] == [0, 1, 0]
    assert attrs["today_temp"] == [NO_TEMP, 21.0, NO_TEMP]
    assert attrs["today_preset"] == ["", "eco", ""]
    assert attrs["today_auto"] == [1, 0, 1]
    assert attrs["today_locked"] == [0, 0, 0]
    assert attrs["today_flags"] == [1, 0, 1]
    assert attrs["edit_n"] == 3


async def test_tile_flags_combine_auto_and_locked(env):
    day = (Band(480, 720, "heat", 21.0, preset="Fuori casa"), Band(780, 900, "heat", 20.0))
    prog = await env.store.async_create_program("Flags", (day,) * 7, ())
    await env.store.async_assign(ROOM, prog.id)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["today_auto"] == [1, 0, 1, 0, 1]
    assert attrs["today_locked"] == [0, 1, 0, 0, 0]
    assert attrs["today_flags"] == [1, 2, 1, 0, 1]
    assert attrs["edit_n"] == len(attrs["today_flags"]) == 5
    assert all(type(v) is int for v in attrs["today_flags"])
    assert type(attrs["edit_n"]) is int


async def test_tile_paused_room_has_empty_flags(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.store.async_set_paused(ROOM, True)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["today_flags"] == [] and attrs["edit_n"] == 0


async def test_tile_preset_only_band_has_sentinel_temperature(env):
    day = (Band(480, 720, "heat", None, preset="home"),)
    prog = await env.store.async_create_program("Preset", (day,) * 7, ())
    await env.store.async_assign(ROOM, prog.id)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["today_mode"][1] == 1
    assert attrs["today_temp"][1] == NO_TEMP
    assert attrs["slot_temp"] is None


async def test_tile_lists_are_parallel_and_use_plain_types(env):
    cool = (Band(0, 600, "cool", 25.5),)
    prog = await env.store.async_create_program("Fresco", (cool,) * 7, ())
    await env.store.async_assign(ROOM, prog.id)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["today_mode"][0] == 2
    assert len({len(attrs[k]) for k in TILE_TODAY}) == 1
    for key in ("today_start", "today_end", "today_mode", "today_auto"):
        assert all(type(v) is int for v in attrs[key])  # no bool: Tessera drops them


async def test_tile_sensor_writes_only_on_change(env):
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    events = []
    env.hass.bus.async_listen(
        "state_changed",
        lambda e: events.append(e) if e.data["entity_id"] == SENSOR else None,
    )
    await env.go(at(26, 9, 30))
    await env.go(at(26, 10))
    assert events == []


async def test_midnight_without_change_writes_nothing(env):
    # Monday and Tuesday have the same bands; the slot merges over midnight.
    env.freezer.move_to(at(26, 23, 30))
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    events = []
    env.hass.bus.async_listen(
        "state_changed",
        lambda e: events.append(e) if e.data["entity_id"] == SENSOR else None,
    )
    await env.go(datetime(2026, 10, 27, 0, 0, 1, tzinfo=TZ))
    # the bands did not change: the only write is the new day kind
    assert len(events) == 1
    old = dict(events[0].data["old_state"].attributes)
    new = dict(events[0].data["new_state"].attributes)
    assert (old.pop("today_kind"), new.pop("today_kind")) == ("mon", "tue")
    # edit_info carries the day kind, nothing else changes
    o_info, n_info = old.pop("edit_info"), new.pop("edit_info")
    assert o_info.split(";")[0] == "mon" and n_info.split(";")[0] == "tue"
    assert o_info.split(";")[1:] == n_info.split(";")[1:]
    assert old == new
    assert env.hass.states.get(SENSOR).attributes["today_mode"] == [0, 1, 0, 1, 0]


async def test_midnight_with_change_writes_state(env):
    day = (Band(480, 720, "heat", 21.0),)
    prog = await env.store.async_create_program("Lavoro", (day,) * 5 + ((),) * 2, ())
    env.freezer.move_to(at(30, 23, 30))
    await env.store.async_assign(ROOM, prog.id)
    await env.hass.async_block_till_done()
    events = []
    env.hass.bus.async_listen(
        "state_changed",
        lambda e: events.append(e) if e.data["entity_id"] == SENSOR else None,
    )
    await env.go(datetime(2026, 10, 31, 0, 0, 1, tzinfo=TZ))
    assert len(events) == 1


async def test_holiday_follows_the_day_at_midnight(env):
    day = (Band(480, 720, "heat", 21.0),)
    prog = await env.store.async_create_program("Lavoro", (day,) * 7, ())
    env.freezer.move_to(at(31, 23, 30))  # Saturday night, then All Saints
    await env.store.async_assign(ROOM, prog.id)
    await env.hass.async_block_till_done()
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["holiday"] is False
    assert attrs["today_mode"] == [0, 1, 0]
    env.calls.clear()
    await env.go(datetime(2026, 11, 1, 0, 0, 1, tzinfo=TZ))
    attrs = env.hass.states.get(SENSOR).attributes
    assert attrs["holiday"] is True
    assert attrs["today_mode"] == [0]
    assert env.calls == []  # no extra command at midnight


async def test_unrecorded_tile_attributes():
    assert {
        *TILE_TODAY, "slot_mode", "slot_temp", "slot_start_time", "slot_end_time",
        "next_mode", "next_temp", "next_start_time", "override_until_time",
    } <= RoomProgramSensor._unrecorded_attributes
