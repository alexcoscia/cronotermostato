"""Services of the Cronotermostato integration.

Design decisions:

* Services are registered once in ``async_setup`` (so they exist even without
  a loaded config entry) and look up the manager of the loaded entry at call
  time; without one they raise ``not_loaded``.
* Room services take a single ``climate_entity_id`` (no lists): an error is
  then always about one room and nothing is half applied.
* Every ``ProgramError`` becomes a ``ServiceValidationError`` with the
  translated ``invalid_program`` message; the engine text is the placeholder.
* Bands are validated by ``program_from_dict`` (the same code used when the
  store is loaded), not by a second implementation here.
* ``set_manual`` with mode ``off`` ignores temperature and preset, like
  ``RoomController.async_set_manual``; ``cool``/``heat`` need at least one of
  the two (otherwise ``invalid_program``). The temperature range is checked
  only when a temperature is given. The preset support of the thermostat is
  not checked here: the room then shows ``unsupported_preset``.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
)
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import DAY_KINDS, DOMAIN, HOLIDAY_KIND, SIGNAL_ROOM_UPDATED
from .controller import RoomController
from .engine.bands_text import BandsTextError, parse_bands
from .engine.models import (
    DAYS_PER_WEEK,
    MODES,
    Band,
    Program,
    ProgramError,
    program_from_dict,
    text_from_minutes,
)
from .manager import Manager
from .store import CronoStore

_BAND = vol.Schema(
    {
        vol.Required("start"): cv.string,
        vol.Required("end"): cv.string,
        vol.Required("mode"): vol.In(MODES),
        vol.Optional("temperature"): vol.Any(None, vol.Coerce(float)),
        vol.Optional("preset"): vol.Any(None, cv.string),
        # Automatic bands are accepted and discarded by the store.
        vol.Optional("auto"): cv.boolean,
    }
)
_DAY = vol.All(cv.ensure_list, [_BAND])
_WEEK = vol.All(list, vol.Length(min=DAYS_PER_WEEK, max=DAYS_PER_WEEK), [_DAY])
_NAME = vol.All(cv.string, vol.Length(min=1, max=100))
_CLIMATE = vol.All(cv.entity_id, cv.entity_domain("climate"))

CREATE_SCHEMA = vol.Schema(
    {
        vol.Required("name"): _NAME,
        vol.Required("week"): _WEEK,
        vol.Required("holiday"): _DAY,
    }
)
UPDATE_SCHEMA = vol.Schema(
    {
        vol.Required("program_id"): cv.string,
        vol.Optional("name"): _NAME,
        vol.Optional("week"): _WEEK,
        vol.Optional("holiday"): _DAY,
    }
)
DELETE_SCHEMA = vol.Schema({vol.Required("program_id"): cv.string})
ASSIGN_SCHEMA = vol.Schema(
    {vol.Required("program_id"): cv.string, vol.Required("climate_entity_id"): _CLIMATE}
)
ROOM_SCHEMA = vol.Schema({vol.Required("climate_entity_id"): _CLIMATE})
MANUAL_SCHEMA = vol.Schema(
    {
        vol.Required("climate_entity_id"): _CLIMATE,
        vol.Required("mode"): vol.In(MODES),
        vol.Optional("temperature"): vol.Any(None, vol.Coerce(float)),
        vol.Optional("preset"): vol.Any(None, cv.string),
    }
)
SET_DAY_SCHEMA = vol.Schema(
    {
        vol.Required("climate_entity_id"): _CLIMATE,
        vol.Required("day_kind"): vol.In((*DAY_KINDS, HOLIDAY_KIND)),
        vol.Required("bands"): cv.string,
    }
)


def _error(key: str, **placeholders: str) -> ServiceValidationError:
    return ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key=key,
        translation_placeholders=placeholders,
    )


def _program_error(err: ProgramError) -> ServiceValidationError:
    return _error("invalid_program", error=str(err))


def _raw_band(band: Band) -> dict[str, Any]:
    return {
        "start": text_from_minutes(band.start),
        "end": text_from_minutes(band.end),
        "mode": band.mode,
        "temperature": band.temperature,
        "preset": band.preset,
    }


def _manager(hass: HomeAssistant) -> Manager:
    entries = hass.config_entries.async_loaded_entries(DOMAIN)
    if not entries:
        raise _error("not_loaded")
    return entries[0].runtime_data.manager


def _bands(week: Any = None, holiday: Any = None):
    """Validate raw bands with ``program_from_dict`` and return (week, holiday)."""
    program = program_from_dict(
        {
            "id": "x",
            "name": "x",
            "week": week if week is not None else [[]] * DAYS_PER_WEEK,
            "holiday": holiday if holiday is not None else [],
        }
    )
    return program.week, program.holiday


async def async_create_program(
    store: CronoStore, name: str, week: Any, holiday: Any
) -> Program:
    """Validate the raw bands and create a program (shared with the WebSocket API)."""
    week_bands, holiday_bands = _bands(week, holiday)
    return await store.async_create_program(name, week_bands, holiday_bands)


async def async_update_program(
    store: CronoStore,
    program_id: str,
    *,
    name: str | None = None,
    week: Any = None,
    holiday: Any = None,
) -> Program:
    """Validate the raw bands and update a program (shared with the WebSocket API)."""
    week_bands, holiday_bands = _bands(week, holiday)
    return await store.async_update_program(
        program_id,
        name=name,
        week=week_bands if week is not None else None,
        holiday=holiday_bands if holiday is not None else None,
    )


def climate_exists(hass: HomeAssistant, climate_id: str) -> bool:
    """Whether the climate entity has a state or a registry entry."""
    return (
        hass.states.get(climate_id) is not None
        or er.async_get(hass).async_get(climate_id) is not None
    )


async def async_assign_room(manager: Manager, climate_id: str, program_id: str) -> None:
    """Assign a room to a program and align the controllers (shared)."""
    await manager.store.async_assign(climate_id, program_id)
    await manager.async_sync()


async def async_unassign_room(manager: Manager, climate_id: str) -> None:
    """Remove a room's assignment and align the controllers (shared)."""
    await manager.store.async_unassign(climate_id)
    await manager.async_sync()


