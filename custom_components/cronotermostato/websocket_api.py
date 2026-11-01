"""WebSocket API for the editor.

Design decisions:

* The read commands (``state``, ``countries``, ``subscribe``) and the pure
  one (``preview_day`` computes, stores nothing) are open to every
  authenticated user: the same data is already in the attributes of the
  program sensors, which any user can read.
* The structural write commands (``save_program``, ``delete_program``,
  ``assign``, ``unassign``) follow the ``admin_only`` option of the entry:
  when it is on and ``connection.user.is_admin`` is false they answer
  ``unauthorized`` and change nothing. They are thin wrappers on the same
  functions the services use (``services.py``), so there is no duplicated
  logic. The services themselves stay open to every user (open decision for
  the owner; changing it is a separate task).
* ``save_program`` is optimistic concurrency: ``expected_revision`` (see
  ``program_revision``) must match the stored program, else ``conflict`` and
  nothing changes. Without it the save overwrites (the editor's explicit
  "overwrite" choice). An unknown ``program_id`` is ``not_found``: a save
  never creates a program with an id chosen by the client.
* ``subscribe`` sends ``{"type": "changed"}`` on every store change and on
  every room update; the client re-reads ``state``. Listeners are removed
  when the subscription or the connection closes.
* The commands are registered in ``async_setup`` (like the services); without
  a loaded config entry ``state`` answers ``not_loaded``. ``preview_day`` and
  ``countries`` need no entry.
* ``status`` of a room is the controller's ``RoomStatus`` (``ok``, ``paused``,
  ``unavailable``...); a room assigned in the store whose controller does not
  exist yet (sync pending or start failed) is ``not_running``. The editor
  must treat ``status`` as an open string, not a closed set.
* ``preview_day`` discards incoming bands with ``auto: true``: the editor may
  send back the normalized output, and automatic bands are always computed.
* ``countries`` is large: computed once in the executor and cached.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import cache
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import (
    CONF_ADMIN_ONLY,
    DEFAULT_ADMIN_ONLY,
    DOMAIN,
    SIGNAL_ROOM_UPDATED,
    SIGNAL_ROOMS_CHANGED,
)
from .engine.calendar import supported_countries
from .engine.day import program_views
from .engine.models import (
    DAYS_PER_WEEK,
    ProgramError,
    program_from_dict,
    program_revision,
)
from .entity import room_name, slot_dict
from .services import (
    async_assign_room,
    async_create_program,
    async_unassign_room,
    async_update_program,
    climate_exists,
)

ERR_NOT_LOADED = "not_loaded"
ERR_INVALID_FORMAT = websocket_api.ERR_INVALID_FORMAT
ERR_NOT_FOUND = websocket_api.ERR_NOT_FOUND
ERR_UNAUTHORIZED = websocket_api.ERR_UNAUTHORIZED
ERR_CONFLICT = "conflict"

_cached_countries = cache(supported_countries)


@callback
def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register the WebSocket commands."""
    websocket_api.async_register_command(hass, ws_state)
    websocket_api.async_register_command(hass, ws_preview_day)
    websocket_api.async_register_command(hass, ws_countries)
    websocket_api.async_register_command(hass, ws_save_program)
    websocket_api.async_register_command(hass, ws_delete_program)
    websocket_api.async_register_command(hass, ws_assign)
    websocket_api.async_register_command(hass, ws_unassign)
    websocket_api.async_register_command(hass, ws_subscribe)


def _loaded_data(connection: websocket_api.ActiveConnection, msg: dict[str, Any]):
    """Return (entry, runtime data) or answer ``not_loaded`` and return None."""
    entries = connection.hass.config_entries.async_loaded_entries(DOMAIN)
    if not entries:
        connection.send_error(msg["id"], ERR_NOT_LOADED, "Cronotermostato is not loaded")
        return None
    return entries[0], entries[0].runtime_data


def _admin_only(entry) -> bool:
    return bool(entry.options.get(CONF_ADMIN_ONLY, DEFAULT_ADMIN_ONLY))


