"""Tests for the integration services (fake climate entities, no real device)."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
import voluptuous as vol
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.cronotermostato.const import CONF_COUNTRY, CONF_SUBDIV, DOMAIN

TZ = ZoneInfo("Europe/Rome")
ROOM = "climate.salotto"


def band(start, end, mode="heat", temperature=21.0):
    return {"start": start, "end": end, "mode": mode, "temperature": temperature}


DAY = [band("08:00", "12:00", temperature=23.0), band("18:00", "23:00", temperature=20.0)]
WEEK = [DAY] * 7
HOLIDAY = [band("00:00", "24:00", temperature=18.0)]


def at(hour, minute=0):
    return datetime(2026, 10, 26, hour, minute, tzinfo=TZ)  # Monday


@pytest.fixture
async def env(hass, freezer):
    await hass.config.async_set_time_zone("Europe/Rome")
    freezer.move_to(at(9))
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
        ROOM,
        "heat",
        {"hvac_modes": ["heat", "cool", "off"], "preset_modes": ["none", "home", "eco"]},
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_COUNTRY: "IT", CONF_SUBDIV: None},
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    class Env:
        pass

    e = Env()
    e.hass, e.freezer, e.entry, e.calls = hass, freezer, entry, calls
    e.store = entry.runtime_data.store

    async def call(service, response=False, **data):
        return await hass.services.async_call(
            DOMAIN, service, data, blocking=True, return_response=response
        )

    async def create(name="Casa"):
        result = await call(
            "create_program", True, name=name, week=WEEK, holiday=HOLIDAY
        )
        return result["program_id"]

    async def go(when):
        freezer.move_to(when)
        async_fire_time_changed(hass, when)
        await hass.async_block_till_done()

    e.call, e.create, e.go = call, create, go
    yield e
    await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()


async def test_services_exist_without_entry(hass):
    from custom_components.cronotermostato import async_setup

    assert await async_setup_component(hass, "http", {})

    assert await async_setup(hass, {})
    for name in (
        "create_program", "update_program", "delete_program", "assign",
        "unassign", "pause", "resume", "set_manual", "resume_auto", "set_day",
    ):
        assert hass.services.has_service(DOMAIN, name)
    with pytest.raises(ServiceValidationError) as err:
        await hass.services.async_call(
            DOMAIN, "delete_program", {"program_id": "x"}, blocking=True
        )
    assert err.value.translation_key == "not_loaded"


async def test_create_program_returns_id(env):
    program_id = await env.create()
    assert program_id == "casa"
    program = env.store.programs[program_id]
    assert program.name == "Casa"
    assert len(program.week) == 7 and len(program.week[0]) == 2
    assert program.week[0][0].start == 480 and program.week[0][0].temperature == 23.0
    assert program.holiday[0].end == 1440


async def test_create_off_band_without_temperature_and_auto_discarded(env):
    day = [
        {"start": "00:00", "end": "06:00", "mode": "off"},
        {"start": "06:00", "end": "07:00", "mode": "off", "temperature": None},
        {"start": "07:00", "end": "08:00", "mode": "off", "auto": True},
    ]
    result = await env.call(
        "create_program", True, name="Notte", week=[day] * 7, holiday=[]
    )
    bands = env.store.programs[result["program_id"]].week[0]
    assert [(b.start, b.end) for b in bands] == [(0, 360), (360, 420)]


async def test_overlapping_bands_rejected(env):
    bad = [band("08:00", "12:00"), band("11:00", "13:00")]
    with pytest.raises(ServiceValidationError) as err:
        await env.call("create_program", name="X", week=[bad] * 7, holiday=[])
    assert err.value.translation_key == "invalid_program"
    assert "Overlapping" in err.value.translation_placeholders["error"]
    assert env.store.programs == {}


@pytest.mark.parametrize(
    "bands",
    [
        [band("8:00", "12:00")],
        [band("08:00", "25:00")],
        [{"start": "08:00", "end": "12:00", "mode": "cool"}],
    ],
)
async def test_invalid_bands_rejected(env, bands):
    with pytest.raises(ServiceValidationError):
        await env.call("create_program", name="X", week=[bands] * 7, holiday=[])
    assert env.store.programs == {}


async def test_week_needs_seven_days(env):
    with pytest.raises(vol.Invalid):  # schema rejects it
        await env.call("create_program", name="X", week=[DAY] * 6, holiday=[])
    assert env.store.programs == {}


async def test_update_program(env):
    program_id = await env.create()
    await env.call("update_program", program_id=program_id, name="Nuovo")
    program = env.store.programs[program_id]
    assert program.name == "Nuovo"
    assert len(program.week[0]) == 2  # untouched

    await env.call("update_program", program_id=program_id, holiday=[])
    assert env.store.programs[program_id].holiday == ()
    assert len(env.store.programs[program_id].week[0]) == 2

    with pytest.raises(ServiceValidationError):
        await env.call(
            "update_program", program_id=program_id,
            week=[[band("08:00", "12:00"), band("10:00", "13:00")]] * 7,
        )
    with pytest.raises(ServiceValidationError):
        await env.call("update_program", program_id="nope", name="x")


async def test_delete_blocked_while_assigned(env):
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    with pytest.raises(ServiceValidationError) as err:
        await env.call("delete_program", program_id=program_id)
    assert err.value.translation_key == "invalid_program"
    assert program_id in env.store.programs

    await env.call("unassign", climate_entity_id=ROOM)
    await env.call("delete_program", program_id=program_id)
    assert env.store.programs == {}


async def test_assign_starts_room_and_unassign_stops(env):
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    manager = env.entry.runtime_data.manager
    assert ROOM in manager.controllers  # right after the call, no waiting
    assert env.store.assignments[ROOM].program_id == program_id
    assert (ROOM, "set_hvac_mode", "heat") in env.calls  # 09:00 is in 08-12

    await env.call("unassign", climate_entity_id=ROOM)
    assert manager.controllers == {}
    assert ROOM not in env.store.assignments


async def test_assign_unknown_climate_and_program(env):
    program_id = await env.create()
    with pytest.raises(ServiceValidationError) as err:
        await env.call(
            "assign", program_id=program_id, climate_entity_id="climate.fantasma"
        )
    assert err.value.translation_key == "unknown_climate"
    assert env.store.assignments == {}
    with pytest.raises(ServiceValidationError):
        await env.call("assign", program_id="nope", climate_entity_id=ROOM)
    with pytest.raises(Exception):  # not a climate entity  # noqa: B017
        await env.call("assign", program_id=program_id, climate_entity_id="light.x")
    assert env.store.assignments == {}


async def test_assign_allowed_for_unavailable_and_registry_only(env):
    program_id = await env.create()
    env.hass.states.async_set(ROOM, "unavailable")
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    assert ROOM in env.store.assignments

    er.async_get(env.hass).async_get_or_create(
        "climate", "test", "uid", suggested_object_id="studio"
    )
    await env.call(
        "assign", program_id=program_id, climate_entity_id="climate.studio"
    )
    assert "climate.studio" in env.store.assignments


async def test_pause_and_resume(env):
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    await env.call("pause", climate_entity_id=ROOM)
    assert env.store.assignments[ROOM].paused
    await env.call("resume", climate_entity_id=ROOM)
    assert not env.store.assignments[ROOM].paused


@pytest.mark.parametrize("service", ["pause", "resume", "resume_auto"])
async def test_room_services_need_assignment(env, service):
    with pytest.raises(ServiceValidationError) as err:
        await env.call(service, climate_entity_id=ROOM)
    assert err.value.translation_key == "room_not_assigned"


async def test_set_manual_unassigned(env):
    with pytest.raises(ServiceValidationError) as err:
        await env.call(
            "set_manual", climate_entity_id=ROOM, mode="heat", temperature=22
        )
    assert err.value.translation_key == "room_not_assigned"
    assert env.store.overrides == {}


async def test_set_manual_and_resume_auto(env):
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    env.calls.clear()
    await env.call("set_manual", climate_entity_id=ROOM, mode="cool", temperature=25)
    assert env.calls == [
        (ROOM, "set_hvac_mode", "cool"),
        (ROOM, "set_temperature", 25.0),
    ]
    assert env.store.overrides[ROOM].mode == "cool"

    env.calls.clear()
    await env.call("resume_auto", climate_entity_id=ROOM)
    assert ROOM not in env.store.overrides
    assert env.calls == [
        (ROOM, "set_hvac_mode", "heat"),
        (ROOM, "set_temperature", 23.0),
    ]


async def test_set_manual_needs_temperature(env):
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    env.calls.clear()
    for mode in ("cool", "heat"):
        with pytest.raises(ServiceValidationError) as err:
            await env.call("set_manual", climate_entity_id=ROOM, mode=mode)
        assert err.value.translation_key == "invalid_program"
    with pytest.raises(ServiceValidationError):
        await env.call(
            "set_manual", climate_entity_id=ROOM, mode="cool", temperature=None
        )
    assert env.store.overrides == {}
    assert env.calls == []


async def test_set_manual_off_ignores_temperature(env):
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    await env.call("set_manual", climate_entity_id=ROOM, mode="off", temperature=22)
    assert env.store.overrides[ROOM].mode == "off"
    assert env.store.overrides[ROOM].temperature is None


async def test_update_current_slot_is_applied(env):
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    env.calls.clear()
    new_day = [band("08:00", "12:00", temperature=19.0)]
    await env.call("update_program", program_id=program_id, week=[new_day] * 7)
    await env.hass.async_block_till_done()
    assert (ROOM, "set_temperature", 19.0) in env.calls


async def test_program_name_max_100(env):
    await env.create("x" * 100)
    with pytest.raises(vol.Invalid):
        await env.call(
            "create_program", name="x" * 101, week=WEEK, holiday=HOLIDAY
        )
    assert len(env.store.programs) == 1


async def test_set_manual_out_of_climate_range(env):
    env.hass.states.async_set(
        ROOM, "heat", {"hvac_modes": ["heat", "off"], "min_temp": 15, "max_temp": 25}
    )
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    env.calls.clear()
    for temperature in (30, 14.5):
        with pytest.raises(ServiceValidationError) as err:
            await env.call(
                "set_manual", climate_entity_id=ROOM, mode="heat",
                temperature=temperature,
            )
        assert err.value.translation_key == "temperature_out_of_range"
        assert err.value.translation_placeholders["entity_id"] == ROOM
        assert err.value.translation_placeholders["min"] == "15.0"
        assert err.value.translation_placeholders["max"] == "25.0"
    assert env.store.overrides == {}
    assert env.calls == []
    await env.call("set_manual", climate_entity_id=ROOM, mode="heat", temperature=25)
    assert env.calls[-1] == (ROOM, "set_temperature", 25.0)


async def test_set_manual_off_never_out_of_range(env):
    env.hass.states.async_set(
        ROOM, "heat", {"hvac_modes": ["heat", "off"], "min_temp": 15, "max_temp": 25}
    )
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    await env.call("set_manual", climate_entity_id=ROOM, mode="off", temperature=99)
    assert env.store.overrides[ROOM].mode == "off"


async def test_set_manual_defaults_when_climate_missing(env):
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    env.hass.states.async_remove(ROOM)
    with pytest.raises(ServiceValidationError) as err:
        await env.call(
            "set_manual", climate_entity_id=ROOM, mode="heat", temperature=36
        )
    assert err.value.translation_key == "temperature_out_of_range"
    assert err.value.translation_placeholders["min"] == "5.0"
    assert err.value.translation_placeholders["max"] == "35.0"
    await env.call("set_manual", climate_entity_id=ROOM, mode="heat", temperature=35)
    assert env.store.overrides[ROOM].temperature == 35.0


# -- preset -----------------------------------------------------------------


async def test_create_program_with_preset_bands(env):
    day = [
        {"start": "08:00", "end": "12:00", "mode": "heat", "preset": "home"},
        {"start": "12:00", "end": "14:00", "mode": "heat", "temperature": 20,
         "preset": "eco"},
        {"start": "14:00", "end": "16:00", "mode": "heat", "preset": None,
         "temperature": 21},
    ]
    result = await env.call(
        "create_program", True, name="Preset", week=[day] * 7, holiday=[]
    )
    week0 = env.store.programs[result["program_id"]].week[0]
    assert [(b.temperature, b.preset) for b in week0] == [
        (None, "home"), (20.0, "eco"), (21.0, None),
    ]


@pytest.mark.parametrize(
    "bad",
    [
        {"mode": "heat"},  # neither temperature nor preset
        {"mode": "heat", "preset": ""},
        {"mode": "heat", "preset": "  "},
        {"mode": "off", "preset": "home"},
    ],
)
async def test_create_program_invalid_preset_bands(env, bad):
    day = [{"start": "08:00", "end": "12:00", **bad}]
    with pytest.raises(ServiceValidationError) as err:
        await env.call("create_program", name="X", week=[day] * 7, holiday=[])
    assert err.value.translation_key == "invalid_program"
    assert not env.store.programs


async def test_update_program_with_preset_commands_room(env):
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    env.calls.clear()
    day = [{"start": "08:00", "end": "12:00", "mode": "heat", "preset": "home"}]
    await env.call("update_program", program_id=program_id, week=[day] * 7)
    await env.hass.async_block_till_done()
    assert env.calls == [
        (ROOM, "set_hvac_mode", "heat"),
        (ROOM, "set_preset_mode", "home"),
    ]


async def test_set_manual_preset_only(env):
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    env.calls.clear()
    await env.call("set_manual", climate_entity_id=ROOM, mode="heat", preset="eco")
    assert env.calls == [
        (ROOM, "set_hvac_mode", "heat"),
        (ROOM, "set_preset_mode", "eco"),
    ]
    assert env.store.overrides[ROOM].preset == "eco"
    assert env.store.overrides[ROOM].temperature is None


async def test_set_manual_preset_and_temperature(env):
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    env.calls.clear()
    await env.call(
        "set_manual", climate_entity_id=ROOM, mode="heat", preset="home",
        temperature=22,
    )
    assert [c[1] for c in env.calls] == [
        "set_hvac_mode", "set_preset_mode", "set_temperature",
    ]


@pytest.mark.parametrize("extra", [{}, {"preset": None}, {"preset": ""}])
async def test_set_manual_heat_needs_preset_or_temperature(env, extra):
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    env.calls.clear()
    with pytest.raises(ServiceValidationError) as err:
        await env.call("set_manual", climate_entity_id=ROOM, mode="heat", **extra)
    assert err.value.translation_key == "invalid_program"
    assert env.store.overrides == {}
    assert env.calls == []


async def test_set_manual_range_only_with_temperature(env):
    env.hass.states.async_set(
        ROOM, "heat",
        {"hvac_modes": ["heat", "off"], "preset_modes": ["home"],
         "min_temp": 15, "max_temp": 25},
    )
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    with pytest.raises(ServiceValidationError) as err:
        await env.call(
            "set_manual", climate_entity_id=ROOM, mode="heat", preset="home",
            temperature=30,
        )
    assert err.value.translation_key == "temperature_out_of_range"
    assert env.store.overrides == {}
    await env.call("set_manual", climate_entity_id=ROOM, mode="heat", preset="home")
    assert env.store.overrides[ROOM].preset == "home"
