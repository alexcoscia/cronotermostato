"""Day normalization: fill the gaps with automatic "off" bands."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from typing import Any

from .models import MINUTES_PER_DAY, Band, Program, program_to_dict, validate_bands


def normalize_day(bands: Sequence[Band]) -> tuple[Band, ...]:
    """Return sorted bands covering 0..1440 with no gaps.

    Gaps become automatic bands: mode "off", no temperature, auto=True.
    """
    validate_bands(bands)
    result: list[Band] = []
    cursor = 0
    for band in sorted(bands, key=lambda b: b.start):
        if band.start > cursor:
            result.append(Band(cursor, band.start, "off", None, auto=True))
        result.append(band)
        cursor = band.end
    if cursor < MINUTES_PER_DAY:
        result.append(Band(cursor, MINUTES_PER_DAY, "off", None, auto=True))
    return tuple(result)


def program_views(program: Program) -> dict[str, Any]:
    """Serialize a program twice: the user's bands and the normalized ones.

    ``week``/``holiday`` hold only what the user saved; ``week_full`` and
    ``holiday_full`` add the automatic "off" bands.
    """
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
    }
