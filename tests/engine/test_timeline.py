"""Tests for the timeline: holidays, midnight merging and DST transitions."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from custom_components.cronotermostato.engine.models import Band, Program
from custom_components.cronotermostato.engine.timeline import Slot, Timeline

ROME = ZoneInfo("Europe/Rome")
WEEKDAY = (Band(480, 720, "heat", 23), Band(1080, 1380, "heat", 20))
SATURDAY = (Band(540, 600, "heat", 21),)
HOLIDAY = (Band(0, 1440, "heat", 18),)
PROGRAM = Program(
    "p1",
    "Test",
    (WEEKDAY,) * 5 + (SATURDAY, ()),
    HOLIDAY,
)


def _timeline(program=PROGRAM, is_holiday=lambda d: False):
    return Timeline(program, is_holiday, ROME)


def _at(y, m, d, hh=0, mm=0, fold=0):
    return datetime(y, m, d, hh, mm, tzinfo=ROME, fold=fold)


def _utc(moment):
    return moment.astimezone(UTC)


def _same_instant(a, b):
    # Same-tzinfo datetimes compare by wall clock (ignoring fold), so always
    # compare instants in UTC.
    return _utc(a) == _utc(b)


def _wall(moment):
    return moment.astimezone(ROME).replace(tzinfo=None)


def test_slot_at_inside_band():
    slot = _timeline().slot_at(_at(2026, 10, 26, 9))
    assert _wall(slot.start) == datetime(2026, 10, 26, 8)
    assert _wall(slot.end) == datetime(2026, 10, 26, 12)
    assert slot.band.mode == "heat" and slot.band.temperature == 23
    assert slot.band.auto is False
    assert slot.holiday is False


def test_slot_at_boundaries_are_half_open():
    tl = _timeline()
    assert tl.slot_at(_at(2026, 10, 26, 8)).band.temperature == 23
    assert tl.slot_at(_at(2026, 10, 26, 12)).band.auto is True
    assert tl.slot_at(_at(2026, 10, 26, 7, 59)).band.auto is True


def test_night_merges_over_midnight():
    slot = _timeline().slot_at(_at(2026, 10, 26, 23, 30))
    assert _wall(slot.start) == datetime(2026, 10, 26, 23)
    assert _wall(slot.end) == datetime(2026, 10, 27, 8)
    assert slot.band.auto is True and slot.band.mode == "off"
    # Same slot seen from after midnight.
    after = _timeline().slot_at(_at(2026, 10, 27, 3))
    assert (after.start, after.end) == (slot.start, slot.end)


def test_friday_to_saturday():
    slot = _timeline().slot_at(_at(2026, 10, 30, 23, 30))  # Friday
    assert _wall(slot.start) == datetime(2026, 10, 30, 23)
    assert _wall(slot.end) == datetime(2026, 10, 31, 9)  # Saturday 09:00
    assert slot.band.auto is True


def test_no_merge_when_temperature_differs():
    # Evening band 20 degrees to midnight, then the next day starts at 20 too
    # except for a different temperature at 0:00: must stay separate.
    week = ((Band(1380, 1440, "heat", 20),), (Band(0, 60, "heat", 21),)) + ((),) * 5
    tl = _timeline(Program("p", "n", week, HOLIDAY))
    slot = tl.slot_at(_at(2026, 10, 26, 23, 30))
    assert _wall(slot.end) == datetime(2026, 10, 27, 0)
    assert tl.slot_after(slot).band.temperature == 21


def test_no_merge_when_mode_differs():
    week = ((Band(1380, 1440, "heat", 20),), (Band(0, 60, "cool", 20),)) + ((),) * 5
    tl = _timeline(Program("p", "n", week, HOLIDAY))
    slot = tl.slot_at(_at(2026, 10, 26, 23, 30))
    assert _wall(slot.end) == datetime(2026, 10, 27, 0)
    assert tl.slot_after(slot).band.mode == "cool"


def test_no_merge_when_auto_differs():
    # User band "off" (auto False) next to an automatic "off" band.
    week = ((Band(1380, 1440, "off"),), ()) + ((),) * 5
    tl = _timeline(Program("p", "n", week, HOLIDAY))
    slot = tl.slot_at(_at(2026, 10, 26, 23, 30))
    assert slot.band.auto is False
    assert _wall(slot.end) == datetime(2026, 10, 27, 0)
    assert tl.slot_after(slot).band.auto is True


def test_merge_when_user_bands_identical_over_midnight():
    week = ((Band(1380, 1440, "heat", 19),), (Band(0, 120, "heat", 19),)) + ((),) * 5
    tl = _timeline(Program("p", "n", week, HOLIDAY))
    slot = tl.slot_at(_at(2026, 10, 26, 23, 30))
    assert _wall(slot.start) == datetime(2026, 10, 26, 23)
    assert _wall(slot.end) == datetime(2026, 10, 27, 2)
    assert slot.band.auto is False


def test_holiday_overrides_sunday():
    def is_holiday(d):
        return d == date(2026, 11, 1)

    tl = _timeline(is_holiday=is_holiday)
    slot = tl.slot_at(_at(2026, 11, 1, 12))  # Sunday
    assert slot.holiday is True
    assert slot.band.temperature == 18
    assert _wall(slot.start) == datetime(2026, 11, 1, 0)
    assert _wall(slot.end) == datetime(2026, 11, 2, 0)
    monday = tl.slot_at(_at(2026, 11, 2, 12))
    assert monday.holiday is False
    assert monday.band.auto is True


def test_holiday_on_weekday_replaces_weekday_bands():
    tl = _timeline(is_holiday=lambda d: d == date(2026, 10, 26))  # Monday
    slot = tl.slot_at(_at(2026, 10, 26, 9))
    assert slot.holiday is True and slot.band.temperature == 18


def test_slot_after_chain():
    tl = _timeline()
    slot = tl.slot_at(_at(2026, 10, 26))
    seen = []
    for _ in range(30):
        nxt = tl.slot_after(slot)
        assert _same_instant(nxt.start, slot.end)
        assert _utc(nxt.end) > _utc(nxt.start)
        seen.append(nxt)
        slot = nxt
    # A week is not a single slot: the chain really advances.
    assert _utc(seen[-1].end) - _utc(seen[0].start) > timedelta(days=7)


def test_slot_after_matches_slot_at():
    tl = _timeline()
    slot = tl.slot_at(_at(2026, 10, 26, 10))
    nxt = tl.slot_after(slot)
    again = tl.slot_at(slot.end)
    assert _same_instant(again.start, nxt.start)
    assert _same_instant(again.end, nxt.end)
    assert again.band == nxt.band


def test_slot_at_accepts_utc_moment():
    moment = datetime(2026, 10, 26, 8, 0, tzinfo=UTC)  # 09:00 Rome (CET? CET after 25/10)
    slot = _timeline().slot_at(moment)
    assert slot.band.temperature == 23


def test_slot_at_requires_aware_moment():
    with pytest.raises(ValueError):
        _timeline().slot_at(datetime(2026, 10, 26, 9))


def test_all_off_program_is_bounded_and_contiguous():
    empty = Program("e", "e", ((),) * 7, ())
    tl = _timeline(empty)
    slot = tl.slot_at(_at(2026, 10, 26, 9))
    assert slot.band.auto is True
    assert _utc(slot.end) - _utc(slot.start) < timedelta(days=100)
    nxt = tl.slot_after(slot)
    assert _same_instant(nxt.start, slot.end)


# ---------------------------------------------------------------- DST


def _chain(tl, first_day, days):
    """Slots from local midnight of first_day until local midnight + days."""
    stop = _utc(_at(first_day.year, first_day.month, first_day.day) + timedelta(days=days))
    # Wall-clock midnight of the end day (timedelta on aware dt is wall arithmetic).
    slot = tl.slot_at(_at(first_day.year, first_day.month, first_day.day))
    chain = [slot]
    while _utc(slot.end) < stop:
        slot = tl.slot_after(slot)
        chain.append(slot)
    return chain


@pytest.mark.parametrize(
    ("first_day", "elapsed_hours"),
    [
        (date(2026, 3, 28), 3 * 24 - 1),  # spring forward: day of 23 hours
        (date(2026, 10, 24), 3 * 24 + 1),  # fall back: day of 25 hours
    ],
)
def test_dst_continuity(first_day, elapsed_hours):
    tl = _timeline()
    chain = _chain(tl, first_day, 3)
    for prev, nxt in zip(chain, chain[1:]):
        assert _utc(nxt.start) == _utc(prev.end), "gap or overlap"
    for slot in chain:
        assert _utc(slot.end) > _utc(slot.start)
    start_midnight = _utc(_at(first_day.year, first_day.month, first_day.day))
    assert _utc(chain[0].start) <= start_midnight
    # Every minute of real time in the three days belongs to exactly the slot
    # slot_at returns, and the chain covers it.
    stop = start_midnight + timedelta(hours=elapsed_hours)
    probe = start_midnight
    while probe < stop:
        found = tl.slot_at(probe)
        assert _utc(found.start) <= probe < _utc(found.end)
        owners = [s for s in chain if _utc(s.start) <= probe < _utc(s.end)]
        assert len(owners) == 1
        assert _utc(owners[0].start) == _utc(found.start)
        probe += timedelta(minutes=15)


def test_spring_forward_night_is_wall_clock_not_duration():
    # Saturday 10:00 -> Monday 08:00 is 46 wall hours but 45 real hours on
    # 2026-03-29 (02:00-03:00 does not exist).
    tl = _timeline()
    slot = tl.slot_at(_at(2026, 3, 29, 12))
    assert _wall(slot.start) == datetime(2026, 3, 28, 10)
    assert _wall(slot.end) == datetime(2026, 3, 30, 8)
    assert _utc(slot.end) - _utc(slot.start) == timedelta(hours=45)
    assert slot.start.utcoffset() == timedelta(hours=1)
    assert slot.end.utcoffset() == timedelta(hours=2)


def test_fall_back_night_is_wall_clock_not_duration():
    # Same stretch on 2026-10-25 has 47 real hours (02:00-03:00 happens twice).
    tl = _timeline()
    slot = tl.slot_at(_at(2026, 10, 25, 12))
    assert _wall(slot.start) == datetime(2026, 10, 24, 10)
    assert _wall(slot.end) == datetime(2026, 10, 26, 8)
    assert _utc(slot.end) - _utc(slot.start) == timedelta(hours=47)
    assert slot.start.utcoffset() == timedelta(hours=2)
    assert slot.end.utcoffset() == timedelta(hours=1)


def test_fall_back_both_occurrences_belong_to_the_slot():
    tl = _timeline()
    first = _at(2026, 10, 25, 2, 30, fold=0)  # still CEST
    second = _at(2026, 10, 25, 2, 30, fold=1)  # CET
    assert _utc(second) - _utc(first) == timedelta(hours=1)
    assert tl.slot_at(first).band.auto is True
    s1, s2 = tl.slot_at(first), tl.slot_at(second)
    assert _utc(s1.start) == _utc(s2.start) and _utc(s1.end) == _utc(s2.end)


def _sunday_program(bands):
    return Program("s", "s", ((),) * 6 + (tuple(bands),), HOLIDAY)


def test_fall_back_band_boundary_in_repeated_hour_uses_first_occurrence():
    # Bands 01:00-02:30 and 02:30-06:00 on the day with 25 hours: the boundary
    # is the FIRST 02:30 (CEST); the repeated hour belongs to the second band.
    tl = _timeline(_sunday_program([Band(60, 150, "heat", 20), Band(150, 360, "heat", 22)]))
    first = tl.slot_at(_at(2026, 10, 25, 2, 0, fold=0))
    assert first.band.temperature == 20
    assert _utc(first.end) == _utc(_at(2026, 10, 25, 2, 30, fold=0))
    assert _utc(first.end) == datetime(2026, 10, 25, 0, 30, tzinfo=UTC)
    second = tl.slot_after(first)
    assert second.band.temperature == 22
    assert _utc(second.start) == _utc(first.end)
    # The repeated 02:15 (CET) is already in the second band.
    assert tl.slot_at(_at(2026, 10, 25, 2, 15, fold=1)).band.temperature == 22
    assert _utc(second.end) == datetime(2026, 10, 25, 5, 0, tzinfo=UTC)  # 06:00 CET


def test_spring_forward_band_inside_gap_is_skipped():
    # A band entirely inside the nonexistent 02:00-03:00 has zero real length:
    # it must not appear, and neighbours stay contiguous.
    tl = _timeline(
        _sunday_program(
            [Band(60, 120, "heat", 20), Band(120, 180, "heat", 25), Band(180, 240, "heat", 21)]
        )
    )
    slot = tl.slot_at(_at(2026, 3, 29, 1, 30))
    assert slot.band.temperature == 20
    nxt = tl.slot_after(slot)
    assert nxt.band.temperature == 21
    assert _utc(nxt.start) == _utc(slot.end) == datetime(2026, 3, 29, 1, 0, tzinfo=UTC)
    assert _wall(nxt.start) == datetime(2026, 3, 29, 3, 0)


def test_spring_forward_boundary_inside_gap_is_clamped():
    # Boundary at 02:30 (nonexistent): moves to the instant of the change.
    tl = _timeline(_sunday_program([Band(60, 150, "heat", 20), Band(150, 360, "heat", 22)]))
    first = tl.slot_at(_at(2026, 3, 29, 1, 30))
    assert first.band.temperature == 20
    assert _utc(first.end) == datetime(2026, 3, 29, 1, 0, tzinfo=UTC)  # 03:00 CEST
    second = tl.slot_after(first)
    assert second.band.temperature == 22
    assert _utc(second.start) == _utc(first.end)
    assert _wall(second.end) == datetime(2026, 3, 29, 6)


def test_slot_is_frozen_dataclass():
    slot = _timeline().slot_at(_at(2026, 10, 26, 9))
    assert isinstance(slot, Slot)
    with pytest.raises(AttributeError):
        slot.holiday = True  # type: ignore[misc]


def test_spring_forward_gap_band_does_not_split_equal_neighbours():
    tl = _timeline(
        _sunday_program(
            [Band(60, 120, "heat", 20), Band(120, 180, "heat", 25), Band(180, 240, "heat", 20)]
        )
    )
    slot = tl.slot_at(_at(2026, 3, 29, 1, 30))
    assert _wall(slot.start) == datetime(2026, 3, 29, 1)
    assert _wall(slot.end) == datetime(2026, 3, 29, 4)
    assert slot.band.temperature == 20


def test_no_merge_when_preset_differs():
    week = (
        (Band(1380, 1440, "heat", None, preset="home"),),
        (Band(0, 60, "heat", None, preset="eco"),),
    ) + ((),) * 5
    tl = _timeline(Program("p", "n", week, HOLIDAY))
    slot = tl.slot_at(_at(2026, 10, 26, 23, 30))
    assert slot.band.preset == "home"
    assert _wall(slot.end) == datetime(2026, 10, 27, 0)
    assert tl.slot_after(slot).band.preset == "eco"


def test_no_merge_when_preset_vs_none():
    week = (
        (Band(1380, 1440, "heat", 20, preset="home"),),
        (Band(0, 60, "heat", 20),),
    ) + ((),) * 5
    tl = _timeline(Program("p", "n", week, HOLIDAY))
    slot = tl.slot_at(_at(2026, 10, 26, 23, 30))
    assert _wall(slot.end) == datetime(2026, 10, 27, 0)


def test_merge_when_preset_identical_over_midnight():
    week = (
        (Band(1380, 1440, "heat", None, preset="home"),),
        (Band(0, 60, "heat", None, preset="home"),),
    ) + ((),) * 5
    tl = _timeline(Program("p", "n", week, HOLIDAY))
    slot = tl.slot_at(_at(2026, 10, 26, 23, 30))
    assert _wall(slot.end) == datetime(2026, 10, 27, 1)
