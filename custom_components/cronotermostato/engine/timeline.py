"""Timeline of slots: holidays, merging over midnight and DST handling.

Band times are *wall-clock* times of the configured time zone, never sums of
durations. Internally every instant is handled in UTC; the datetimes handed
out are expressed in the time zone ``tz``.

Caution for consumers: two datetimes sharing the same ``tzinfo`` are compared
by their wall clock, ignoring ``fold``. Around the autumn change (the repeated
hour) compare them through ``astimezone(UTC)``.

DST rules:
* A wall-clock time that is repeated (autumn) means its *first* occurrence
  (``fold=0``); the repeated hour thus belongs to the band that follows.
* A wall-clock time that does not exist (spring) is moved to the instant of the
  change. A band lying entirely inside the gap has no length and is dropped.
  Either way, slots stay contiguous and strictly increasing.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, tzinfo

from .day import normalize_day
from .models import Band, Program

# A program that never changes (e.g. always "off") would merge forever: stop
# merging after this many days on each side.
MAX_MERGE_DAYS = 31


@dataclass(frozen=True)
class Slot:
    """A stretch of time with a single band. Datetimes are timezone-aware."""

    start: datetime
    end: datetime
    band: Band
    holiday: bool


@dataclass(frozen=True)
class _Piece:
    """One band of one day, as UTC instants."""

    start: datetime
    end: datetime
    band: Band
    holiday: bool
    day: date


def _same_setting(a: Band, b: Band) -> bool:
    return (a.mode, a.temperature, a.preset, a.auto) == (
        b.mode,
        b.temperature,
        b.preset,
        b.auto,
    )


class Timeline:
    """Slots of a program over time, for a time zone and a holiday rule."""

    def __init__(
        self,
        program: Program,
        is_holiday: Callable[[date], bool],
        tz: tzinfo,
    ) -> None:
        self._program = program
        self._is_holiday = is_holiday
        self._tz = tz
        self._days: dict[date, tuple[_Piece, ...]] = {}

    # ------------------------------------------------------------ instants

    def _instant(self, day: date, minutes: int) -> datetime:
        """UTC instant of the wall-clock time ``day`` + ``minutes``."""
        wall = datetime.combine(day, time()) + timedelta(minutes=minutes)
        candidate = wall.replace(tzinfo=self._tz, fold=0)
        utc = candidate.astimezone(UTC)
        if utc.astimezone(self._tz).replace(tzinfo=None) == wall:
            return utc  # exists (first occurrence if repeated)
        # The wall time falls in a spring gap: earliest instant whose local
        # wall clock is >= wall, i.e. the instant of the change.
        lo, hi = utc - timedelta(hours=24), utc + timedelta(hours=24)
        while hi - lo > timedelta(minutes=1):
            mid = lo + timedelta(minutes=(hi - lo) // timedelta(minutes=2))
            if mid.astimezone(self._tz).replace(tzinfo=None) >= wall:
                hi = mid
            else:
                lo = mid
        return hi

    def _local(self, instant: datetime) -> datetime:
        return instant.astimezone(self._tz)

    # -------------------------------------------------------------- pieces

    def _pieces(self, day: date) -> tuple[_Piece, ...]:
        cached = self._days.get(day)
        if cached is not None:
            return cached
        holiday = bool(self._is_holiday(day))
        bands = self._program.holiday if holiday else self._program.week[day.weekday()]
        pieces = []
        for band in normalize_day(bands):
            start = self._instant(day, band.start)
            end = self._instant(day, band.end)  # 1440 -> next midnight
            if end > start:
                pieces.append(_Piece(start, end, band, holiday, day))
        result = tuple(pieces)
        self._days[day] = result
        return result

    def _piece_containing(self, instant: datetime) -> _Piece:
        local_day = self._local(instant).date()
        for offset in (0, -1, 1):
            for piece in self._pieces(local_day + timedelta(days=offset)):
                if piece.start <= instant < piece.end:
                    return piece
        raise RuntimeError(f"No band found for {instant}")  # pragma: no cover

    def _next_piece(self, piece: _Piece) -> _Piece:
        pieces = self._pieces(piece.day)
        index = pieces.index(piece)
        if index + 1 < len(pieces):
            return pieces[index + 1]
        day = piece.day
        while True:
            day += timedelta(days=1)
            following = self._pieces(day)
            if following:
                return following[0]

    def _previous_piece(self, piece: _Piece) -> _Piece:
        pieces = self._pieces(piece.day)
        index = pieces.index(piece)
        if index > 0:
            return pieces[index - 1]
        day = piece.day
        while True:
            day -= timedelta(days=1)
            preceding = self._pieces(day)
            if preceding:
                return preceding[-1]

    # --------------------------------------------------------------- slots

    def _extend_forward(self, piece: _Piece) -> _Piece:
        """Last piece of the run of pieces merging with ``piece``."""
        last = piece
        while True:
            following = self._next_piece(last)
            if not _same_setting(following.band, piece.band):
                return last
            if (following.day - piece.day).days > MAX_MERGE_DAYS:
                return last
            last = following

    def _extend_backward(self, piece: _Piece) -> _Piece:
        first = piece
        while True:
            preceding = self._previous_piece(first)
            if not _same_setting(preceding.band, piece.band):
                return first
            if (piece.day - preceding.day).days > MAX_MERGE_DAYS:
                return first
            first = preceding

    def _slot(self, first: _Piece, last: _Piece) -> Slot:
        return Slot(
            start=self._local(first.start),
            end=self._local(last.end),
            band=first.band,
            holiday=first.holiday,
        )

    def slot_at(self, moment: datetime) -> Slot:
        """The slot containing ``moment`` (timezone-aware)."""
        if moment.tzinfo is None or moment.utcoffset() is None:
            raise ValueError("moment must be timezone-aware")
        piece = self._piece_containing(moment.astimezone(UTC))
        return self._slot(self._extend_backward(piece), self._extend_forward(piece))

    def slot_after(self, slot: Slot) -> Slot:
        """The slot starting exactly where ``slot`` ends."""
        piece = self._piece_containing(slot.end.astimezone(UTC))
        return self._slot(piece, self._extend_forward(piece))
