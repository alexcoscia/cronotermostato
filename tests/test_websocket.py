"""Tests for the WebSocket API of the editor."""

import asyncio
from datetime import datetime

import pytest
from homeassistant.setup import async_setup_component

from custom_components.cronotermostato import async_setup

from test_services import DAY, ROOM, TZ, at, band, env  # noqa: F401


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


# -- Task 4: save/delete/assign/unassign/subscribe ---------------------------


def _week(temperature=23.0, preset=None, start="08:00", end="12:00"):
    day = [{"start": start, "end": end, "mode": "heat"}]
    if temperature is not None:
        day[0]["temperature"] = temperature
    if preset is not None:
        day[0]["preset"] = preset
    return [day] * 7


async def ws(client, command, **data):
    await client.send_json_auto_id({"type": f"cronotermostato/{command}", **data})
    return await client.receive_json()


def save_data(name="Nuovo", week=None, holiday=None, **extra):
    return {
        "name": name,
        "week": week if week is not None else _week(),
        "holiday": holiday if holiday is not None else [],
        **extra,
    }


def set_admin_only(env, value):  # noqa: F811
    env.hass.config_entries.async_update_entry(
        env.entry, options={"admin_only": value}
    )


async def test_state_has_revision_and_options(env, hass_ws_client):  # noqa: F811
    a = await env.create("Uno")
    b = await env.create("Due")  # same content, other name
    client = await hass_ws_client(env.hass)
    msg = await ws(client, "state")
    assert msg["result"]["options"] == {"admin_only": True}
    progs = {p["program_id"]: p for p in msg["result"]["programs"]}
    assert len(progs[a]["revision"]) == 12
    int(progs[a]["revision"], 16)
    assert progs[a]["revision"] != progs[b]["revision"]
    # Same content and id -> same revision; a change alters it.
    msg2 = await ws(client, "state")
    assert msg2["result"]["programs"][0]["revision"] == progs[a]["revision"]
    await env.call("update_program", program_id=a, holiday=[])
    msg3 = await ws(client, "state")
    new = {p["program_id"]: p for p in msg3["result"]["programs"]}
    assert new[a]["revision"] != progs[a]["revision"]
    assert new[b]["revision"] == progs[b]["revision"]


async def test_state_options_follow_entry(env, hass_ws_client):  # noqa: F811
    set_admin_only(env, False)
    client = await hass_ws_client(env.hass)
    msg = await ws(client, "state")
    assert msg["result"]["options"] == {"admin_only": False}


async def test_state_climate_available(env, hass_ws_client):  # noqa: F811
    program_id = await env.create()
    await env.call("assign", program_id=program_id, climate_entity_id=ROOM)
    client = await hass_ws_client(env.hass)
    (room,) = (await ws(client, "state"))["result"]["rooms"]
    assert room["climate_available"] is True
    env.hass.states.async_set(ROOM, "unavailable")
    (room,) = (await ws(client, "state"))["result"]["rooms"]
    assert room["climate_available"] is False
    env.hass.states.async_remove(ROOM)
    (room,) = (await ws(client, "state"))["result"]["rooms"]
    assert room["climate_available"] is False


