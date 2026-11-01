"""Tests for the WebSocket API of the editor."""

import pytest

from custom_components.cronotermostato import async_setup

from test_services import DAY, ROOM, at, band, env  # noqa: F401


def auto(start, end):
    return {"start": start, "end": end, "mode": "off", "temperature": None, "auto": True}


def user(start, end, temperature):
    return {
        "start": start, "end": end, "mode": "heat",
        "temperature": temperature, "auto": False,
    }


FIVE = [
    auto("00:00", "08:00"),
    user("08:00", "12:00", 23.0),
    auto("12:00", "18:00"),
    user("18:00", "23:00", 20.0),
    auto("23:00", "24:00"),
]


async def test_preview_day_returns_five_bands(hass, hass_ws_client):
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "cronotermostato/preview_day", "bands": DAY}
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"] == {"bands": FIVE}


async def test_preview_day_discards_incoming_auto_bands(hass, hass_ws_client):
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
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "cronotermostato/preview_day", "bands": bands}
    )
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "invalid_format"


async def test_countries(hass, hass_ws_client):
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "cronotermostato/countries"})
    msg = await client.receive_json()
    assert msg["success"]
    assert "IT" in msg["result"] and "MI" in msg["result"]["IT"]
    assert len(msg["result"]) > 100


async def test_state_without_entry(hass, hass_ws_client):
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
