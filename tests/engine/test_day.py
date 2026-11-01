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
