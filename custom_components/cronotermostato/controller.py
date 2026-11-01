"""Room controller: applies the program of one ``climate`` entity.

Design decisions:

* Commands are sent only when needed: at start, after an explicit refresh
  (assignment, resume, program edit, thermostat back online, override
  start/end) the current setting is always applied; at a slot boundary it is
  applied only if (mode, preset, temperature) differ from what was applied last. Long
  slots are split every 31 days by the timeline, so a boundary does not mean
  a change and nothing is re-commanded then. There is no periodic command.
* All instants are compared in UTC: ``Timeline`` datetimes sharing a tzinfo
  compare by wall clock and ignore ``fold``.
* After a restart an active override is kept as it is and not re-sent: the
  thermostat already holds the forced state. An expired one is dropped and
  the current slot is applied.
* A paused room is never commanded, even by ``async_set_manual`` (the
  override is stored and takes effect on resume).
* Work triggered by synchronous listeners runs in tasks; evaluations are
  serialised by a lock. ``async_stop`` does not take the lock: ``_stopped`` is
  rechecked after every await that matters, so a stopped controller neither
  arms a timer nor sends a command.
* Unexpected exceptions (not only ``HomeAssistantError``) from a climate
  integration or from an evaluation never propagate: the room shows ``error``
  and the other rooms are unaffected. ``asyncio.CancelledError`` is not caught.

Known limits:

* A heat/cool setting outside the ``min_temp``/``max_temp`` of the climate
  (defaults 5-35 when it declares none) is not sent at all, neither mode nor
  temperature: status ``out_of_range``, one warning per change, retried at the
  next boundary or explicit refresh. ``off`` has no temperature. A band
  without a temperature (preset only) is never range-checked.
* A preset not listed in the ``preset_modes`` of the climate (``none`` is a
  valid preset when listed) is treated like an unsupported mode: nothing is
  sent, not even the mode, status ``unsupported_preset``, one warning per
  change. Commands go in the order mode, preset, temperature, each blocking;
  a failure stops the next ones. Some thermostats change the preset by
  themselves when they receive a temperature.
* After ``error`` the next attempt happens only at the next slot boundary, when
  the thermostat comes back, or on an explicit refresh. There is no periodic
  retry.
* An override whose command never went out (Home Assistant stopped between
  saving it and commanding) is treated after a restart as already held by the
  thermostat and is not re-sent.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
import logging
import math
from typing import Any, Literal

from homeassistant.const import ATTR_ENTITY_ID, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import Event, HomeAssistant, State, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import (
    EventStateChangedData,
    async_track_point_in_time,
    async_track_state_change_event,
)
from homeassistant.util import dt as dt_util

from .const import DEFAULT_MAX_TEMP, DEFAULT_MIN_TEMP, DOMAIN, SIGNAL_ROOM_UPDATED
from .engine.calendar import HolidayCalendar
from .engine.models import Mode, Program, ProgramError, validate_setting
from .engine.timeline import Slot, Timeline
from .store import CronoStore, Override

_LOGGER = logging.getLogger(__name__)

RoomStatus = Literal[
    "ok",
    "paused",
    "unassigned",
    "unavailable",
    "unsupported_mode",
    "unsupported_preset",
    "out_of_range",
    "missing",
    "error",
]


def _finite(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def temperature_limits(state: State | None) -> tuple[float, float]:
    """(min, max) of a climate: its ``min_temp``/``max_temp`` if both are
    finite numbers with min < max, otherwise the defaults."""
    if state is not None:
        low = _finite(state.attributes.get("min_temp"))
        high = _finite(state.attributes.get("max_temp"))
        if low is not None and high is not None and low < high:
            return low, high
    return DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP


@dataclass
class RoomState:
    """What a room is doing now."""

    program: Program | None = None
    slot: Slot | None = None
    next_slot: Slot | None = None
    manual: bool = False
    override_until: datetime | None = None
    status: RoomStatus = "unassigned"
    holiday: bool = False
    """The local date of today is a holiday (not ``slot.holiday``, which
    belongs to the first band of the merged slot)."""


class RoomController:
    """Applies a program to one climate entity."""

    def __init__(
        self,
        hass: HomeAssistant,
        store: CronoStore,
        calendar: HolidayCalendar,
        climate_id: str,
    ) -> None:
        self._hass = hass
        self._store = store
        self._calendar = calendar
        self._climate_id = climate_id
        self.state = RoomState()
        self._lock = asyncio.Lock()
        self._stopped = True
        self._unsub_store: Callable[[], None] | None = None
        self._unsub_state: Callable[[], None] | None = None
        self._unsub_timer: Callable[[], None] | None = None
        self._timeline: Timeline | None = None
        self._timeline_program: Program | None = None
        self._last_applied: tuple[Mode, str | None, float | None] | None = None
        self._signature: Any = None
        self._forced_evals = 0
        self._range_warned: tuple[Mode, float | None] | None = None
        self._preset_warned: tuple[Mode, str] | None = None

    # -- lifecycle -------------------------------------------------------

    async def async_start(self) -> None:
        """Listen to the store and the thermostat, and apply the program."""
        if not self._stopped:
            return
        self._stopped = False
        self._unsub_store = self._store.async_add_listener(self._store_changed)
        self._unsub_state = async_track_state_change_event(
            self._hass, [self._climate_id], self._climate_changed
        )
        await self._async_evaluate(force=True, rebuild=True, startup=True)

    async def async_stop(self) -> None:
        """Remove every listener and timer."""
        self._stopped = True
        if self._unsub_store:
            self._unsub_store()
            self._unsub_store = None
        if self._unsub_state:
            self._unsub_state()
            self._unsub_state = None
        self._cancel_timer()

    async def async_refresh(self) -> None:
        """Recompute everything and apply the current setting."""
        await self._async_evaluate(force=True, rebuild=True)

    # -- user actions ----------------------------------------------------

    async def async_set_manual(
        self, mode: Mode, temperature: float | None, preset: str | None = None
    ) -> None:
        """Force a setting until the end of the current slot."""
        if self._climate_id not in self._store.assignments:
            raise ProgramError(f"Room not assigned: {self._climate_id!r}")
        if mode == "off":
            temperature, preset = None, None
        validate_setting(mode, temperature, preset)
        if temperature is not None:
            low, high = temperature_limits(self._hass.states.get(self._climate_id))
            if not low <= temperature <= high:
                raise ServiceValidationError(
                    translation_domain=DOMAIN,
                    translation_key="temperature_out_of_range",
                    translation_placeholders={
                        "min": str(low),
                        "max": str(high),
                        "temperature": str(temperature),
                        "entity_id": self._climate_id,
                    },
                )
        timeline = self._get_timeline(rebuild=False)
        now = dt_util.utcnow()
        slot = timeline.slot_at(now.astimezone(dt_util.get_default_time_zone()))
        override = Override(mode, temperature, slot.end.astimezone(UTC), preset)
        seen = self._forced_evals
        try:
            await self._store.async_set_override(self._climate_id, override)
        except ProgramError:
            if self._climate_id in self._store.assignments:
                raise
            _LOGGER.debug("%s unassigned while setting manual", self._climate_id)
        await self._async_apply_now(seen)

    async def async_resume_auto(self) -> None:
        """Drop the override and apply the current slot."""
        seen = self._forced_evals
        await self._store.async_clear_override(self._climate_id)
        await self._async_apply_now(seen)

    async def _async_apply_now(self, seen: int) -> None:
        """Apply now, unless the store listener already did after ``seen``."""
        if self._forced_evals == seen:
            await self._async_evaluate(force=True)
        else:
            async with self._lock:  # wait for the evaluation in progress
                pass

    # -- listeners -------------------------------------------------------

    def _current_signature(self) -> Any:
        assignment = self._store.assignments.get(self._climate_id)
        if assignment is None:
            return None
        program = self._store.programs.get(assignment.program_id)
        bands = (program.week, program.holiday) if program else None
        return (
            assignment.program_id,
            assignment.paused,
            bands,
            self._store.overrides.get(self._climate_id),
        )

    @callback
    def _store_changed(self) -> None:
        if self._current_signature() != self._signature:
            # Count the forced evaluation now, not when the task gets the
            # lock: ``_async_apply_now`` must see it even if the task is still
            # queued behind an evaluation in progress (no double command).
            self._forced_evals += 1
            self._hass.async_create_task(
                self._async_evaluate(force=True, if_changed=True, counted=True)
            )

    @callback
    def _climate_changed(self, event: Event[EventStateChangedData]) -> None:
        old, new = event.data["old_state"], event.data["new_state"]
        if new is None or new.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            return
        if old is None or old.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            self._forced_evals += 1
            self._hass.async_create_task(
                self._async_evaluate(force=True, counted=True)
            )

    async def _async_timer(self, point: datetime) -> None:
        self._unsub_timer = None
        await self._async_evaluate(force=False, point=point)

    # -- core ------------------------------------------------------------

    def _cancel_timer(self) -> None:
        if self._unsub_timer:
            self._unsub_timer()
            self._unsub_timer = None

    def _get_timeline(self, *, rebuild: bool) -> Timeline:
        assignment = self._store.assignments[self._climate_id]
        program = self._store.programs[assignment.program_id]
        if rebuild or self._timeline is None or self._timeline_program != program:
            self._timeline = Timeline(
                program,
                self._calendar.is_holiday,
                dt_util.get_default_time_zone(),
            )
            self._timeline_program = program
        return self._timeline

    async def _async_evaluate(
        self,
        *,
        force: bool,
        rebuild: bool = False,
        startup: bool = False,
        point: datetime | None = None,
        if_changed: bool = False,
        counted: bool = False,
    ) -> None:
        async with self._lock:
            if self._stopped:
                return
            if if_changed and self._current_signature() == self._signature:
                return
            if force and not counted:
                self._forced_evals += 1
            try:
                await self._evaluate(force, rebuild, startup, point)
            except Exception:  # noqa: BLE001 - never propagate to callers/tasks
                _LOGGER.exception("Unexpected error evaluating %s", self._climate_id)
                self._last_applied = None
                if not self._stopped:
                    self._publish(replace(self.state, status="error"))

    async def _evaluate(
        self, force: bool, rebuild: bool, startup: bool, point: datetime | None
    ) -> None:
        store, cid = self._store, self._climate_id
        now = dt_util.utcnow()
        if point is not None:
            now = max(now, point.astimezone(UTC))
        self._cancel_timer()

        assignment = store.assignments.get(cid)
        if assignment is None:
            self._last_applied = None
            self._signature = self._current_signature()
            self._publish(RoomState())
            return

        tz = dt_util.get_default_time_zone()
        timeline = self._get_timeline(rebuild=rebuild)
        local_now = now.astimezone(tz)
        slot = timeline.slot_at(local_now)
        next_slot = timeline.slot_after(slot)
        override = store.overrides.get(cid)
        if override is not None and override.until.astimezone(UTC) <= now:
            await store.async_clear_override(cid)
            if self._stopped:
                return
            override, force = None, True
        self._signature = self._current_signature()

        if self._stopped:
            return
        deadline = slot.end.astimezone(UTC)
        if override is not None:
            deadline = min(deadline, override.until.astimezone(UTC))
        self._unsub_timer = async_track_point_in_time(
            self._hass, self._async_timer, deadline
        )

        status: RoomStatus
        cstate = self._hass.states.get(cid)
        if assignment.paused:
            status = "paused"
        elif cstate is None:
            status = "missing"
        elif cstate.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            status = "unavailable"
        else:
            status = "ok"

        if status != "ok":
            self._last_applied = None
        else:
            assert cstate is not None
            mode, preset, temperature = (
                (override.mode, override.preset, override.temperature)
                if override is not None
                else (slot.band.mode, slot.band.preset, slot.band.temperature)
            )
            key = (mode, preset, temperature)
            if startup and override is not None:
                self._last_applied = key  # already held by the thermostat
            elif force or key != self._last_applied:
                status = await self._apply(cstate, mode, preset, temperature)
                if self._stopped:
                    return
                self._last_applied = key if status == "ok" else None

        self._publish(
            RoomState(
                program=store.programs[assignment.program_id],
                slot=slot,
                next_slot=next_slot,
                manual=override is not None,
                override_until=override.until.astimezone(tz) if override else None,
                status=status,
                holiday=bool(self._calendar.is_holiday(local_now.date())),
            )
        )

    async def _apply(
        self,
        cstate: State,
        mode: Mode,
        preset: str | None,
        temperature: float | None,
    ) -> RoomStatus:
        if mode not in (cstate.attributes.get("hvac_modes") or []):
            _LOGGER.warning("%s does not support mode %s", self._climate_id, mode)
            return "unsupported_mode"
        if preset is not None:
            if preset not in (cstate.attributes.get("preset_modes") or []):
                if self._preset_warned != (mode, preset):
                    self._preset_warned = (mode, preset)
                    _LOGGER.warning(
                        "%s does not support preset %s, nothing sent",
                        self._climate_id, preset,
                    )
                return "unsupported_preset"
        self._preset_warned = None
        if temperature is not None:
            low, high = temperature_limits(cstate)
            if not low <= temperature <= high:
                if self._range_warned != (mode, temperature):
                    self._range_warned = (mode, temperature)
                    _LOGGER.warning(
                        "%s: %s °C is outside the thermostat limits %s-%s °C, "
                        "nothing sent",
                        self._climate_id, temperature, low, high,
                    )
                return "out_of_range"
        self._range_warned = None
        if self._stopped:
            return "error"
        try:
            await self._hass.services.async_call(
                "climate",
                "set_hvac_mode",
                {ATTR_ENTITY_ID: self._climate_id, "hvac_mode": mode},
                blocking=True,
            )
            if preset is not None and not self._stopped:
                await self._hass.services.async_call(
                    "climate",
                    "set_preset_mode",
                    {ATTR_ENTITY_ID: self._climate_id, "preset_mode": preset},
                    blocking=True,
                )
            if temperature is not None and not self._stopped:
                await self._hass.services.async_call(
                    "climate",
                    "set_temperature",
                    {ATTR_ENTITY_ID: self._climate_id, "temperature": temperature},
                    blocking=True,
                )
        except HomeAssistantError as err:  # includes ServiceValidationError
            _LOGGER.warning("Cannot command %s: %s", self._climate_id, err)
            return "error"
        except Exception:  # noqa: BLE001 - any integration may raise anything
            _LOGGER.exception("Unexpected error commanding %s", self._climate_id)
            return "error"
        return "ok"

    def _publish(self, state: RoomState) -> None:
        self.state = state
        async_dispatcher_send(
            self._hass, SIGNAL_ROOM_UPDATED.format(self._climate_id)
        )
