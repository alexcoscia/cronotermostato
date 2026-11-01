"""Pure data model for bands and programs (no Home Assistant imports)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import math
import re
from typing import Any, Literal

Mode = Literal["heat", "cool", "off"]

MODES: tuple[str, ...] = ("heat", "cool", "off")
MINUTES_PER_DAY = 1440
DAYS_PER_WEEK = 7

_TIME_RE = re.compile(r"^(\d{2}):(\d{2})$")


class ProgramError(ValueError):
    """Raised when a band or a program is not valid."""


@dataclass(frozen=True)
class Band:
    """A time band of a day, in minutes from midnight."""

    start: int
    end: int
    mode: Mode
    temperature: float | None = None
    auto: bool = False


@dataclass(frozen=True)
class Program:
    """A weekly program: seven days (Monday = 0) plus a holiday day."""

    id: str
    name: str
    week: tuple[tuple[Band, ...], ...]
    holiday: tuple[Band, ...]


def minutes_from_text(text: str) -> int:
    """Parse "HH:MM" (also "24:00") into minutes from midnight."""
    match = _TIME_RE.match(text) if isinstance(text, str) else None
    if match is None:
        raise ProgramError(f"Invalid time: {text!r}")
    hours, minutes = int(match.group(1)), int(match.group(2))
    total = hours * 60 + minutes
    if minutes > 59 or total > MINUTES_PER_DAY:
        raise ProgramError(f"Invalid time: {text!r}")
    return total


def text_from_minutes(m: int) -> str:
    """Format minutes from midnight (0..1440) as "HH:MM"."""
    if isinstance(m, bool) or not isinstance(m, int) or not 0 <= m <= MINUTES_PER_DAY:
        raise ProgramError(f"Invalid minutes: {m!r}")
    return f"{m // 60:02d}:{m % 60:02d}"


def _validate_band(band: Band) -> None:
    for value in (band.start, band.end):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ProgramError(f"Band times must be integers: {band}")
    if not 0 <= band.start < MINUTES_PER_DAY:
        raise ProgramError(f"Band start out of range: {band.start}")
    if not 0 < band.end <= MINUTES_PER_DAY:
        raise ProgramError(f"Band end out of range: {band.end}")
    if band.end <= band.start:
        raise ProgramError(f"Band end must be after start: {band}")
    if band.mode not in MODES:
        raise ProgramError(f"Unknown mode: {band.mode!r}")
    if band.mode == "off":
        if band.temperature is not None:
            raise ProgramError("Mode 'off' takes no temperature")
        return
    temp = band.temperature
    if temp is None:
        raise ProgramError(f"Mode {band.mode!r} needs a temperature")
    if isinstance(temp, bool) or not isinstance(temp, (int, float)):
        raise ProgramError(f"Temperature must be a number: {temp!r}")
    if not math.isfinite(temp):
        raise ProgramError(f"Temperature must be finite: {temp!r}")


def validate_bands(bands: Sequence[Band]) -> None:
    """Check each band and that no two bands overlap (adjacent is fine)."""
    for band in bands:
        _validate_band(band)
    ordered = sorted(bands, key=lambda b: b.start)
    for prev, nxt in zip(ordered, ordered[1:]):
        if nxt.start < prev.end:
            raise ProgramError(f"Overlapping bands: {prev} and {nxt}")


def _band_to_dict(band: Band) -> dict[str, Any]:
    return {
        "start": text_from_minutes(band.start),
        "end": text_from_minutes(band.end),
        "mode": band.mode,
        "temperature": band.temperature,
        "auto": band.auto,
    }


def _band_from_dict(d: Mapping[str, Any]) -> Band:
    try:
        temperature = d.get("temperature")
        auto = d.get("auto", False)
        if not isinstance(auto, bool):
            raise ProgramError(f"'auto' must be a boolean: {auto!r}")
        return Band(
            start=minutes_from_text(d["start"]),
            end=minutes_from_text(d["end"]),
            mode=d["mode"],
            temperature=temperature,
            auto=auto,
        )
    except (KeyError, TypeError, AttributeError) as err:
        raise ProgramError(f"Invalid band: {d!r}") from err


def _bands_from_list(items: Any) -> tuple[Band, ...]:
    if not isinstance(items, Sequence) or isinstance(items, (str, bytes)):
        raise ProgramError("Bands must be a list")
    bands = tuple(_band_from_dict(item) for item in items)
    validate_bands(bands)
    return tuple(sorted(bands, key=lambda b: b.start))


def program_to_dict(p: Program) -> dict[str, Any]:
    """Serialize a program (times as "HH:MM")."""
    return {
        "id": p.id,
        "name": p.name,
        "week": [[_band_to_dict(b) for b in day] for day in p.week],
        "holiday": [_band_to_dict(b) for b in p.holiday],
    }


def program_from_dict(d: Mapping[str, Any]) -> Program:
    """Build a validated program from its serialized form."""
    try:
        week_raw = d["week"]
        holiday_raw = d["holiday"]
        pid, name = d["id"], d["name"]
    except (KeyError, TypeError) as err:
        raise ProgramError(f"Invalid program: missing {err}") from err
    for label, value in (("id", pid), ("name", name)):
        if not isinstance(value, str) or not value.strip():
            raise ProgramError(f"Program {label} must be a non-empty string")
    if not isinstance(week_raw, Sequence) or len(week_raw) != DAYS_PER_WEEK:
        raise ProgramError(f"A program needs exactly {DAYS_PER_WEEK} days")
    return Program(
        id=pid,
        name=name,
        week=tuple(_bands_from_list(day) for day in week_raw),
        holiday=_bands_from_list(holiday_raw),
    )