async def _controller(manager: Manager, climate_id: str) -> RoomController:
    assigned = climate_id in manager.store.assignments
    if assigned:
        await manager.async_sync()  # the controller may not exist yet
    controller = manager.controllers.get(climate_id)
    if not assigned or controller is None:
        raise _error("room_not_assigned", entity_id=climate_id)
    return controller


async def async_set_day(
    hass: HomeAssistant,
    manager: Manager,
    climate_id: str,
    day_kind: str,
    bands_text: str,
) -> bool:
    """Replace the user bands of today's day of the room's (shared) program.

    ``day_kind`` is the day the caller believes it is editing; if the room's
    today is another one the call is refused (``stale_day``). The code of the
    last failed attempt of an assigned room is kept in ``manager.last_errors``
    (a success removes it) and the room sensor is told. Returns whether the
    program changed.
    """
    try:
        changed = await _set_day(manager, climate_id, day_kind, bands_text)
    except ServiceValidationError as err:
        if err.translation_key != "room_not_assigned":
            manager.last_errors[climate_id] = str(err.translation_key)
            async_dispatcher_send(hass, SIGNAL_ROOM_UPDATED.format(climate_id))
        raise
    if manager.last_errors.pop(climate_id, None) is not None:
        async_dispatcher_send(hass, SIGNAL_ROOM_UPDATED.format(climate_id))
    return changed


