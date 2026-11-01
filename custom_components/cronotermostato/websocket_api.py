"""WebSocket API for the editor.

Design decisions:

* The commands are read-only (``state``, ``countries``) or pure (``preview_day``
  computes, stores nothing). Changes to programs go through the services.
* They are therefore open to every authenticated user, not admin-only: the
  same data is already in the attributes of the program sensors, which any
  user can read. Only the services, which act on thermostats, are the place
  for permission policy.
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

from functools import cache
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .engine.calendar import supported_countries
from .engine.day import program_views
from .engine.models import DAYS_PER_WEEK, ProgramError, program_from_dict
from .entity import room_name, slot_dict

ERR_NOT_LOADED = "not_loaded"
ERR_INVALID_FORMAT = websocket_api.ERR_INVALID_FORMAT

_cached_countries = cache(supported_countries)


@callback
def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register the WebSocket commands."""
    websocket_api.async_register_command(hass, ws_state)
    websocket_api.async_register_command(hass, ws_preview_day)
    websocket_api.async_register_command(hass, ws_countries)


@websocket_api.websocket_command({vol.Required("type"): "cronotermostato/state"})
@callback
def ws_state(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Programs (user and normalized bands), rooms and holiday location."""
    entries = hass.config_entries.async_loaded_entries(DOMAIN)
    if not entries:
        connection.send_error(msg["id"], ERR_NOT_LOADED, "Cronotermostato is not loaded")
        return
    data = entries[0].runtime_data
    store, manager = data.store, data.manager
    programs = [program_views(p) for p in store.programs.values()]
    rooms = []
    for climate_id, assignment in sorted(store.assignments.items()):
        controller = manager.controllers.get(climate_id)
        state = controller.state if controller else None
        program = store.programs.get(assignment.program_id)
        rooms.append(
            {
                "climate_entity_id": climate_id,
                "name": room_name(hass, climate_id),
                "program_id": assignment.program_id,
                "program_name": program.name if program else None,
                "paused": assignment.paused,
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
