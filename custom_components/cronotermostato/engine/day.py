"""Day normalization: fill the gaps with automatic "off" bands."""

from __future__ import annotations

from collections.abc import Sequence

from .models import MINUTES_PER_DAY, Band, validate_bands


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