async def _set_day(
    manager: Manager, climate_id: str, day_kind: str, bands_text: str
) -> bool:
    controller = await _controller(manager, climate_id)
    today_kind = controller.today_kind()
    if day_kind != today_kind:
        raise _error("stale_day", day_kind=day_kind, today_kind=today_kind)
    try:
        bands = parse_bands(bands_text)
    except BandsTextError as err:
        raise _error("invalid_bands", detail=str(err)) from err
    store = manager.store
    program = store.programs[store.assignments[climate_id].program_id]
    new = tuple(bands)
    if day_kind == HOLIDAY_KIND:
        if program.holiday == new:
            return False
        fields = {"holiday": [_raw_band(b) for b in new]}
    else:
        index = DAY_KINDS.index(day_kind)
        if program.week[index] == new:
            return False
        week = [[_raw_band(b) for b in day] for day in program.week]
        week[index] = [_raw_band(b) for b in new]
        fields = {"week": week}
    try:
        await async_update_program(store, program.id, **fields)
    except ProgramError as err:
        raise _program_error(err) from err
    return True


def async_register_services(hass: HomeAssistant) -> None:
    """Register the integration services."""

    async def create_program(call: ServiceCall) -> ServiceResponse:
        store = _manager(hass).store
        try:
            program = await async_create_program(
                store, call.data["name"], call.data["week"], call.data["holiday"]
            )
        except ProgramError as err:
            raise _program_error(err) from err
        return {"program_id": program.id}

    async def update_program(call: ServiceCall) -> None:
        store = _manager(hass).store
        try:
            await async_update_program(
                store,
                call.data["program_id"],
                name=call.data.get("name"),
                week=call.data.get("week"),
                holiday=call.data.get("holiday"),
            )
        except ProgramError as err:
            raise _program_error(err) from err

    async def delete_program(call: ServiceCall) -> None:
        store = _manager(hass).store
        try:
            await store.async_delete_program(call.data["program_id"])
        except ProgramError as err:
            raise _program_error(err) from err

    async def assign(call: ServiceCall) -> None:
        manager = _manager(hass)
        climate_id = call.data["climate_entity_id"]
        if not climate_exists(hass, climate_id):
            raise _error("unknown_climate", entity_id=climate_id)
        try:
            await async_assign_room(manager, climate_id, call.data["program_id"])
        except ProgramError as err:
            raise _program_error(err) from err

    async def unassign(call: ServiceCall) -> None:
        await async_unassign_room(_manager(hass), call.data["climate_entity_id"])

    async def _set_paused(call: ServiceCall, paused: bool) -> None:
        manager = _manager(hass)
        climate_id = call.data["climate_entity_id"]
        await _controller(manager, climate_id)
        await manager.store.async_set_paused(climate_id, paused)

    async def pause(call: ServiceCall) -> None:
        await _set_paused(call, True)

    async def resume(call: ServiceCall) -> None:
        await _set_paused(call, False)

    async def set_manual(call: ServiceCall) -> None:
        controller = await _controller(
            _manager(hass), call.data["climate_entity_id"]
        )
        try:
            await controller.async_set_manual(
                call.data["mode"],
                call.data.get("temperature"),
                call.data.get("preset"),
            )
        except ProgramError as err:
            raise _program_error(err) from err

    async def resume_auto(call: ServiceCall) -> None:
        controller = await _controller(
            _manager(hass), call.data["climate_entity_id"]
        )
        await controller.async_resume_auto()

    async def set_day(call: ServiceCall) -> None:
        await async_set_day(
            hass,
            _manager(hass),
            call.data["climate_entity_id"],
            call.data["day_kind"],
            call.data["bands"],
        )

    reg = hass.services.async_register
    reg(DOMAIN, "create_program", create_program, CREATE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL)
    reg(DOMAIN, "update_program", update_program, UPDATE_SCHEMA)
    reg(DOMAIN, "delete_program", delete_program, DELETE_SCHEMA)
    reg(DOMAIN, "assign", assign, ASSIGN_SCHEMA)
    reg(DOMAIN, "unassign", unassign, ROOM_SCHEMA)
    reg(DOMAIN, "pause", pause, ROOM_SCHEMA)
    reg(DOMAIN, "resume", resume, ROOM_SCHEMA)
    reg(DOMAIN, "set_manual", set_manual, MANUAL_SCHEMA)
    reg(DOMAIN, "resume_auto", resume_auto, ROOM_SCHEMA)
    reg(DOMAIN, "set_day", set_day, SET_DAY_SCHEMA)
