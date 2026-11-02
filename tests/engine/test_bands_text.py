"""Tests for the compact text form of the bands of a day (``set_day``)."""

import pytest

from custom_components.cronotermostato.engine.bands_text import (
    MAX_BANDS,
    MAX_LENGTH,
    BandsTextError,
    bands_to_text,
    parse_bands,
)
from custom_components.cronotermostato.engine.models import Band


def test_basic_example():
    assert parse_bands("07:00-22:00 heat 20.5; 22:00-24:00 off") == [
        Band(420, 1320, "heat", 20.5),
        Band(1320, 1440, "off"),
    ]


@pytest.mark.parametrize("text", ["", "   ", "\n\t ", ";", " ; ; "])
def test_empty_is_a_day_without_user_bands(text):
    assert parse_bands(text) == []


def test_spaces_are_tolerated():
    expected = [Band(420, 1320, "heat", 20.0)]
    for text in (
        "07:00-22:00 heat 20",
        "  07:00 - 22:00   heat    20  ",
        "07:00 -22:00 heat 20;",
        "7:00-22:00 heat 20 ;  ",
        "07:00-22:00\theat\n20",
    ):
        assert parse_bands(text) == expected


def test_decimal_comma_and_point():
    assert parse_bands("00:00-01:00 heat 20,5")[0].temperature == 20.5
    assert parse_bands("00:00-01:00 heat 20.25")[0].temperature == 20.25
    assert parse_bands("00:00-01:00 cool 26")[0].temperature == 26.0
    assert parse_bands("00:00-01:00 heat 7")[0].temperature == 7.0


def test_end_24_00_and_midnight_start():
    assert parse_bands("00:00-24:00 heat 19") == [Band(0, 1440, "heat", 19.0)]


def test_modes_case_insensitive_and_off_bare():
    bands = parse_bands("00:00-06:00 OFF; 06:00-07:00 Cool 25")
    assert bands == [Band(0, 360, "off"), Band(360, 420, "cool", 25.0)]


def test_preset_with_and_without_temperature():
    assert parse_bands("08:00-09:00 heat preset=eco") == [
        Band(480, 540, "heat", None, preset="eco")
    ]
    assert parse_bands("08:00-09:00 heat 21 preset=home") == [
        Band(480, 540, "heat", 21.0, preset="home")
    ]
    assert parse_bands("08:00-09:00 heat preset=sleep_2 21,5") == [
        Band(480, 540, "heat", 21.5, preset="sleep_2")
    ]


def test_result_is_sorted_by_start():
    bands = parse_bands("12:00-13:00 heat 20; 08:00-09:00 heat 21")
    assert [b.start for b in bands] == [480, 720]


def test_adjacent_bands_are_fine():
    assert len(parse_bands("08:00-09:00 heat 21; 09:00-10:00 heat 22")) == 2


def test_never_auto():
    assert all(not b.auto for b in parse_bands("08:00-09:00 off"))


def test_max_bands_accepted_and_one_more_refused():
    ok = ";".join(f"{i:02d}:00-{i:02d}:30 off" for i in range(MAX_BANDS))
    assert len(ok) <= MAX_LENGTH
    assert len(parse_bands(ok)) == MAX_BANDS
    too_many = ok + f";{MAX_BANDS % 24:02d}:40-{MAX_BANDS % 24:02d}:50 off"
    with pytest.raises(BandsTextError) as err:
        parse_bands(too_many)
    assert "at most" in str(err.value)


def err_of(text):
    with pytest.raises(BandsTextError) as err:
        parse_bands(text)
    return err.value


@pytest.mark.parametrize(
    "text",
    [
        "heat 20",
        "07:00 heat 20",
        "07:00-22:00",
        "07:00-22:00 warm 20",
        "07:00-22:00 20 heat",
        "07:00-22:00 heat",
        "07:00-22:00 heat 20 21",
        "07:00-22:00 heat 20 preset=a preset=b",
        "07:00-22:00 heat 20 extra",
        "07:00-22:00 heat 20.123",
        "07:00-22:00 heat 1e3",
        "07:00-22:00 heat nan",
        "07:00-22:00 heat inf",
        "07:00-22:00 heat -5",
        "07:00-22:00 heat 20,5,5",
        "07:00-22:00 off 20",
        "07:00-22:00 off preset=eco",
        "07:00-22:00 heat preset=",
        "07:00-22:00 heat preset=a b",
        "07:00-22:00 heat preset=" + "x" * 41,
        "25:00-26:00 heat 20",
        "07:60-08:00 heat 20",
        "07:00-24:01 heat 20",
        "24:00-24:00 heat 20",
        "22:00-07:00 heat 20",
        "07:00-07:00 heat 20",
        "07:00:00-08:00 heat 20",
        "07:00-08:00 heat 20; ; 09:00-10:00 off",
        "07:00-10:00 heat 20; 09:00-11:00 heat 21",
        "07:00-22:00 heat 20 ;; 22:00-23:00 off",
        "٠٧:٠٠-٠٨:٠٠ heat 20",  # Arabic-Indic digits
        "07:00-08:00 heat ２０",  # fullwidth digits
        "07:00-08:00 heat 20\x00",
        "07:00-08:00 heat 20 ​",
        "{}",
        "[1,2]",
        "07:00-08:00 heat 20 -- DROP TABLE",
    ],
)
def test_invalid(text):
    err = err_of(text)
    assert isinstance(err, BandsTextError)
    assert isinstance(err, ValueError)
    assert str(err)
    assert err.column is not None and 1 <= err.column <= len(text) + 1


def test_not_a_string():
    for value in (None, 5, ["07:00-08:00 off"], b"x"):
        with pytest.raises(BandsTextError):
            parse_bands(value)


def test_too_long():
    err = err_of("a" * (MAX_LENGTH + 1))
    assert "too long" in str(err)
    # the limit itself is parsed (and refused for its content, not its length)
    assert "too long" not in str(err_of("a" * MAX_LENGTH))


def test_error_positions():
    err = err_of("07:00-22:00 heat 20; 22:00-23:00 warm")
    assert err.band == 2
    assert err.column == 34  # the "warm" token
    assert "band 2" in str(err) and "column 34" in str(err)

    err = err_of("07:00-22:00 heat")
    assert (err.band, err.column) == (1, 17)  # just after the text

    err = err_of("08:00-09:00 off; 09:00-08:00 off")
    assert err.band == 2

    err = err_of("07:00-10:00 heat 20; 09:00-11:00 heat 21")
    assert err.band == 2 and "overlap" in str(err)

    err = err_of("   x")
    assert err.column == 4


def test_error_does_not_echo_long_input():
    err = err_of("07:00-08:00 heat " + "9" * 500)
    assert len(str(err)) < 200


def test_roundtrip_to_text():
    text = "07:00-22:00 heat 20.5; 22:00-24:00 off; 23:00-23:30 heat preset=eco"
    bands = [b for b in parse_bands(text[: text.rindex(";")])]
    assert bands_to_text(bands) == "07:00-22:00 heat 20.5; 22:00-24:00 off"
    again = parse_bands(bands_to_text(bands))
    assert again == bands
    with_preset = [Band(480, 540, "heat", 21.0, preset="eco")]
    assert bands_to_text(with_preset) == "08:00-09:00 heat 21 preset=eco"
    assert parse_bands(bands_to_text(with_preset)) == with_preset
    assert bands_to_text([]) == ""
