"""Pure data model for bands and programs (no Home Assistant imports)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import hashlib
import json
import math
import re
from typing import Any, Literal

Mode = Literal["heat", "cool", "off"]

MODES: tuple[str, ...] = ("heat", "cool", "off")
MINUTES_PER_DAY = 1440
DAYS_PER_WEEK = 7

_TIME_RE = re.compile(r"([0-9]{2}):([0-9]{2})")


class ProgramError(ValueError):
    """Raised when a band or a program is not valid.

    ``code`` is a stable identifier of the kind of error, shared with the
    editor's JavaScript validation (``frontend/lib/validate.js``): ``bad_time``,
    ``end_before_start``, ``overlap``, ``bad_mode``, ``missing_setting``,
    ``off_with_setting``, ``bad_temperature``, ``bad_preset``, ``bad_band``,
    ``bad_program``. Errors that are not about the content of a program (an
    unknown program or room, a deletion refused) use ``invalid`` or a code of
    their own. The message is for people and may change; the code may not.
    """

    def __init__(self, message: str, code: str = "invalid") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Band:
    """A time band of a day, in minutes from midnight."""

    start: int
    end: int
    mode: Mode
    temperature: float | None = None
    auto: bool = False
    preset: str | None = None


@dataclass(frozen=True)
class Program:
    """A weekly program: seven days (Monday = 0) plus a holiday day."""

    id: str
    name: str
    week: tuple[tuple[Band, ...], ...]
    holiday: tuple[Band, ...]


def minutes_from_text(text: str) -> int:
    """Parse "HH:MM" (also "24:00") into minutes from midnight."""
    match = _TIME_RE.fullmatch(text) if isinstance(text, str) else None
    if match is None:
        raise ProgramError(f"Invalid time: {text!r}", "bad_time")
    hours, minutes = int(match.group(1)), int(match.group(2))
    total = hours * 60 + minutes
    if minutes > 59 or total > MINUTES_PER_DAY:
        raise ProgramError(f"Invalid time: {text!r}", "bad_time")
    return total


def text_from_minutes(m: int) -> str:
    """Format minutes from midnight (0..1440) as "HH:MM"."""
    if isinstance(m, bool) or not isinstance(m, int) or not 0 <= m <= MINUTES_PER_DAY:
        raise ProgramError(f"Invalid minutes: {m!r}", "bad_time")
    return f"{m // 60:02d}:{m % 60:02d}"


def _validate_band(band: Band) -> None:
    for value in (band.start, band.end):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ProgramError(f"Band times must be integers: {band}", "bad_time")
    if not 0 <= band.start < MINUTES_PER_DAY:
        raise ProgramError(f"Band start out of range: {band.start}", "bad_time")
    if not 0 < band.end <= MINUTES_PER_DAY:
        raise ProgramError(f"Band end out of range: {band.end}", "bad_time")
    if band.end <= band.start:
        raise ProgramError(
            f"Band end must be after start: {band}", "end_before_start"
        )
    validate_setting(band.mode, band.temperature, band.preset)


def validate_setting(mode: str, temperature: Any, preset: Any) -> None:
    """Check a (mode, temperature, preset) triple.

    ``off`` takes neither temperature nor preset; ``heat``/``cool`` need at
    least one of them (both are allowed). A preset is a non-blank string.
    """
    if mode not in MODES:
        raise ProgramError(f"Unknown mode: {mode!r}", "bad_mode")
    if preset is not None and (not isinstance(preset, str) or not preset.strip()):
        raise ProgramError(
            f"Preset must be a non-empty string: {preset!r}", "bad_preset"
        )
    if mode == "off":
        if temperature is not None:
            raise ProgramError("Mode 'off' takes no temperature", "off_with_setting")
        if preset is not None:
            raise ProgramError("Mode 'off' takes no preset", "off_with_setting")
        return
    if temperature is None:
        if preset is None:
            raise ProgramError(
                f"Mode {mode!r} needs a temperature or a preset", "missing_setting"
            )
        return
    if isinstance(temperature, bool) or not isinstance(temperature, (int, float)):
        raise ProgramError(
            f"Temperature must be a number: {temperature!r}", "bad_temperature"
        )
    try:
        finite = math.isfinite(temperature)
    except OverflowError:  # an int too large for a float, e.g. 10**400
        finite = False
    if not finite:
        raise ProgramError(
            f"Temperature must be finite: {str(temperature)[:40]}", "bad_temperature"
        )


def validate_bands(bands: Sequence[Band]) -> None:
    """Check each band and that no two bands overlap (adjacent is fine)."""
    for band in bands:
        _validate_band(band)
    ordered = sorted(bands, key=lambda b: b.start)
    for prev, nxt in zip(ordered, ordered[1:]):
        if nxt.start < prev.end:
            raise ProgramError(f"Overlapping bands: {prev} and {nxt}", "overlap")


def _band_to_dict(band: Band) -> dict[str, Any]:
    return {
        "start": text_from_minutes(band.start),
        "end": text_from_minutes(band.end),
        "mode": band.mode,
        "temperature": band.temperature,
        "auto": band.auto,
        "preset": band.preset,
    }


def _band_from_dict(d: Mapping[str, Any]) -> Band:
    try:
        temperature = d.get("temperature")
        auto = d.get("auto", False)
        if not isinstance(auto, bool):
            raise ProgramError(f"'auto' must be a boolean: {auto!r}", "bad_band")
        return Band(
            start=minutes_from_text(d["start"]),
            end=minutes_from_text(d["end"]),
            mode=d["mode"],
            temperature=temperature,
            auto=auto,
            preset=d.get("preset"),
        )
    except (KeyError, TypeError, AttributeError) as err:
        raise ProgramError(f"Invalid band: {d!r}", "bad_band") from err


def _bands_from_list(items: Any) -> tuple[Band, ...]:
    if not isinstance(items, Sequence) or isinstance(items, (str, bytes)):
        raise ProgramError("Bands must be a list", "bad_band")
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


def program_revision(p: Program) -> str:
    """Short fingerprint of a program's content (for optimistic concurrency).

    First 12 hex characters of the SHA-1 of the canonical JSON (sorted keys)
    of ``program_to_dict`` with every temperature coerced to float (19 and
    19.0 are the same content): equal programs have equal revisions.
    """
    data = program_to_dict(p)
    for band in (*(b for day in data["week"] for b in day), *data["holiday"]):
        if band["temperature"] is not None:
            band["temperature"] = float(band["temperature"])
    canonical = json.dumps(
        data, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha1(canonical.encode(), usedforsecurity=False).hexdigest()[:12]


def program_from_dict(d: Mapping[str, Any]) -> Program:
    """Build a validated program from its serialized form."""
    try:
        week_raw = d["week"]
        holiday_raw = d["holiday"]
        pid, name = d["id"], d["name"]
    except (KeyError, TypeError) as err:
        raise ProgramError(f"Invalid program: missing {err}", "bad_program") from err
    for label, value in (("id", pid), ("name", name)):
        if not isinstance(value, str) or not value.strip():
            raise ProgramError(
                f"Program {label} must be a non-empty string", "bad_program"
            )
    if not isinstance(week_raw, Sequence) or len(week_raw) != DAYS_PER_WEEK:
        raise ProgramError(
            f"A program needs exactly {DAYS_PER_WEEK} days", "bad_program"
        )
    return Program(
        id=pid,
        name=name,
        week=tuple(_bands_from_list(day) for day in week_raw),
        holiday=_bands_from_list(holiday_raw),
    )
