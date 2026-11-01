"""Tests for the pure data model of bands and programs."""

import pytest

from custom_components.cronotermostato.engine.models import (
    Band,
    Program,
    ProgramError,
    minutes_from_text,
    program_from_dict,
    program_to_dict,
    text_from_minutes,
    validate_bands,
)


def test_text_roundtrip():
    assert minutes_from_text("08:00") == 480
    assert minutes_from_text("00:00") == 0
    assert text_from_minutes(480) == "08:00"
    assert text_from_minutes(1440) == "24:00"
    assert minutes_from_text("24:00") == 1440
    for bad in ("24:01", "8", "12:60", "ab:cd", "-1:00", ""):
        with pytest.raises(ProgramError):
            minutes_from_text(bad)
    with pytest.raises(ProgramError):
        text_from_minutes(1441)
    # "24:00" is only valid as an end
    with pytest.raises(ProgramError):
        validate_bands([Band(minutes_from_text("24:00"), 1440, "off")])


@pytest.mark.parametrize(
    "bands",
    [
        [Band(480, 480, "off")],  # end == start
        [Band(480, 400, "off")],  # end < start
        [Band(480, 1441, "off")],  # end > 1440
        [Band(-1, 100, "off")],  # negative start
        [Band(1440, 1440, "off")],  # start at 24:00
        [Band(480, 720, "heat", 20), Band(700, 800, "heat", 20)],  # overlap
        [Band(480, 720, "heat")],  # heat without temperature
        [Band(480, 720, "cool")],  # cool without temperature
        [Band(480, 720, "off", 18)],  # off with temperature
        [Band(480, 720, "eco", 18)],  # unknown mode
        [Band(480, 720, "heat", "warm")],  # non numeric temperature
        [Band(480, 720, "heat", True)],  # bool is not a temperature
        [Band(480, 720, "heat", float("nan"))],
    ],
)
def test_validate_rejects(bands):
    with pytest.raises(ProgramError):
        validate_bands(bands)


def test_adjacent_ok():
    validate_bands([Band(480, 720, "heat", 21), Band(720, 900, "off")])
    validate_bands([Band(720, 900, "off"), Band(480, 720, "heat", 21)])  # unsorted
    validate_bands([])


def _program() -> Program:
    day = (Band(480, 720, "heat", 23.0), Band(1080, 1440, "cool", 24.5))
    return Program(
        id="p1",
        name="Casa",
        week=(day, (), day, (), day, (Band(0, 60, "off", auto=True),), ()),
        holiday=(Band(0, 1440, "heat", 18.0),),
    )


def test_program_roundtrip():
    p = _program()
    d = program_to_dict(p)
    assert d["week"][0][0] == {
        "start": "08:00",
        "end": "12:00",
        "mode": "heat",
        "temperature": 23.0,
        "auto": False,
        "preset": None,
    }
    assert d["week"][0][1]["end"] == "24:00"
    assert program_from_dict(d) == p


def test_program_from_dict_wrong_days():
    d = program_to_dict(_program())
    d["week"] = d["week"][:6]
    with pytest.raises(ProgramError):
        program_from_dict(d)
    d["week"] = d["week"] + [[], []]
    with pytest.raises(ProgramError):
        program_from_dict(d)


def test_program_from_dict_invalid_band():
    d = program_to_dict(_program())
    d["week"][0][1]["start"] = "10:00"  # overlaps the first band
    with pytest.raises(ProgramError):
        program_from_dict(d)
    d = program_to_dict(_program())
    del d["holiday"]
    with pytest.raises(ProgramError):
        program_from_dict(d)


@pytest.mark.parametrize("bad", [1, "yes", None])
def test_program_from_dict_auto_must_be_bool(bad):
    d = program_to_dict(_program())
    d["week"][0][0]["auto"] = bad
    with pytest.raises(ProgramError):
        program_from_dict(d)


@pytest.mark.parametrize("key", ["id", "name"])
@pytest.mark.parametrize("bad", ["", "  ", None, 5])
def test_program_from_dict_id_name_non_empty_strings(key, bad):
    d = program_to_dict(_program())
    d[key] = bad
    with pytest.raises(ProgramError):
        program_from_dict(d)


# -- preset -----------------------------------------------------------------


def test_band_preset_defaults_to_none():
    assert Band(0, 60, "heat", 20).preset is None


@pytest.mark.parametrize(
    "band",
    [
        Band(0, 60, "heat", None, preset="home"),  # preset alone
        Band(0, 60, "cool", None, preset="eco"),
        Band(0, 60, "heat", 20, preset="home"),  # both
        Band(0, 60, "heat", None, preset="none"),  # "none" is a valid preset
    ],
)
def test_validate_accepts_preset(band):
    validate_bands([band])


@pytest.mark.parametrize(
    "band",
    [
        Band(0, 60, "heat"),  # neither temperature nor preset
        Band(0, 60, "cool"),
        Band(0, 60, "off", preset="home"),  # off takes no preset
        Band(0, 60, "off", 20, preset="home"),
        Band(0, 60, "heat", None, preset=""),
        Band(0, 60, "heat", None, preset="  "),
        Band(0, 60, "heat", 20, preset=5),
        Band(0, 60, "heat", None, preset=True),
    ],
)
def test_validate_rejects_preset(band):
    with pytest.raises(ProgramError):
        validate_bands([band])


def test_preset_roundtrip_and_emitted_as_none():
    day = (Band(0, 60, "heat", None, preset="home"), Band(60, 120, "heat", 20))
    p = Program("p", "n", (day,) * 7, ())
    d = program_to_dict(p)
    assert d["week"][0][0]["preset"] == "home"
    assert d["week"][0][0]["temperature"] is None
    assert d["week"][0][1]["preset"] is None
    assert program_from_dict(d) == p


def test_program_from_dict_without_preset_key():
    """Data saved before the presets existed has no ``preset`` key."""
    d = program_to_dict(_program())
    for day in d["week"]:
        for band in day:
            del band["preset"]
    for band in d["holiday"]:
        del band["preset"]
    assert program_from_dict(d) == _program()
    assert program_from_dict(d).holiday[0].preset is None


@pytest.mark.parametrize("bad", ["", 5, True, ["home"]])
def test_program_from_dict_rejects_bad_preset(bad):
    d = program_to_dict(_program())
    d["week"][0][0]["preset"] = bad
    with pytest.raises(ProgramError):
        program_from_dict(d)
