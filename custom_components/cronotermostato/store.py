"""Persistent store for programs, room assignments and manual overrides.

Design decisions:

* Program ids are the slug of the name (lowercase ASCII, ``_`` separated),
  with ``_2``, ``_3``... appended on conflict, or ``programma`` when the
  name has no usable characters. The id is generated once and never changes
  on rename, so assignments and entity unique ids stay stable.
* Only the user's bands are stored. Bands with ``auto=True`` (computed
  ``off`` fillers) are silently discarded on create/update: they are always
  recomputed by ``normalize_day``, so accepting them is harmless.
* Every change is saved immediately with ``Store.async_save`` (no delayed
  save), so nothing is lost on a crash and a new ``CronoStore`` on the same
  ``hass`` always reads the latest data.
* Override ``until`` is stored as an ISO string in UTC and read back as an
  aware UTC datetime; compare instants, not wall-clock times.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
import logging
import re
import unicodedata
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .engine.models import (
    DAYS_PER_WEEK,
    Band,
    Mode,
    Program,
    ProgramError,
    program_from_dict,
    program_to_dict,
    validate_bands,
)

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1


@dataclass
class Assignment:
    """A room assigned to a program."""

    program_id: str
    paused: bool = False


@dataclass
class Override:
    """A manual override that lasts until ``until`` (aware datetime)."""

    mode: Mode
    temperature: float | None
    until: datetime


def _slug(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_") or "programma"


def _user_bands(bands: Sequence[Band]) -> tuple[Band, ...]:
    """Validate and keep only the user's bands (automatic ones are dropped)."""
    kept = tuple(sorted((b for b in bands if not b.auto), key=lambda b: b.start))
    validate_bands(kept)
    return kept


def _clean_week(week: Sequence[Sequence[Band]]) -> tuple[tuple[Band, ...], ...]:
    if len(week) != DAYS_PER_WEEK:
        raise ProgramError(f"A program needs exactly {DAYS_PER_WEEK} days")
    return tuple(_user_bands(day) for day in week)


def _clean_name(name: Any) -> str:
    if not isinstance(name, str) or not name.strip():
        raise ProgramError("Program name must be a non-empty string")
    return name.strip()


