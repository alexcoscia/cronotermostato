"""Sensors: the program of each room and the definition of each program."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import CronoConfigEntry, CronoData
from .const import SIGNAL_ROOMS_CHANGED
from .engine.day import normalize_day
from .engine.models import Program, program_to_dict
from .engine.timeline import Slot
from .entity import EntityTracker, RoomEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: CronoConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Track the room sensors (manager) and the program sensors (store)."""
    data = entry.runtime_data

    def wanted() -> dict[str, Any]:
        result: dict[str, Any] = {}
        for climate_id in data.manager.controllers:
            result[f"{climate_id}_program"] = (
                lambda c=climate_id: RoomProgramSensor(hass, data, c)
            )
        for program_id in data.store.programs:
            result[f"program_{program_id}"] = (
                lambda p=program_id: ProgramSensor(data, p)
            )
        return result

    tracker = EntityTracker(hass, entry, "sensor", wanted, async_add_entities)
    entry.async_on_unload(
        async_dispatcher_connect(hass, SIGNAL_ROOMS_CHANGED, tracker.reconcile)
    )
    entry.async_on_unload(data.store.async_add_listener(tracker.reconcile))
    tracker.reconcile()


def _slot_dict(slot: Slot | None) -> dict[str, Any] | None:
    if slot is None:
        return None
    return {
        "start": slot.start.isoformat(),
        "end": slot.end.isoformat(),
        "mode": slot.band.mode,
        "temperature": slot.band.temperature,
        "auto": slot.band.auto,
    }


class RoomProgramSensor(RoomEntity, SensorEntity):
    """State: name of the program of the room."""

    _attr_translation_key = "program"
    _suffix = "program"
    ENTITY_DOMAIN = "sensor"
    _unrecorded_attributes = frozenset({"slot", "next_slot"})

    def __init__(self, hass: HomeAssistant, data: CronoData, climate_id: str) -> None:
        super().__init__(hass, data, climate_id, "programma")

    @property
    def native_value(self) -> str | None:
        assignment = self._data.store.assignments.get(self._climate_id)
        program = (
            self._data.store.programs.get(assignment.program_id)
            if assignment
            else None
        )
        return program.name if program else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        controller = self.controller
        if controller is None:
            return None
        state = controller.state
        slot = state.slot
        return {
            "slot": _slot_dict(slot),
            "next_slot": _slot_dict(state.next_slot),
            "slot_end": slot.end.isoformat() if slot else None,
            "manual": state.manual,
            "override_until": (
                state.override_until.isoformat() if state.override_until else None
            ),
            "auto_slot": slot.band.auto if slot else None,
            "holiday": state.holiday,
            "status": state.status,
        }


class ProgramSensor(SensorEntity):
    """The definition of a program; state: number of rooms using it."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "program_definition"
    _unrecorded_attributes = frozenset(
        {"week", "holiday", "week_full", "holiday_full"}
    )

    def __init__(self, data: CronoData, program_id: str) -> None:
        self._data = data
        self._program_id = program_id
        self._attr_unique_id = f"program_{program_id}"
        self.entity_id = f"sensor.programma_{program_id}"
        self._attr_translation_placeholders = {"name": self._program.name}

    @property
    def name(self) -> str | None:
        """Not cached: the name follows the renames of the program."""
        if not self.platform_data:
            return self._name_internal(None, {})
        return self._name_internal(
            self._device_class_name, self.platform_data.platform_translations
        )

    @property
    def _program(self) -> Program:
        return self._data.store.programs[self._program_id]

    @property
    def available(self) -> bool:
        return self._program_id in self._data.store.programs

    @property
    def _rooms(self) -> list[str]:
        return sorted(
            climate_id
            for climate_id, a in self._data.store.assignments.items()
            if a.program_id == self._program_id
        )

    @property
    def native_value(self) -> int | None:
        return len(self._rooms) if self.available else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        if not self.available:
            return None
        program = self._program
        full = program_to_dict(
            replace(
                program,
                week=tuple(normalize_day(day) for day in program.week),
                holiday=normalize_day(program.holiday),
            )
        )
        user = program_to_dict(program)
        return {
            "program_id": program.id,
            "name": program.name,
            "week": user["week"],
            "holiday": user["holiday"],
            "week_full": full["week"],
            "holiday_full": full["holiday"],
            "rooms": self._rooms,
        }

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._data.store.async_add_listener(self._changed))

    @callback
    def _changed(self) -> None:
        if self.available:
            self._attr_translation_placeholders = {"name": self._program.name}
        self.async_write_ha_state()
