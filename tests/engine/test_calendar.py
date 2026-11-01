"""Tests for the holiday calendar."""

from datetime import date

import pytest

from custom_components.cronotermostato.engine.calendar import (
    HolidayCalendar,
    supported_countries,
)


def test_italy_holidays():
    cal = HolidayCalendar("IT")
    assert cal.is_holiday(date(2026, 11, 1))
    assert cal.is_holiday(date(2026, 12, 25))
    assert not cal.is_holiday(date(2026, 11, 2))


def test_germany_subdivision():
    assert HolidayCalendar("DE", "BY").is_holiday(date(2026, 1, 6))
    assert not HolidayCalendar("DE").is_holiday(date(2026, 1, 6))


def test_cache_across_years():
    cal = HolidayCalendar("IT")
    assert cal.is_holiday(date(2026, 12, 25))
    assert cal.is_holiday(date(2027, 1, 1))
    assert cal.is_holiday(date(2026, 12, 25))


def test_unknown_country():
    with pytest.raises(ValueError):
        HolidayCalendar("XX")


def test_unknown_subdivision():
    with pytest.raises(ValueError):
        HolidayCalendar("IT", "ZZ")


def test_supported_countries():
    countries = supported_countries()
    assert countries["IT"]
    assert countries["IT"] == sorted(countries["IT"])
    assert "BY" in countries["DE"]
    assert "AFG" not in countries
    assert all(isinstance(v, list) for v in countries.values())
    assert any(not v for v in countries.values())