class CronoStore:
    """Programs, assignments (key = climate entity_id) and overrides."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, DOMAIN)
        self._listeners: list[Callable[[], None]] = []
        self.programs: dict[str, Program] = {}
        self.assignments: dict[str, Assignment] = {}
        self.overrides: dict[str, Override] = {}

    # -- persistence -----------------------------------------------------

    async def async_load(self) -> None:
        """Load data from disk, dropping anything inconsistent."""
        data = await self._store.async_load() or {}
        self.programs = {}
        for raw in data.get("programs", []):
            try:
                prog = program_from_dict(raw)
            except ProgramError as err:
                _LOGGER.warning("Ignoring invalid stored program: %s", err)
                continue
            self.programs[prog.id] = prog
        self.assignments = {}
        for climate_id, raw in data.get("assignments", {}).items():
            if raw.get("program_id") in self.programs:
                self.assignments[climate_id] = Assignment(
                    raw["program_id"], bool(raw.get("paused", False))
                )
        self.overrides = {}
        for climate_id, raw in data.get("overrides", {}).items():
            if climate_id not in self.assignments:
                continue
            try:
                until = datetime.fromisoformat(raw["until"])
                if until.tzinfo is None:
                    raise ValueError("naive datetime")
                override = Override(
                    raw["mode"], raw.get("temperature"), until.astimezone(UTC)
                )
                self._check_override(override)
            except (KeyError, TypeError, ValueError, ProgramError) as err:
                _LOGGER.warning("Ignoring invalid stored override: %s", err)
                continue
            self.overrides[climate_id] = override

    def _serialize(self) -> dict[str, Any]:
        return {
            "programs": [program_to_dict(p) for p in self.programs.values()],
            "assignments": {
                cid: {"program_id": a.program_id, "paused": a.paused}
                for cid, a in self.assignments.items()
            },
            "overrides": {
                cid: {
                    "mode": o.mode,
                    "temperature": o.temperature,
                    "until": o.until.astimezone(UTC).isoformat(),
                }
                for cid, o in self.overrides.items()
            },
        }

    async def _async_changed(self) -> None:
        await self._store.async_save(self._serialize())
        for listener in list(self._listeners):
            try:
                listener()
            except Exception:  # noqa: BLE001
                _LOGGER.exception("Error in store listener")

    def async_add_listener(self, cb: Callable[[], None]) -> Callable[[], None]:
        """Call ``cb`` on every change; returns the remover."""
        self._listeners.append(cb)

        def remove() -> None:
            if cb in self._listeners:
                self._listeners.remove(cb)

        return remove

    # -- programs --------------------------------------------------------

    def _new_id(self, name: str) -> str:
        base = _slug(name)
        candidate, n = base, 2
        while candidate in self.programs:
            candidate = f"{base}_{n}"
            n += 1
        return candidate

    async def async_create_program(
        self,
        name: str,
        week: Sequence[Sequence[Band]],
        holiday: Sequence[Band],
    ) -> Program:
        """Create a program with a generated id."""
        name = _clean_name(name)
        prog = Program(self._new_id(name), name, _clean_week(week), _user_bands(holiday))
        self.programs[prog.id] = prog
        await self._async_changed()
        return prog

    async def async_update_program(
        self,
        program_id: str,
        *,
        name: str | None = None,
        week: Sequence[Sequence[Band]] | None = None,
        holiday: Sequence[Band] | None = None,
    ) -> Program:
        """Update the given fields of a program."""
        prog = self._get(program_id)
        changes: dict[str, Any] = {}
        if name is not None:
            changes["name"] = _clean_name(name)
        if week is not None:
            changes["week"] = _clean_week(week)
        if holiday is not None:
            changes["holiday"] = _user_bands(holiday)
        prog = replace(prog, **changes)
        self.programs[program_id] = prog
        await self._async_changed()
        return prog

    async def async_delete_program(self, program_id: str) -> None:
        """Delete a program that has no rooms."""
        self._get(program_id)
        rooms = [c for c, a in self.assignments.items() if a.program_id == program_id]
        if rooms:
            raise ProgramError(
                f"Program {program_id!r} is assigned to: {', '.join(sorted(rooms))}"
            )
        del self.programs[program_id]
        await self._async_changed()

    def _get(self, program_id: str) -> Program:
        try:
            return self.programs[program_id]
        except KeyError:
            raise ProgramError(f"Unknown program: {program_id!r}") from None

    # -- assignments -----------------------------------------------------

    async def async_assign(self, climate_id: str, program_id: str) -> None:
        """Assign a room to a program (replaces a previous assignment)."""
        self._get(program_id)
        old = self.assignments.get(climate_id)
        self.assignments[climate_id] = Assignment(
            program_id, old.paused if old else False
        )
        if old and old.program_id != program_id:
            self.overrides.pop(climate_id, None)
        await self._async_changed()

    async def async_unassign(self, climate_id: str) -> None:
        """Remove a room's assignment and its override."""
        if climate_id not in self.assignments and climate_id not in self.overrides:
            return
        self.assignments.pop(climate_id, None)
        self.overrides.pop(climate_id, None)
        await self._async_changed()

    async def async_set_paused(self, climate_id: str, paused: bool) -> None:
        """Pause or resume an assigned room."""
        self._assignment(climate_id).paused = paused
        await self._async_changed()

    def _assignment(self, climate_id: str) -> Assignment:
        try:
            return self.assignments[climate_id]
        except KeyError:
            raise ProgramError(f"Room not assigned: {climate_id!r}") from None

    # -- overrides -------------------------------------------------------

    @staticmethod
    def _check_override(override: Override) -> None:
        if override.until.tzinfo is None:
            raise ProgramError("Override end must be timezone-aware")
        # reuse band validation for mode/temperature rules
        validate_bands([Band(0, 1, override.mode, override.temperature)])

    async def async_set_override(self, climate_id: str, override: Override) -> None:
        """Set the manual override of an assigned room."""
        self._assignment(climate_id)
        self._check_override(override)
        self.overrides[climate_id] = replace(
            override, until=override.until.astimezone(UTC)
        )
        await self._async_changed()

    async def async_clear_override(self, climate_id: str) -> None:
        """Remove the manual override of a room (no-op if none)."""
        if self.overrides.pop(climate_id, None) is not None:
            await self._async_changed()
