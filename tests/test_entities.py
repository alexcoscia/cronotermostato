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
