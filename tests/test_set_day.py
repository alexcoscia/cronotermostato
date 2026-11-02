"""Tests for ``cronotermostato.set_day`` and the attributes it feeds."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
import voluptuous as vol
from homeassistant.exceptions import ServiceValidationError
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.cronotermostato.const import CONF_COUNTRY, CONF_SUBDIV, DOMAIN
from custom_components.cronotermostato.engine.models import Band
from custom_components.cronotermostato.sensor import RoomProgramSensor

TZ = ZoneInfo("Europe/Rome")
ROOM = "climate.salotto"
ROOM2 = "climate.studio"
SENSOR = "sensor.salotto_programma"
SENSOR2 = "sensor.studio_programma"
DAY = (Band(480, 720, "heat", 23.0), Band(1080, 1380, "heat", 20.0))
WEEK = (DAY,) * 7
HOLIDAY = (Band(0, 1440, "heat", 18.0),)


def at(day, hour=9, minute=0, month=10):
    return datetime(2026, month, day, hour, minute, tzinfo=TZ)  # 26 Oct = Monday


@pytest.fixture
async def env(hass, freezer):
    await hass.config.async_set_time_zone("Europe/Rome")
    freezer.move_to(at(26))
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
    for room in (ROOM, ROOM2):
        hass.states.async_set(
            room,
            "heat",
            {"hvac_modes": ["heat", "cool", "off"], "preset_modes": ["none", "eco"]},
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
    e.program = await e.store.async_create_program("Casa", WEEK, HOLIDAY)
    await e.store.async_assign(ROOM, e.program.id)
    await hass.async_block_till_done()
    calls.clear()

    async def set_day(day_kind="mon", bands="", room=ROOM):
        await hass.services.async_call(
            DOMAIN,
            "set_day",
            {"climate_entity_id": room, "day_kind": day_kind, "bands": bands},
            blocking=True,
        )
        await hass.async_block_till_done()

    async def go(when):
        freezer.move_to(when)
        async_fire_time_changed(hass, when)
        await hass.async_block_till_done()

    e.set_day, e.go = set_day, go
    e.program_now = lambda: e.store.programs[e.program.id]
    e.attrs = lambda sensor=SENSOR: hass.states.get(sensor).attributes
    yield e
    await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()


async def test_service_registered(env):
    assert env.hass.services.has_service(DOMAIN, "set_day")


async def test_replaces_only_that_day_and_reapplies(env):
    await env.set_day("mon", "08:00-12:00 heat 25; 19:00-22:00 cool 26,5")
    program = env.program_now()
    assert program.week[0] == (Band(480, 720, "heat", 25.0), Band(1140, 1320, "cool", 26.5))
    assert program.week[1:] == WEEK[1:]
    assert program.holiday == HOLIDAY
    assert program.name == "Casa"
    assert (ROOM, "set_temperature", 25.0) in env.calls  # 09:00 is in the first band


async def test_preset_band(env):
    await env.set_day("mon", "08:00-12:00 heat preset=eco")
    assert env.program_now().week[0] == (Band(480, 720, "heat", None, preset="eco"),)
    assert (ROOM, "set_preset_mode", "eco") in env.calls


async def test_empty_text_clears_user_bands_automatic_off_fills(env):
    await env.set_day("mon", "")
    assert env.program_now().week[0] == ()
    assert env.attrs()["today_auto"] == [1]
    assert env.attrs()["today_mode"] == [0]
    assert (ROOM, "set_hvac_mode", "off") in env.calls


async def test_automatic_off_bands_are_not_written(env):
    await env.set_day("mon", "08:00-09:00 off")
    stored = env.program_now().week[0]
    assert stored == (Band(480, 540, "off"),)
    assert all(not b.auto for b in stored)


async def test_unchanged_content_does_nothing(env):
    saved = []
    env.store._store.async_save = lambda data: saved.append(data) or _done()
    notified = []
    env.store.async_add_listener(lambda: notified.append(1))
    revision_before = env.program_now()
    # same content, written differently
    await env.set_day("mon", " 08:00 - 12:00 heat 23.0 ;18:00-23:00 heat 20,0; ")
    assert env.program_now() is revision_before
    assert saved == [] and notified == []
    assert env.calls == []


async def _done():
    return None


async def test_unchanged_clears_last_error(env):
    with pytest.raises(ServiceValidationError):
        await env.set_day("mon", "garbage")
    assert env.attrs()["last_error"] == "invalid_bands"
    await env.set_day("mon", "08:00-12:00 heat 23; 18:00-23:00 heat 20")
    assert env.attrs()["last_error"] is None


async def test_unassigned_room(env):
    with pytest.raises(ServiceValidationError) as err:
        await env.set_day("mon", "", room=ROOM2)
    assert err.value.translation_key == "room_not_assigned"
    assert env.entry.runtime_data.manager.last_errors == {}  # nothing to show it
    assert env.program_now().week == WEEK


async def test_not_a_climate_entity_rejected_by_schema(env):
    with pytest.raises(vol.Invalid):
        await env.set_day("mon", "", room="light.x")


@pytest.mark.parametrize("kind", ["", "monday", "Mon", "today", "holiday "])
async def test_unknown_day_kind_rejected(env, kind):
    with pytest.raises(vol.Invalid):
        await env.set_day(kind, "")


async def test_stale_day(env):
    with pytest.raises(ServiceValidationError) as err:
        await env.set_day("tue", "08:00-09:00 off")
    assert err.value.translation_key == "stale_day"
    assert err.value.translation_placeholders["day_kind"] == "tue"
    assert err.value.translation_placeholders["today_kind"] == "mon"
    assert env.program_now().week == WEEK
    assert env.attrs()["last_error"] == "stale_day"
    with pytest.raises(ServiceValidationError):
        await env.set_day("holiday", "08:00-09:00 off")  # Monday is no holiday


async def test_stale_around_midnight(env):
    await env.go(at(26, 23, 59))
    await env.set_day("mon", "08:00-09:00 off")  # still Monday
    await env.go(at(27, 0, 0))
    with pytest.raises(ServiceValidationError) as err:
        await env.set_day("mon", "10:00-11:00 off")
    assert err.value.translation_key == "stale_day"
    assert env.program_now().week[0] == (Band(480, 540, "off"),)
    await env.set_day("tue", "10:00-11:00 off")
    assert env.program_now().week[1] == (Band(600, 660, "off"),)


async def test_holiday_writes_the_holiday_day(env):
    await env.go(at(1, 9, month=11))  # Sunday 1 Nov, All Saints
    assert env.attrs()["today_kind"] == "holiday"
    with pytest.raises(ServiceValidationError) as err:
        await env.set_day("sun", "08:00-09:00 off")
    assert err.value.translation_key == "stale_day"
    await env.set_day("holiday", "08:00-09:00 heat 19")
    program = env.program_now()
    assert program.holiday == (Band(480, 540, "heat", 19.0),)
    assert program.week == WEEK


async def test_sunday_without_holiday_uses_sunday(env):
    await env.go(at(7, 23, 30, month=11))
    await env.go(datetime(2026, 11, 8, 0, 0, 1, tzinfo=TZ))  # Sunday, no holiday
    assert env.attrs()["today_kind"] == "sun"
    await env.set_day("sun", "08:00-09:00 off")
    assert env.program_now().week[6] == (Band(480, 540, "off"),)


@pytest.mark.parametrize(
    "bands",
    [
        "garbage",
        "08:00-07:00 heat 20",
        "08:00-09:00 heat",
        "08:00-09:00 off 20",
        "08:00-10:00 heat 20; 09:00-11:00 heat 20",
        "a" * 2000,
    ],
)
async def test_invalid_bands(env, bands):
    with pytest.raises(ServiceValidationError) as err:
        await env.set_day("mon", bands)
    assert err.value.translation_key == "invalid_bands"
    assert err.value.translation_placeholders["detail"]
    assert env.program_now().week == WEEK
    assert env.attrs()["last_error"] == "invalid_bands"
    assert env.calls == []


async def test_invalid_bands_detail_has_position(env):
    with pytest.raises(ServiceValidationError) as err:
        await env.set_day("mon", "08:00-09:00 heat 20; 10:00-11:00 warm")
    assert "band 2" in err.value.translation_placeholders["detail"]
    assert "column" in err.value.translation_placeholders["detail"]


async def test_shared_program_changes_every_room(env):
    await env.store.async_assign(ROOM2, env.program.id)
    await env.hass.async_block_till_done()
    env.calls.clear()
    await env.set_day("mon", "08:00-12:00 heat 25")
    assert (ROOM, "set_temperature", 25.0) in env.calls
    assert (ROOM2, "set_temperature", 25.0) in env.calls
    assert env.attrs(SENSOR2)["today_temp"][1] == 25.0
    assert env.attrs()["program_rooms"] == env.attrs(SENSOR2)["program_rooms"] == 2


async def test_paused_room_still_edits_the_program(env):
    await env.store.async_set_paused(ROOM, True)
    env.calls.clear()
    await env.set_day("mon", "08:00-12:00 heat 25")
    assert env.program_now().week[0] == (Band(480, 720, "heat", 25.0),)
    assert env.calls == []  # a paused room is never commanded


async def test_last_error_is_per_room(env):
    await env.store.async_assign(ROOM2, env.program.id)
    await env.hass.async_block_till_done()
    with pytest.raises(ServiceValidationError):
        await env.set_day("tue", "", room=ROOM)
    assert env.attrs()["last_error"] == "stale_day"
    assert env.attrs(SENSOR2)["last_error"] is None
    await env.set_day("mon", "", room=ROOM2)
    assert env.attrs()["last_error"] == "stale_day"  # another room's success
    await env.set_day("mon", "08:00-09:00 off", room=ROOM)
    assert env.attrs()["last_error"] is None


async def test_last_error_not_kept_after_unassign(env):
    with pytest.raises(ServiceValidationError):
        await env.set_day("tue", "")
    await env.store.async_unassign(ROOM)
    await env.hass.async_block_till_done()
    await env.store.async_assign(ROOM, env.program.id)
    await env.hass.async_block_till_done()
    assert env.attrs()["last_error"] is None


# -- sensor attributes ---------------------------------------------------


async def test_flat_attributes(env):
    attrs = env.attrs()
    assert attrs["program_name"] == "Casa"
    assert attrs["program_rooms"] == 1
    assert attrs["today_kind"] == "mon"
    assert attrs["last_error"] is None
    assert type(attrs["program_rooms"]) is int
    assert {"program_name", "program_rooms", "today_kind", "last_error"} <= (
        RoomProgramSensor._unrecorded_attributes
    )


async def test_program_name_and_rooms_follow_changes(env):
    await env.store.async_update_program(env.program.id, name="Villa")
    await env.hass.async_block_till_done()
    assert env.attrs()["program_name"] == "Villa"
    await env.store.async_assign(ROOM2, env.program.id)
    await env.hass.async_block_till_done()
    assert env.attrs()["program_rooms"] == 2
    await env.store.async_unassign(ROOM2)
    await env.hass.async_block_till_done()
    assert env.attrs()["program_rooms"] == 1
    other = await env.store.async_create_program("Altro", WEEK, HOLIDAY)
    await env.store.async_assign(ROOM2, other.id)
    await env.hass.async_block_till_done()
    assert env.attrs()["program_rooms"] == 1
    assert env.attrs(SENSOR2)["program_name"] == "Altro"


async def test_today_kind_changes_at_midnight_with_holiday(env):
    await env.go(at(31, 23, 30))  # Saturday
    assert env.attrs()["today_kind"] == "sat"
    await env.go(datetime(2026, 11, 1, 0, 0, 1, tzinfo=TZ))
    assert env.attrs()["today_kind"] == "holiday"
    assert env.attrs()["holiday"] is True
    await env.go(datetime(2026, 11, 2, 0, 0, 1, tzinfo=TZ))
    assert env.attrs()["today_kind"] == "mon"
    assert env.attrs()["holiday"] is False


async def test_no_state_write_when_nothing_changes(env):
    events = []
    env.hass.bus.async_listen(
        "state_changed",
        lambda e: events.append(e) if e.data["entity_id"] == SENSOR else None,
    )
    await env.set_day("mon", "08:00-12:00 heat 23; 18:00-23:00 heat 20")
    await env.hass.async_block_till_done()
    assert events == []
    with pytest.raises(ServiceValidationError):
        await env.set_day("tue", "")
    assert len(events) == 1  # only last_error changed
    with pytest.raises(ServiceValidationError):
        await env.set_day("tue", "")
    assert len(events) == 1  # same error again: no new write