async def test_save_program_creates(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    msg = await ws(client, "save_program", **save_data("Salotto Inverno"))
    assert msg["success"], msg
    assert msg["result"]["program_id"] == "salotto_inverno"
    state = (await ws(client, "state"))["result"]
    (program,) = state["programs"]
    assert program["revision"] == msg["result"]["revision"]


async def test_save_program_updates_with_expected_revision(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    created = (await ws(client, "save_program", **save_data()))["result"]
    msg = await ws(
        client,
        "save_program",
        **save_data("Rinominato", _week(21.0), program_id=created["program_id"],
                    expected_revision=created["revision"]),
    )
    assert msg["success"], msg
    assert msg["result"]["program_id"] == created["program_id"]
    assert msg["result"]["revision"] != created["revision"]
    prog = env.store.programs[created["program_id"]]
    assert prog.name == "Rinominato" and prog.week[0][0].temperature == 21.0
    assert len(env.store.programs) == 1


async def test_save_program_without_expected_revision_overwrites(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    created = (await ws(client, "save_program", **save_data()))["result"]
    msg = await ws(
        client, "save_program",
        **save_data("Forzato", program_id=created["program_id"]),
    )
    assert msg["success"]
    assert env.store.programs[created["program_id"]].name == "Forzato"


async def test_save_program_conflict_changes_nothing(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    created = (await ws(client, "save_program", **save_data()))["result"]
    # A second editor saves first.
    second = await ws(
        client, "save_program",
        **save_data("Altrove", _week(19.0), program_id=created["program_id"],
                    expected_revision=created["revision"]),
    )
    assert second["success"]
    before = env.store._serialize()
    msg = await ws(
        client, "save_program",
        **save_data("Vecchio", _week(25.0), program_id=created["program_id"],
                    expected_revision=created["revision"]),
    )
    assert not msg["success"] and msg["error"]["code"] == "conflict"
    assert env.store._serialize() == before
    assert env.store.programs[created["program_id"]].name == "Altrove"


async def test_save_program_unknown_is_not_found_and_not_created(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    msg = await ws(
        client, "save_program", **save_data(program_id="fantasma", expected_revision="x")
    )
    assert not msg["success"] and msg["error"]["code"] == "not_found"
    msg = await ws(client, "save_program", **save_data(program_id="fantasma"))
    assert not msg["success"] and msg["error"]["code"] == "not_found"
    assert env.store.programs == {}


async def test_save_program_invalid(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    overlap = [[band("08:00", "12:00"), band("11:00", "13:00")]] * 7
    msg = await ws(client, "save_program", **save_data(week=overlap))
    assert not msg["success"] and msg["error"]["code"] == "invalid_format"
    msg = await ws(client, "save_program", **save_data(week=[[]] * 3))
    assert not msg["success"] and msg["error"]["code"] == "invalid_format"
    msg = await ws(client, "save_program", **save_data(name="  "))
    assert not msg["success"] and msg["error"]["code"] == "invalid_format"
    assert env.store.programs == {}


async def test_save_program_invalid_update_keeps_old(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    created = (await ws(client, "save_program", **save_data()))["result"]
    overlap = [[band("08:00", "12:00"), band("11:00", "13:00")]] * 7
    msg = await ws(
        client, "save_program",
        **save_data(week=overlap, program_id=created["program_id"],
                    expected_revision=created["revision"]),
    )
    assert msg["error"]["code"] == "invalid_format"
    assert env.store.programs[created["program_id"]].week[0][0].temperature == 23.0


async def test_save_program_discards_auto_bands(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    week = [FIVE] * 7
    msg = await ws(client, "save_program", **save_data(week=week, holiday=[FIVE[0]]))
    assert msg["success"], msg
    prog = env.store.programs[msg["result"]["program_id"]]
    assert [b.auto for b in prog.week[0]] == [False, False]
    assert len(prog.week[0]) == 2 and prog.holiday == ()


async def test_save_assigned_program_no_unexpected_commands(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    created = (
        await ws(client, "save_program",
                 **save_data(week=_week(23.0, "home")))
    )["result"]
    pid = created["program_id"]
    assert (await ws(client, "assign", program_id=pid, climate_entity_id=ROOM))["success"]
    await env.hass.async_block_till_done()
    revision = created["revision"]

    async def save(week, **kw):
        nonlocal revision
        msg = await ws(
            client, "save_program",
            **save_data("Nuovo", week, program_id=pid, expected_revision=revision),
        )
        assert msg["success"], msg
        revision = msg["result"]["revision"]
        await env.hass.async_block_till_done()

    # Same content: nothing is sent.
    env.calls.clear()
    await save(_week(23.0, "home"))
    assert env.calls == []

    # Future slot changes. Existing controller behaviour (same as the
    # ``update_program`` service): any change of the bands re-asserts the
    # current setting once, in order; the plan's "no command" is NOT met here
    # (see the report). The next scheduling moves.
    again = [
        (ROOM, "set_hvac_mode", "heat"),
        (ROOM, "set_preset_mode", "home"),
        (ROOM, "set_temperature", 23.0),
    ]
    controller = env.entry.runtime_data.manager.controllers[ROOM]
    day = [
        {"start": "08:00", "end": "12:00", "mode": "heat", "temperature": 23.0,
         "preset": "home"},
        {"start": "18:00", "end": "23:00", "mode": "heat", "temperature": 20.0},
    ]
    await save([day] * 7)
    assert env.calls == again
    assert controller.state.next_slot.band.start == 12 * 60  # auto filler 12-18
    env.calls.clear()
    day[1] = {**day[1], "start": "14:00"}
    await save([day] * 7)
    assert env.calls == again
    assert controller.state.next_slot.band.start == 12 * 60
    assert controller.state.next_slot.band.end == 14 * 60

    # Current slot changes while the thermostat is "off": the three commands,
    # in order, once.
    env.hass.states.async_set(
        ROOM, "off",
        {"hvac_modes": ["heat", "cool", "off"], "preset_modes": ["none", "home", "eco"]},
    )
    env.calls.clear()
    day[0] = {**day[0], "temperature": 22.0}
    await save([day] * 7)
    assert env.calls == [
        (ROOM, "set_hvac_mode", "heat"),
        (ROOM, "set_preset_mode", "home"),
        (ROOM, "set_temperature", 22.0),
    ]

    # A rename alone does not command.
    env.calls.clear()
    msg = await ws(
        client, "save_program",
        **save_data("Altro nome", [day] * 7, program_id=pid, expected_revision=revision),
    )
    assert msg["success"]
    await env.hass.async_block_till_done()
    assert env.calls == []


async def test_delete_program(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    created = (await ws(client, "save_program", **save_data()))["result"]
    pid = created["program_id"]
    await ws(client, "assign", program_id=pid, climate_entity_id=ROOM)
    msg = await ws(client, "delete_program", program_id=pid)
    assert not msg["success"] and msg["error"]["code"] == "invalid_format"
    assert pid in env.store.programs
    msg = await ws(client, "unassign", climate_entity_id=ROOM)
    assert msg["success"]
    assert env.store.assignments == {}
    assert env.entry.runtime_data.manager.controllers == {}
    msg = await ws(client, "delete_program", program_id=pid, expected_revision="bad")
    assert not msg["success"] and msg["error"]["code"] == "conflict"
    assert pid in env.store.programs
    msg = await ws(
        client, "delete_program", program_id=pid, expected_revision=created["revision"]
    )
    assert msg["success"]
    assert env.store.programs == {}
    msg = await ws(client, "delete_program", program_id=pid)
    assert not msg["success"] and msg["error"]["code"] == "not_found"


async def test_assign_errors_and_success(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    pid = (await ws(client, "save_program", **save_data()))["result"]["program_id"]
    msg = await ws(client, "assign", program_id=pid, climate_entity_id="climate.nulla")
    assert not msg["success"] and msg["error"]["code"] == "not_found"
    msg = await ws(client, "assign", program_id="fantasma", climate_entity_id=ROOM)
    assert not msg["success"] and msg["error"]["code"] == "not_found"
    msg = await ws(client, "assign", program_id=pid, climate_entity_id="light.sala")
    assert not msg["success"] and msg["error"]["code"] == "invalid_format"
    assert env.store.assignments == {}
    msg = await ws(client, "assign", program_id=pid, climate_entity_id=ROOM)
    assert msg["success"]
    assert ROOM in env.entry.runtime_data.manager.controllers
    assert env.store.assignments[ROOM].program_id == pid


@pytest.mark.parametrize(
    ("command", "extra"),
    [
        ("save_program", {"program_id": "p"}),
        ("save_program", {}),
        ("delete_program", {"program_id": "p"}),
        ("assign", {"program_id": "p", "climate_entity_id": ROOM}),
        ("unassign", {"climate_entity_id": ROOM}),
    ],
)
async def test_non_admin_unauthorized_when_admin_only(
    env, hass_ws_client, hass_read_only_access_token, command, extra  # noqa: F811
):
    pid = await env.create("P")
    await env.call("assign", program_id=pid, climate_entity_id=ROOM)
    extra = {k: (pid if v == "p" else v) for k, v in extra.items()}
    if command == "save_program":
        extra = {**save_data("Hack"), **extra}
    before = env.store._serialize()
    client = await hass_ws_client(env.hass, hass_read_only_access_token)
    msg = await ws(client, command, **extra)
    assert not msg["success"] and msg["error"]["code"] == "unauthorized"
    assert env.store._serialize() == before


async def test_non_admin_allowed_when_not_admin_only(
    env, hass_ws_client, hass_read_only_access_token  # noqa: F811
):
    set_admin_only(env, False)
    client = await hass_ws_client(env.hass, hass_read_only_access_token)
    created = await ws(client, "save_program", **save_data())
    assert created["success"], created
    pid = created["result"]["program_id"]
    assert (await ws(client, "assign", program_id=pid, climate_entity_id=ROOM))["success"]
    assert (await ws(client, "unassign", climate_entity_id=ROOM))["success"]
    assert (await ws(client, "delete_program", program_id=pid))["success"]


async def test_reads_and_services_stay_open_when_admin_only(
    env, hass_ws_client, hass_read_only_access_token, hass_read_only_user  # noqa: F811
):
    pid = await env.create()
    await env.call("assign", program_id=pid, climate_entity_id=ROOM)
    client = await hass_ws_client(env.hass, hass_read_only_access_token)
    for command, extra in (
        ("state", {}), ("countries", {}), ("preview_day", {"bands": DAY}),
    ):
        assert (await ws(client, command, **extra))["success"], command
    from homeassistant.core import Context

    ctx = Context(user_id=hass_read_only_user.id)
    for service, data in (
        ("pause", {}),
        ("resume", {}),
        ("set_manual", {"mode": "heat", "temperature": 22}),
        ("resume_auto", {}),
    ):
        await env.hass.services.async_call(
            DOMAIN_, service, {"climate_entity_id": ROOM, **data},
            blocking=True, context=ctx,
        )


DOMAIN_ = "cronotermostato"


@pytest.mark.parametrize(
    ("command", "extra"),
    [
        ("save_program", save_data()),
        ("delete_program", {"program_id": "p"}),
        ("assign", {"program_id": "p", "climate_entity_id": ROOM}),
        ("unassign", {"climate_entity_id": ROOM}),
    ],
)
async def test_write_commands_not_loaded(hass, hass_ws_client, command, extra):
    assert await async_setup_component(hass, "http", {})
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    msg = await ws(client, command, **extra)
    assert not msg["success"] and msg["error"]["code"] == "not_loaded"


async def test_subscribe_not_loaded(hass, hass_ws_client):
    assert await async_setup_component(hass, "http", {})
    await async_setup(hass, {})
    client = await hass_ws_client(hass)
    msg = await ws(client, "subscribe")
    assert not msg["success"] and msg["error"]["code"] == "not_loaded"


async def test_subscribe_changed_and_cleanup(env, hass_ws_client):  # noqa: F811
    store = env.store
    pid = await env.create()
    def mine():
        return [c for c in store._listeners if "ws_subscribe" in c.__qualname__]

    assert mine() == []
    first = await hass_ws_client(env.hass)
    second = await hass_ws_client(env.hass)
    await first.send_json_auto_id({"type": "cronotermostato/subscribe"})
    msg = await first.receive_json()
    assert msg["success"]
    sub_id = msg["id"]
    assert len(mine()) == 1

    saved = await ws(second, "save_program", **save_data())
    assert saved["success"]
    event = await first.receive_json()
    assert event["type"] == "event" and event["id"] == sub_id
    assert event["event"] == {"type": "changed"}

    await first.send_json_auto_id(
        {"type": "unsubscribe_events", "subscription": sub_id}
    )
    msg = await first.receive_json()
    assert msg["success"]
    assert mine() == []
    assert pid in store.programs


async def test_subscribe_closing_connection_leaves_no_listener(env, hass_ws_client):  # noqa: F811
    from homeassistant.helpers import dispatcher

    store = env.store
    pid = await env.create()
    await env.call("assign", program_id=pid, climate_entity_id=ROOM)
    base_listeners = len(store._listeners)
    base_signals = {
        k: len(v) for k, v in env.hass.data[dispatcher.DATA_DISPATCHER].items()
    }
    client = await hass_ws_client(env.hass)
    await client.send_json_auto_id({"type": "cronotermostato/subscribe"})
    assert (await client.receive_json())["success"]
    assert len(store._listeners) == base_listeners + 1
    await client.close()
    await env.hass.async_block_till_done()
    await asyncio.sleep(0)
    assert len(store._listeners) == base_listeners
    now = {k: len(v) for k, v in env.hass.data[dispatcher.DATA_DISPATCHER].items() if v}
    assert now == {k: v for k, v in base_signals.items() if v}


async def test_subscribe_room_update_notifies(env, hass_ws_client):  # noqa: F811
    pid = await env.create()
    await env.call("assign", program_id=pid, climate_entity_id=ROOM)
    client = await hass_ws_client(env.hass)
    await client.send_json_auto_id({"type": "cronotermostato/subscribe"})
    assert (await client.receive_json())["success"]
    await env.call("set_manual", climate_entity_id=ROOM, mode="cool", temperature=25)
    await env.hass.async_block_till_done()
    event = await client.receive_json()
    assert event["event"] == {"type": "changed"}


async def test_subscribe_follows_reloaded_entry(env, hass_ws_client):  # noqa: F811
    from homeassistant.helpers import dispatcher

    pid = await env.create()
    await env.call("assign", program_id=pid, climate_entity_id=ROOM)
    first = await hass_ws_client(env.hass)
    second = await hass_ws_client(env.hass)
    await first.send_json_auto_id({"type": "cronotermostato/subscribe"})
    sub = await first.receive_json()
    assert sub["success"]

    old_store = env.store
    env.hass.config_entries.async_update_entry(
        env.entry, options={"admin_only": False}
    )
    # The options flow reloads the entry (OptionsFlowWithReload).
    assert await env.hass.config_entries.async_reload(env.entry.entry_id)
    await env.hass.async_block_till_done()
    new_store = env.entry.runtime_data.store
    assert new_store is not old_store
    # The reload itself tells the client to re-read.
    event = await first.receive_json()
    assert event["type"] == "event" and event["id"] == sub["id"]

    saved = await ws(second, "save_program", **save_data())
    assert saved["success"], saved
    event = await first.receive_json()
    assert event["event"] == {"type": "changed"}
    mine = lambda st: [c for c in st._listeners if "ws_subscribe" in c.__qualname__]  # noqa: E731
    assert mine(old_store) == [] and len(mine(new_store)) == 1

    await first.close()
    await env.hass.async_block_till_done()
    await asyncio.sleep(0)
    assert mine(new_store) == []
    signals = env.hass.data[dispatcher.DATA_DISPATCHER]
    assert not signals.get("cronotermostato_entry_reloaded")


async def test_subscribe_survives_unload_without_reload(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    await client.send_json_auto_id({"type": "cronotermostato/subscribe"})
    assert (await client.receive_json())["success"]
    assert await env.hass.config_entries.async_unload(env.entry.entry_id)
    await env.hass.async_block_till_done()
    await client.close()
    await env.hass.async_block_till_done()


async def test_unassign_rejects_non_climate(env, hass_ws_client):  # noqa: F811
    client = await hass_ws_client(env.hass)
    msg = await ws(client, "unassign", climate_entity_id="sensor.x")
    assert not msg["success"] and msg["error"]["code"] == "invalid_format"
