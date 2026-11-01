"""Tests for the WebSocket API of the editor."""

from datetime import datetime

import pytest

from custom_components.cronotermostato import async_setup

from test_services import DAY, ROOM, TZ, at, band, env  # noqa: F401
from homeassistant.setup import async_setup_component


def auto(start, end):
    return {
        "start": start, "end": end, "mode": "off", "temperature": None,
        "auto": True, "preset": None,
    }


def user(start, end, temperature, preset=None):
    return {
        "start": start, "end": end, "mode": "heat",
        "temperature": temperature, "auto": False, "preset": preset,
    }


FIVE = [
    auto("00:00", "08:00"),
    user("08:00", "12:00", 23.0),
    auto("12:00", "18:00"),
    user("18:00", "23:00", 20.0),
    auto("23:00", "24:00"),
]


async def test_preview_day_returns_five_bands(hass, hass_ws_client):
    assert await async_setup_component(hass, "http", {})
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "cronotermostato/preview_day", "bands": DAY}
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"] == {"bands": FIVE}


async def test_preview_day_discards_incoming_auto_bands(hass, hass_ws_client):
    assert await async_setup_component(hass, "http", {})
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "cronotermostato/preview_day", "bands": FIVE}
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"] == {"bands": FIVE}


async def test_preview_day_stale_auto_band_does_not_overlap(hass, hass_ws_client):
    """A stale auto band that overlaps a user band is dropped, not an error."""
    assert await async_setup_component(hass, "http", {})
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    bands = [auto("00:00", "24:00"), user("08:00", "12:00", 23.0)]
    await client.send_json_auto_id(
        {"type": "cronotermostato/preview_day", "bands": bands}
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["bands"] == [
        auto("00:00", "08:00"), user("08:00", "12:00", 23.0), auto("12:00", "24:00")
    ]


@pytest.mark.parametrize(
    "bands",
    [
        [band("08:00", "12:00"), band("11:00", "13:00")],
        [{"start": "xx", "end": "12:00", "mode": "heat", "temperature": 20}],
        [band("08:00", "12:00", mode="eco")],
        ["not a band"],
    ],
)
async def test_preview_day_invalid(hass, hass_ws_client, bands):
    assert await async_setup_component(hass, "http", {})
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "cronotermostato/preview_day", "bands": bands}
    )
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "invalid_format"


async def test_countries(hass, hass_ws_client):
    assert await async_setup_component(hass, "http", {})
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "cronotermostato/countries"})
    msg = await client.receive_json()
    assert msg["success"]
    assert "IT" in msg["result"] and "MI" in msg["result"]["IT"]
    assert len(msg["result"]) > 100


async def test_state_without_entry(hass, hass_ws_client):
    assert await async_setup_component(hass, "http", {})
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "cronotermostato/state"})
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "not_loaded"


async def test_state_with_assigned_room(env, hass_ws_client):  # noqa: F811
    program_id = await env.create("Casa")
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    await env.hass.async_block_till_done()
    client = await hass_ws_client(env.hass)
    await client.send_json_auto_id({"type": "cronotermostato/state"})
    msg = await client.receive_json()
    assert msg["success"]
    result = msg["result"]
    assert result["country"] == "IT" and result["subdiv"] is None
    (program,) = result["programs"]
    assert program["program_id"] == program_id
    assert program["name"] == "Casa"
    assert program["week"][0] == [FIVE[1], FIVE[3]]
    assert program["week_full"][0] == FIVE
    assert program["holiday"] and len(program["holiday_full"]) == 1
    (room,) = result["rooms"]
    assert room["climate_entity_id"] == ROOM
    assert room["program_id"] == program_id
    assert room["program_name"] == "Casa"
    assert room["status"] == "ok"
    assert room["paused"] is False
    assert room["slot"]["start"] == at(8).isoformat()
    assert room["slot"]["end"] == at(12).isoformat()
    assert room["slot"]["temperature"] == 23.0
    assert room["next_slot"]["auto"] is True
    assert room["manual"] is False


async def test_state_after_unassign_room_disappears(env, hass_ws_client):  # noqa: F811
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    await env.call("unassign", climate_entity_id=ROOM)
    client = await hass_ws_client(env.hass)
    await client.send_json_auto_id({"type": "cronotermostato/state"})
    msg = await client.receive_json()
    assert msg["result"]["rooms"] == []
    assert len(msg["result"]["programs"]) == 1


