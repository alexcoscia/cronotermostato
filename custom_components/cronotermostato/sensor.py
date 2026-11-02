"""Sensors: the program of each room and the definition of each program."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_time_change
from homeassistant.util import dt as dt_util

from . import CronoConfigEntry, CronoData
from .const import SIGNAL_ROOMS_CHANGED
from .engine.bands_text import band_problem
from .engine.day import program_views
from .engine.models import Mode, Program, program_revision
from .engine.timeline import Slot
from .entity import EntityTracker, RoomEntity, slot_dict


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


MODE_CODES: dict[Mode, int] = {"off": 0, "heat": 1, "cool": 2}
"""Numeric modes of the flat attributes (``today_mode``, ``slot_mode``...)."""

# Tessera copies a list into the tile only if it holds texts or numbers: a list
# of booleans is dropped, so ``today_auto`` holds 0/1.
NO_TEMPERATURE = -100.0
"""``today_temp`` value of a band without temperature (``off``, or a preset
only): far below any thermostat, so a tile that reads only numbers can tell it
from a setpoint (``value <= -100``). The ``slot_temp``/``next_temp`` attributes
use ``None`` instead."""

TILE_ATTRIBUTES = frozenset(
    {
        "today_start", "today_end", "today_mode", "today_temp", "today_auto",
        "slot_mode", "slot_temp", "slot_start_time", "slot_end_time",
        "next_mode", "next_temp", "next_start_time", "override_until_time",
    }
)

EDIT_ATTRIBUTES = frozenset(
    {
        "program_name", "program_rooms", "today_kind", "last_error",
        "today_preset", "today_locked", "edit_info", "edit_seq", "edit_n",
        "today_flags",
    }
)
"""Flat attributes for editing today's bands from a display: the shared
program, how many rooms use it, which day is edited (``mon`` .. ``sun`` or
``holiday``) and the code of the last refused ``set_day`` of the room.
``edit_info`` packs the same facts plus the revision of the program into one
text for displays that read few attributes:
``<today_kind>;<program_rooms>;<program_revision>;<last_error>`` (an empty
field when missing; the revision is 12 hex characters, never a ``;``; the
error is a short code, see ``EDIT_ERROR_CODES``). ``edit_seq`` counts the
refused ``set_day`` attempts of the room (so a repeated refusal changes the
state), ``edit_n`` is the length of the ``today_*`` lists and ``today_flags``
packs ``today_auto`` (bit 1) and ``today_locked`` (bit 2)."""


EDIT_ERROR_CODES = {"temperature_out_of_range": "temp_range"}
"""Short codes used inside ``edit_info`` (the Tessera core cuts texts at 48
characters); ``last_error`` keeps the long code."""


def edit_info(kind: str, rooms: int, revision: str, error: str | None) -> str:
    """``<today_kind>;<program_rooms>;<program_revision>;<error>`` (max 40 chars)."""
    code = EDIT_ERROR_CODES.get(error or "", error or "")
    return f"{kind};{rooms};{revision};{code}"


def _iso(moment: datetime | None) -> str | None:
    return moment.isoformat() if moment else None


def _slot_flat(slot: Slot | None, prefix: str, time_key: str) -> dict[str, Any]:
    """``<prefix>_mode``, ``<prefix>_temp`` and the start time of a slot."""
    return {
        f"{prefix}_mode": MODE_CODES[slot.band.mode] if slot else None,
        f"{prefix}_temp": slot.band.temperature if slot else None,
        time_key: _iso(slot.start) if slot else None,
    }


class RoomProgramSensor(RoomEntity, SensorEntity):
    """State: name of the program of the room."""

    _attr_translation_key = "program"
    _suffix = "program"
    ENTITY_DOMAIN = "sensor"
    _unrecorded_attributes = (
        frozenset({"slot", "next_slot"}) | TILE_ATTRIBUTES | EDIT_ATTRIBUTES
    )

    def __init__(self, hass: HomeAssistant, data: CronoData, climate_id: str) -> None:
        super().__init__(hass, data, climate_id, "programma")

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        # Bands that merge over midnight give no slot change at the day change,
        # yet the bands of "today" do change. The state machine ignores a
        # write that changes nothing, so this costs one write a day at most.
        self.async_on_remove(
            async_track_time_change(
                self.hass, self._midnight, hour=0, minute=0, second=0
            )
        )

    @callback
    def _midnight(self, _now: datetime) -> None:
        # A refused attempt of yesterday says nothing about the new day.
        self._data.manager.last_errors.pop(self._climate_id, None)
        self.async_write_ha_state()

    def _today(self) -> dict[str, list[Any]]:
        """Bands of the local date of today, as parallel flat lists."""
        controller = self.controller
        bands = (
            controller.day_bands(dt_util.now().date()) if controller else ()
        )
        locked = [int(not b.auto and band_problem(b) is not None) for b in bands]
        return {
            "today_start": [b.start for b in bands],
            "today_end": [b.end for b in bands],
            "today_mode": [MODE_CODES[b.mode] for b in bands],
            "today_temp": [
                NO_TEMPERATURE if b.temperature is None else b.temperature
                for b in bands
            ],
            "today_auto": [int(b.auto) for b in bands],
            "today_preset": [b.preset or "" for b in bands],
            "today_locked": locked,
            "today_flags": [
                int(b.auto) | (flag << 1) for b, flag in zip(bands, locked)
            ],
            "edit_n": len(bands),
        }

    @property
    def _program(self) -> Program | None:
        store = self._data.store
        assignment = store.assignments.get(self._climate_id)
        return store.programs.get(assignment.program_id) if assignment else None

    @property
    def native_value(self) -> str | None:
        program = self._program
        return program.name if program else None

    def _edit(self, controller: Any) -> dict[str, Any]:
        program = self._program
        rooms = sum(
            1
            for a in self._data.store.assignments.values()
            if program and a.program_id == program.id
        )
        kind = controller.today_kind()
        error = self._data.manager.last_errors.get(self._climate_id)
        revision = program_revision(program) if program else ""
        return {
            "program_name": program.name if program else None,
            "program_rooms": rooms,
            "today_kind": kind,
            "last_error": error,
            "edit_info": edit_info(kind, rooms, revision, error),
            "edit_seq": self._data.manager.error_seq.get(self._climate_id, 0),
        }

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        controller = self.controller
        if controller is None:
            return None
        state = controller.state
        slot = state.slot
        return {
            "slot": slot_dict(slot),
            "next_slot": slot_dict(state.next_slot),
            "slot_end": slot.end.isoformat() if slot else None,
            "manual": state.manual,
            "override_until": (
                state.override_until.isoformat() if state.override_until else None
            ),
            "auto_slot": slot.band.auto if slot else None,
            "holiday": controller.is_holiday_today(),
            "status": state.status,
            **self._today(),
            **_slot_flat(slot, "slot", "slot_start_time"),
            "slot_end_time": _iso(slot.end) if slot else None,
            **_slot_flat(state.next_slot, "next", "next_start_time"),
            "override_until_time": _iso(state.override_until),
            **self._edit(controller),
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
        return {**program_views(self._program), "rooms": self._rooms}

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._data.store.async_add_listener(self._changed))

    @callback
    def _changed(self) -> None:
        if self.available:
            self._attr_translation_placeholders = {"name": self._program.name}
        self.async_write_ha_state()
