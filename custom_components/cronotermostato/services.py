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

from .const import DOMAIN
from .controller import RoomController
from .engine.models import MODES, DAYS_PER_WEEK, ProgramError, program_from_dict
from .manager import Manager

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


def _error(key: str, **placeholders: str) -> ServiceValidationError:
    return ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key=key,
        translation_placeholders=placeholders,
    )


def _program_error(err: ProgramError) -> ServiceValidationError:
    return _error("invalid_program", error=str(err))


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


async def _controller(manager: Manager, climate_id: str) -> RoomController:
    assigned = climate_id in manager.store.assignments
    if assigned:
        await manager.async_sync()  # the controller may not exist yet
    controller = manager.controllers.get(climate_id)
    if not assigned or controller is None:
        raise _error("room_not_assigned", entity_id=climate_id)
    return controller


def async_register_services(hass: HomeAssistant) -> None:
    """Register the integration services."""

    async def create_program(call: ServiceCall) -> ServiceResponse:
        store = _manager(hass).store
        try:
            week, holiday = _bands(call.data["week"], call.data["holiday"])
            program = await store.async_create_program(
                call.data["name"], week, holiday
            )
        except ProgramError as err:
            raise _program_error(err) from err
        return {"program_id": program.id}

    async def update_program(call: ServiceCall) -> None:
        store = _manager(hass).store
        try:
            week, holiday = _bands(call.data.get("week"), call.data.get("holiday"))
            await store.async_update_program(
                call.data["program_id"],
                name=call.data.get("name"),
                week=week if "week" in call.data else None,
                holiday=holiday if "holiday" in call.data else None,
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
        if (
            hass.states.get(climate_id) is None
            and er.async_get(hass).async_get(climate_id) is None
        ):
            raise _error("unknown_climate", entity_id=climate_id)
        try:
            await manager.store.async_assign(climate_id, call.data["program_id"])
        except ProgramError as err:
            raise _program_error(err) from err
        await manager.async_sync()

    async def unassign(call: ServiceCall) -> None:
        manager = _manager(hass)
        await manager.store.async_unassign(call.data["climate_entity_id"])
        await manager.async_sync()

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