async def test_commands_open_to_read_only_user(
    env, hass_ws_client, hass_read_only_access_token  # noqa: F811
):
    """The commands are read-only/pure, so they are not admin-only."""
    client = await hass_ws_client(env.hass, hass_read_only_access_token)
    for command, extra in (
        ("state", {}),
        ("countries", {}),
        ("preview_day", {"bands": DAY}),
    ):
        await client.send_json_auto_id({"type": f"cronotermostato/{command}", **extra})
        assert (await client.receive_json())["success"], command


async def test_state_assigned_room_without_controller(env, hass_ws_client):  # noqa: F811
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    controller = env.entry.runtime_data.manager.controllers.pop(ROOM)
    await controller.async_stop()  # simulate: no controller (and no leaked timer)
    client = await hass_ws_client(env.hass)
    await client.send_json_auto_id({"type": "cronotermostato/state"})
    (room,) = (await client.receive_json())["result"]["rooms"]
    assert room["status"] == "not_running"
    assert room["program_id"] == program_id
    assert room["slot"] is None and room["manual"] is False
    assert room["holiday"] is False and room["override_until"] is None


async def test_state_holiday_and_manual(env, hass_ws_client):  # noqa: F811
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    client = await hass_ws_client(env.hass)
    await client.send_json_auto_id({"type": "cronotermostato/state"})
    (room,) = (await client.receive_json())["result"]["rooms"]
    assert room["holiday"] is False  # Monday 2026-10-26

    await env.go(datetime(2026, 12, 25, 9, tzinfo=TZ))  # Christmas
    await env.call("set_manual", climate_entity_id=ROOM, mode="cool", temperature=25)
    await client.send_json_auto_id({"type": "cronotermostato/state"})
    (room,) = (await client.receive_json())["result"]["rooms"]
    assert room["holiday"] is True
    assert room["manual"] is True
    assert room["override_until"] is not None
    assert datetime.fromisoformat(room["override_until"]) > datetime(
        2026, 12, 25, 9, tzinfo=TZ
    )


async def test_preview_day_accepts_preset(hass, hass_ws_client):
    assert await async_setup_component(hass, "http", {})
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    bands = [
        {"start": "08:00", "end": "12:00", "mode": "heat", "preset": "home"},
        {"start": "12:00", "end": "13:00", "mode": "heat", "temperature": 20,
         "preset": "eco"},
    ]
    await client.send_json_auto_id(
        {"type": "cronotermostato/preview_day", "bands": bands}
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["bands"] == [
        auto("00:00", "08:00"),
        user("08:00", "12:00", None, "home"),
        user("12:00", "13:00", 20, "eco"),
        auto("13:00", "24:00"),
    ]


async def test_preview_day_rejects_preset_on_off_and_empty(hass, hass_ws_client):
    assert await async_setup_component(hass, "http", {})
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    for bad in (
        {"mode": "off", "preset": "home"},
        {"mode": "heat", "preset": ""},
        {"mode": "heat"},
    ):
        await client.send_json_auto_id(
            {"type": "cronotermostato/preview_day",
             "bands": [{"start": "08:00", "end": "12:00", **bad}]}
        )
        msg = await client.receive_json()
        assert not msg["success"] and msg["error"]["code"] == "invalid_format"


async def test_state_includes_preset_in_programs_and_slots(env, hass_ws_client):  # noqa: F811
    env.hass.states.async_set(
        ROOM, "heat", {"hvac_modes": ["heat", "off"], "preset_modes": ["home"]}
    )
    day = [{"start": "08:00", "end": "12:00", "mode": "heat", "preset": "home"}]
    result = await env.call(
        "create_program", True, name="P", week=[day] * 7, holiday=[]
    )
    await env.call(
        "assign", program_id=result["program_id"], climate_entity_id=ROOM
    )
    await env.hass.async_block_till_done()
    client = await hass_ws_client(env.hass)
    await client.send_json_auto_id({"type": "cronotermostato/state"})
    msg = await client.receive_json()
    (program,) = msg["result"]["programs"]
    assert program["week"][0][0]["preset"] == "home"
    assert program["week_full"][0][0]["preset"] is None
    (room,) = msg["result"]["rooms"]
    assert room["slot"]["preset"] == "home"
    assert room["slot"]["temperature"] is None
    assert room["next_slot"]["preset"] is None
    assert room["status"] == "ok"
