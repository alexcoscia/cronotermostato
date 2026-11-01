"""Tests for setup, unload and the options effect on the room controllers."""

import asyncio
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from homeassistant.config_entries import ConfigEntryState
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.cronotermostato.const import CONF_COUNTRY, CONF_SUBDIV, DOMAIN
from custom_components.cronotermostato.engine.models import Band

ROOM = "climate.salotto"
TZ = ZoneInfo("Europe/Rome")
WEEK = ((Band(480, 720, "heat", 23.0),),) * 7
HOLIDAY = (Band(0, 1440, "heat", 18.0),)


def _entry(country="IT", subdiv=None):
    return MockConfigEntry(
        domain=DOMAIN,
        data={CONF_COUNTRY: country, CONF_SUBDIV: subdiv},
        unique_id=DOMAIN,
    )


async def test_setup_unload_leaves_nothing(hass):
    entry = _entry()
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    data = entry.runtime_data
    assert data.calendar.country == "IT"
    assert data.manager.controllers == {}

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.NOT_LOADED
    assert data.manager.controllers == {}


async def test_unload_stops_controllers_and_timers(hass, freezer):
    await hass.config.async_set_time_zone("Europe/Rome")
    freezer.move_to(datetime(2026, 10, 26, 9, tzinfo=TZ))
    calls = []

    async def _handle(call):
        calls.append(call.service)

    for name in ("set_hvac_mode", "set_temperature"):
        hass.services.async_register("climate", name, _handle)
    hass.states.async_set(ROOM, "heat", {"hvac_modes": ["heat", "off"]})

    entry = _entry()
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    store = entry.runtime_data.store
    prog = await store.async_create_program("Casa", WEEK, HOLIDAY)
    await store.async_assign(ROOM, prog.id)
    await hass.async_block_till_done()
    manager = entry.runtime_data.manager
    assert ROOM in manager.controllers

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert manager.controllers == {}
    # a later store change must not revive anything
    await store.async_unassign(ROOM)
    await hass.async_block_till_done()
    assert manager.controllers == {}


async def test_unsupported_saved_location_is_setup_error(hass):
    entry = _entry(country="ZZ")
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    assert entry.state is ConfigEntryState.SETUP_ERROR


async def test_unsupported_saved_subdiv_is_setup_error(hass):
    entry = _entry(country="IT", subdiv="NOPE")
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    assert entry.state is ConfigEntryState.SETUP_ERROR


async def _holiday_env(hass, freezer, day):
    await hass.config.async_set_time_zone("Europe/Rome")
    freezer.move_to(day)
    calls = []

    async def _hvac(call):
        calls.append(("hvac", call.data["hvac_mode"]))

    async def _temp(call):
        calls.append(("temp", call.data["temperature"]))

    hass.services.async_register("climate", "set_hvac_mode", _hvac)
    hass.services.async_register("climate", "set_temperature", _temp)
    hass.states.async_set(ROOM, "heat", {"hvac_modes": ["heat", "off"]})
    return calls


async def test_options_change_recomputes_rooms(hass, freezer):
    # 8 December 2026 (Tuesday) is a public holiday in Italy but not in the US.
    calls = await _holiday_env(hass, freezer, datetime(2026, 12, 8, 9, tzinfo=TZ))
    entry = _entry("IT")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    store = entry.runtime_data.store
    prog = await store.async_create_program("Casa", WEEK, HOLIDAY)
    await store.async_assign(ROOM, prog.id)
    await hass.async_block_till_done()
    state = entry.runtime_data.manager.controllers[ROOM].state
    assert state.holiday is True
    assert ("temp", 18.0) in calls

    calls.clear()
    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_COUNTRY: "US"}
    )
    await hass.config_entries.options.async_configure(result["flow_id"], {})
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.LOADED
    assert entry.runtime_data.calendar.country == "US"
    assert not entry.runtime_data.calendar.is_holiday(date(2026, 12, 8))
    state = entry.runtime_data.manager.controllers[ROOM].state
    assert state.holiday is False
    assert ("temp", 23.0) in calls
    assert entry.runtime_data.store.assignments[ROOM].program_id == prog.id

    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_options_subdiv_changes_calendar(hass, freezer):
    # 29 June 2026 (Monday): Saints Peter and Paul, a holiday only in Rome (RM).
    calls = await _holiday_env(hass, freezer, datetime(2026, 6, 29, 9, tzinfo=TZ))
    entry = _entry("IT")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    store = entry.runtime_data.store
    prog = await store.async_create_program("Casa", WEEK, HOLIDAY)
    await store.async_assign(ROOM, prog.id)
    await hass.async_block_till_done()
    assert entry.runtime_data.manager.controllers[ROOM].state.holiday is False

    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_COUNTRY: "IT"}
    )
    await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_SUBDIV: "RM"}
    )
    await hass.async_block_till_done()
    assert entry.runtime_data.calendar.subdiv == "RM"
    assert entry.runtime_data.manager.controllers[ROOM].state.holiday is True
    assert await hass.config_entries.async_unload(entry.entry_id)
