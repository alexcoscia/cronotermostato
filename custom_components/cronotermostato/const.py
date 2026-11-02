"""Constants for the Cronotermostato integration."""

from typing import TYPE_CHECKING

from homeassistant.const import Platform

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry

DOMAIN = "cronotermostato"

STATIC_URL_BASE = "/cronotermostato_static"
PANEL_URL_PATH = "cronotermostato"
PANEL_ELEMENT = "cronotermostato-panel"
CARD_ELEMENT = "cronotermostato-card"

SIGNAL_ROOM_UPDATED = "cronotermostato_room_updated_{}"

CONF_COUNTRY = "country"
CONF_SUBDIV = "subdiv"
CONF_SHOW_SIDEBAR = "show_sidebar"
CONF_ADMIN_ONLY = "admin_only"
DEFAULT_SHOW_SIDEBAR = True
DEFAULT_ADMIN_ONLY = True


def entry_admin_only(entry: "ConfigEntry") -> bool:
    """Whether only administrators may edit (entries without the key: default)."""
    return bool(entry.options.get(CONF_ADMIN_ONLY, DEFAULT_ADMIN_ONLY))


SIGNAL_ENTRY_RELOADED = "cronotermostato_entry_reloaded"
"""Sent at the end of a successful ``async_setup_entry`` with the new
``CronoData``: open subscriptions rebind to its store."""

SIGNAL_ROOMS_CHANGED = "cronotermostato_rooms_changed"
"""Sent by the Manager after ``async_sync`` created or stopped a controller."""

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.SWITCH]

DEFAULT_MIN_TEMP = 5.0
DEFAULT_MAX_TEMP = 35.0
"""Limits used when the climate entity does not declare usable ``min_temp`` /
``max_temp`` attributes (or has no state at all)."""

DAY_KINDS: tuple[str, ...] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
"""Day kinds of a program's week, Monday first (``Program.week`` order)."""
HOLIDAY_KIND = "holiday"
"""The day kind of the holiday day of a program."""
