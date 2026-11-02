"""Compact text form of the user bands of one day (no Home Assistant imports).

Grammar (what the ``set_day`` service accepts in ``bands``)::

    bands  := ""  |  band ( ";" band )* [ ";" ]
    band   := time "-" time  mode  { temp | "preset=" NAME }
    time   := H:MM | HH:MM            (00:00 .. 24:00; 24:00 only as an end)
    mode   := heat | cool | off       (case-insensitive)
    temp   := digits [ ("." | ",") 1-2 digits ]     (at most 3 integer digits)
    NAME   := 1-40 characters of [A-Za-z0-9_-]

White space (spaces, tabs, new lines) is free between tokens. ``heat`` and
``cool`` need a temperature, a preset or both (in any order, each at most
once); ``off`` takes neither. The empty text means a day without user bands
(the automatic ``off`` bands are computed, never written). Bands may be given
in any order; they must not overlap (adjacent is fine).

Only the syntax and the content of the bands are checked here; the temperature
range of the thermostat is checked when the setting is applied.
"""

from __future__ import annotations

from collections.abc import Sequence
import re

from .models import MINUTES_PER_DAY, MODES, Band, Mode, text_from_minutes

MAX_LENGTH = 1024
"""Longest accepted text, in characters."""
MAX_BANDS = 24
"""Most bands in a day. The engine has no limit of its own (a day holds up to
1440 one-minute bands); this one keeps the text, the display and the tile
manageable."""

_FLAGS = re.ASCII  # ASCII digits and white space only
_HEAD = re.compile(
    r"\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})(?=\s|$)\s*", _FLAGS
)
_TOKEN = re.compile(r"\S+", _FLAGS)
_TEMP = re.compile(r"\d{1,3}(?:[.,]\d{1,2})?", _FLAGS)
_PRESET = re.compile(r"preset=([A-Za-z0-9_-]{1,40})", _FLAGS | re.IGNORECASE)


class BandsTextError(ValueError):
    """The text is not valid; ``band`` (1-based) and ``column`` (1-based
    character of the whole text) say where. The message includes both."""

    def __init__(self, message: str, band: int | None, column: int) -> None:
        where = f"band {band}, " if band is not None else ""
        super().__init__(f"{where}column {column}: {message}")
        self.reason = message
        self.band = band
        self.column = column


def _excerpt(token: str) -> str:
    text = token if len(token) <= 20 else token[:20] + "..."
    return text.encode("ascii", "backslashreplace").decode()


def _minutes(hours: str, minutes: str) -> int | None:
    h, m = int(hours), int(minutes)
    if m > 59 or h * 60 + m > MINUTES_PER_DAY:
        return None
    return h * 60 + m


def _parse_band(segment: str, offset: int, number: int) -> tuple[Band, int]:
    """Parse one segment starting at ``offset`` of the text; return the band
    and the (1-based) column of its first character."""
    stripped = segment.lstrip()
    start_col = offset + (len(segment) - len(stripped)) + 1
    end_col = offset + len(segment.rstrip()) + 1  # just after the last character

    def fail(message: str, col: int) -> BandsTextError:
        return BandsTextError(message, number, col)

    match = _HEAD.match(segment)
    if match is None:
        raise fail("expected a time range like 07:00-22:00", start_col)
    begin = _minutes(match[1], match[2])
    end = _minutes(match[3], match[4])
    if begin is None or end is None:
        raise fail("invalid time (use HH:MM, from 00:00 to 24:00)", start_col)
    if end <= begin:
        raise fail("the end must be after the start", start_col)

    rest_at = match.end()
    tokens = [
        (m.group(), offset + m.start() + 1)
        for m in _TOKEN.finditer(segment, rest_at)
    ]
    if not tokens:
        raise fail("expected a mode: heat, cool or off", end_col)
    mode_text, mode_col = tokens[0]
    mode = mode_text.lower()
    if mode not in MODES:
        raise fail(
            f"unknown mode {_excerpt(mode_text)!r} (use heat, cool or off)", mode_col
        )
    temperature: float | None = None
    preset: str | None = None
    for token, col in tokens[1:]:
        if _TEMP.fullmatch(token):
            if temperature is not None:
                raise fail("temperature given twice", col)
            temperature = float(token.replace(",", "."))
        elif (found := _PRESET.fullmatch(token)) is not None:
            if preset is not None:
                raise fail("preset given twice", col)
            preset = found[1]
        else:
            raise fail(
                f"unexpected {_excerpt(token)!r} (expected a temperature "
                "like 20.5 or preset=NAME)",
                col,
            )
    if mode == "off" and (temperature is not None or preset is not None):
        raise fail("mode off takes no temperature and no preset", tokens[1][1])
    if mode != "off" and temperature is None and preset is None:
        raise fail(f"mode {mode} needs a temperature or a preset", end_col)
    return Band(begin, end, mode, temperature, False, preset), start_col


def parse_bands(text: str) -> list[Band]:
    """Parse the compact text of a day into user bands sorted by start.

    Raises ``BandsTextError``.
    """
    if not isinstance(text, str):
        raise BandsTextError("the bands must be a text", None, 1)
    if len(text) > MAX_LENGTH:
        raise BandsTextError(
            f"text too long ({len(text)} characters, at most {MAX_LENGTH})",
            None,
            MAX_LENGTH + 1,
        )
    segments: list[tuple[str, int]] = []
    offset = 0
    for part in text.split(";"):
        segments.append((part, offset))
        offset += len(part) + 1
    while segments and not segments[-1][0].strip():  # trailing ";" and blanks
        segments.pop()
    if len(segments) > MAX_BANDS:
        part, offset = segments[MAX_BANDS]
        raise BandsTextError(
            f"too many bands (at most {MAX_BANDS})",
            MAX_BANDS + 1,
            offset + len(part) - len(part.lstrip()) + 1,
        )
    parsed: list[tuple[Band, int, int]] = []
    for number, (part, start) in enumerate(segments, 1):
        if not part.strip():
            raise BandsTextError("empty band", number, start + 1)
        band, col = _parse_band(part, start, number)
        parsed.append((band, number, col))
    ordered = sorted(parsed, key=lambda item: item[0].start)
    for (prev, _, _), (nxt, number, col) in zip(ordered, ordered[1:]):
        if nxt.start < prev.end:
            raise BandsTextError(
                f"overlaps the band {text_from_minutes(prev.start)}-"
                f"{text_from_minutes(prev.end)}",
                number,
                col,
            )
    return [band for band, _, _ in ordered]


def bands_to_text(bands: Sequence[Band]) -> str:
    """The compact text of some bands (the inverse of ``parse_bands``)."""
    parts = []
    for b in bands:
        mode: Mode = b.mode
        item = f"{text_from_minutes(b.start)}-{text_from_minutes(b.end)} {mode}"
        if b.temperature is not None:
            item += f" {b.temperature:g}"
        if b.preset is not None:
            item += f" preset={b.preset}"
        parts.append(item)
    return "; ".join(parts)
