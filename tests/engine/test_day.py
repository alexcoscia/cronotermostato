"""Tests for day normalization and automatic bands."""

import pytest

from custom_components.cronotermostato.engine.day import normalize_day
from custom_components.cronotermostato.engine.models import Band, ProgramError


def _auto(start, end):
    return Band(start, end, "off", None, auto=True)


def test_spec_example():
    user = [Band(480, 720, "heat", 23), Band(1080, 1380, "heat", 20)]
    assert normalize_day(user) == (
        _auto(0, 480),
        Band(480, 720, "heat", 23),
        _auto(720, 1080),
        Band(1080, 1380, "heat", 20),
        _auto(1380, 1440),
    )


def test_empty_day():
    assert normalize_day([]) == (_auto(0, 1440),)


def test_full_day():
    result = normalize_day([Band(0, 720, "heat", 20), Band(720, 1440, "cool", 25)])
    assert len(result) == 2
    assert not any(b.auto for b in result)


def test_input_unsorted():
    a = Band(480, 720, "heat", 23)
    b = Band(1080, 1380, "heat", 20)
    assert normalize_day([b, a]) == normalize_day([a, b])


def test_overlap_raises():
    with pytest.raises(ProgramError):
        normalize_day([Band(480, 720, "heat", 23), Band(700, 800, "heat", 20)])


def test_gaps_are_off_without_preset_and_preset_kept():
    user = [Band(480, 720, "heat", None, preset="home")]
    result = normalize_day(user)
    assert result[1] == Band(480, 720, "heat", None, preset="home")
    assert result[0] == _auto(0, 480)
    assert result[0].preset is None and result[2].preset is None


def test_program_views_include_preset():
    from custom_components.cronotermostato.engine.day import program_views
    from custom_components.cronotermostato.engine.models import Program

    day = (Band(480, 720, "heat", None, preset="home"),)
    views = program_views(Program("p", "n", (day,) * 7, ()))
    assert views["week"][0][0]["preset"] == "home"
    assert views["week_full"][0][1]["preset"] == "home"
    assert views["week_full"][0][0]["preset"] is None
    assert views["holiday_full"][0]["preset"] is None