def _require_editor_rights(
    entry, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> bool:
    """Answer ``unauthorized`` and return False if the user may not edit."""
    if _admin_only(entry) and not connection.user.is_admin:
        connection.send_error(
            msg["id"], ERR_UNAUTHORIZED, "Only administrators can edit programs"
        )
        return False
    return True


def _writer(connection: websocket_api.ActiveConnection, msg: dict[str, Any]):
    """Common prologue of the write commands: data if loaded and allowed."""
    loaded = _loaded_data(connection, msg)
    if loaded is None or not _require_editor_rights(loaded[0], connection, msg):
        return None
    return loaded[1]


def _check_program(
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    store,
    program_id: str,
    expected_revision: str | None,
) -> bool:
    """``not_found`` / ``conflict`` checks; True if the program may be changed."""
    program = store.programs.get(program_id)
    if program is None:
        connection.send_error(msg["id"], ERR_NOT_FOUND, f"Unknown program: {program_id}")
        return False
    if expected_revision is not None and expected_revision != program_revision(program):
        connection.send_error(
            msg["id"], ERR_CONFLICT, "The program was modified elsewhere"
        )
        return False
    return True


@websocket_api.websocket_command({vol.Required("type"): "cronotermostato/state"})
@callback
def ws_state(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Programs (user and normalized bands), rooms and holiday location."""
    loaded = _loaded_data(connection, msg)
    if loaded is None:
        return
    entry, data = loaded
    store, manager = data.store, data.manager
    programs = [
        {**program_views(p), "revision": program_revision(p)}
        for p in store.programs.values()
    ]
    rooms = []
    for climate_id, assignment in sorted(store.assignments.items()):
        controller = manager.controllers.get(climate_id)
        state = controller.state if controller else None
        climate = hass.states.get(climate_id)
        program = store.programs.get(assignment.program_id)
        rooms.append(
            {
                "climate_entity_id": climate_id,
                "name": room_name(hass, climate_id),
                "program_id": assignment.program_id,
                "program_name": program.name if program else None,
                "paused": assignment.paused,
                "climate_available": (
                    climate is not None and climate.state != STATE_UNAVAILABLE
                ),
                "status": state.status if state else "not_running",
                "slot": slot_dict(state.slot) if state else None,
                "next_slot": slot_dict(state.next_slot) if state else None,
                "manual": state.manual if state else False,
                "override_until": (
                    state.override_until.isoformat()
                    if state and state.override_until
                    else None
                ),
                "holiday": state.holiday if state else False,
            }
        )
    connection.send_result(
        msg["id"],
        {
            "programs": programs,
            "rooms": rooms,
            "country": data.calendar.country,
            "subdiv": data.calendar.subdiv,
            "options": {"admin_only": _admin_only(entry)},
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "cronotermostato/preview_day",
        vol.Required("bands"): list,
    }
)
@callback
def ws_preview_day(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Normalize the bands of one day (adds the automatic "off" bands)."""
    try:
        user_bands = [
            b for b in msg["bands"] if not (isinstance(b, dict) and b.get("auto") is True)
        ]
        # Same validation as the store, on a throw-away program.
        program = program_from_dict(
            {
                "id": "preview",
                "name": "preview",
                "week": [user_bands] + [[]] * (DAYS_PER_WEEK - 1),
                "holiday": [],
            }
        )
    except ProgramError as err:
        connection.send_error(msg["id"], ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"], {"bands": program_views(program)["week_full"][0]})


@websocket_api.websocket_command({vol.Required("type"): "cronotermostato/countries"})
@websocket_api.async_response
async def ws_countries(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Country code -> subdivision codes (cached; first call in the executor)."""
    connection.send_result(
        msg["id"], await hass.async_add_executor_job(_cached_countries)
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "cronotermostato/save_program",
        vol.Optional("program_id"): str,
        vol.Required("name"): str,
        vol.Required("week"): list,
        vol.Required("holiday"): list,
        vol.Optional("expected_revision"): str,
    }
)
@websocket_api.async_response
async def ws_save_program(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Create a program, or update one with a concurrency check."""
    data = _writer(connection, msg)
    if data is None:
        return
    store = data.store
    program_id = msg.get("program_id")
    if program_id is not None and not _check_program(
        connection, msg, store, program_id, msg.get("expected_revision")
    ):
        return
    try:
        if program_id is None:
            program = await async_create_program(
                store, msg["name"], msg["week"], msg["holiday"]
            )
        else:
            program = await async_update_program(
                store,
                program_id,
                name=msg["name"],
                week=msg["week"],
                holiday=msg["holiday"],
            )
    except ProgramError as err:
        connection.send_error(msg["id"], ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(
        msg["id"],
        {"program_id": program.id, "revision": program_revision(program)},
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "cronotermostato/delete_program",
        vol.Required("program_id"): str,
        vol.Optional("expected_revision"): str,
    }
)
@websocket_api.async_response
async def ws_delete_program(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Delete a program that has no rooms."""
    data = _writer(connection, msg)
    if data is None:
        return
    if not _check_program(
        connection, msg, data.store, msg["program_id"], msg.get("expected_revision")
    ):
        return
    try:
        await data.store.async_delete_program(msg["program_id"])
    except ProgramError as err:
        connection.send_error(msg["id"], ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "cronotermostato/assign",
        vol.Required("program_id"): str,
        vol.Required("climate_entity_id"): str,
    }
)
@websocket_api.async_response
async def ws_assign(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Assign a climate entity to a program."""
    data = _writer(connection, msg)
    if data is None:
        return
    climate_id = msg["climate_entity_id"]
    if not climate_id.startswith("climate."):
        connection.send_error(
            msg["id"], ERR_INVALID_FORMAT, f"Not a climate entity: {climate_id}"
        )
        return
    if not climate_exists(hass, climate_id):
        connection.send_error(
            msg["id"], ERR_NOT_FOUND, f"Unknown climate entity: {climate_id}"
        )
        return
    if not _check_program(connection, msg, data.store, msg["program_id"], None):
        return
    try:
        await async_assign_room(data.manager, climate_id, msg["program_id"])
    except ProgramError as err:
        connection.send_error(msg["id"], ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "cronotermostato/unassign",
        vol.Required("climate_entity_id"): str,
    }
)
@websocket_api.async_response
async def ws_unassign(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Remove the assignment of a climate entity."""
    data = _writer(connection, msg)
    if data is None:
        return
    await async_unassign_room(data.manager, msg["climate_entity_id"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): "cronotermostato/subscribe"})
@callback
def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Send ``{"type": "changed"}`` on every store or room change."""
    loaded = _loaded_data(connection, msg)
    if loaded is None:
        return
    store = loaded[1].store
    msg_id = msg["id"]
    room_unsubs: dict[str, Callable[[], None]] = {}
    closed = False

    @callback
    def notify() -> None:
        if not closed:
            connection.send_message(
                websocket_api.event_message(msg_id, {"type": "changed"})
            )

    @callback
    def follow_rooms() -> None:
        """Listen to the update signal of every assigned room."""
        if closed:
            return
        wanted = set(store.assignments)
        for climate_id in set(room_unsubs) - wanted:
            room_unsubs.pop(climate_id)()
        for climate_id in wanted - set(room_unsubs):
            room_unsubs[climate_id] = async_dispatcher_connect(
                hass, SIGNAL_ROOM_UPDATED.format(climate_id), notify
            )

    @callback
    def store_changed() -> None:
        follow_rooms()
        notify()

    unsub_store = store.async_add_listener(store_changed)
    unsub_rooms = async_dispatcher_connect(hass, SIGNAL_ROOMS_CHANGED, follow_rooms)

    @callback
    def unsubscribe() -> None:
        nonlocal closed
        closed = True
        unsub_store()
        unsub_rooms()
        for unsub in room_unsubs.values():
            unsub()
        room_unsubs.clear()

    connection.subscriptions[msg_id] = unsubscribe
    follow_rooms()
    connection.send_result(msg_id)
