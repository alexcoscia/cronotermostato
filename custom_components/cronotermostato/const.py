"""Constants for the Cronotermostato integration."""

from homeassistant.const import Platform

DOMAIN = "cronotermostato"

STATIC_URL_BASE = "/cronotermostato_static"
PANEL_URL_PATH = "cronotermostato"
PANEL_ELEMENT = "cronotermostato-panel"
CARD_ELEMENT = "cronotermostato-card"

SIGNAL_ROOM_UPDATED = "cronotermostato_room_updated_{}"

CONF_COUNTRY = "country"
CONF_SUBDIV = "subdiv"

SIGNAL_ROOMS_CHANGED = "cronotermostato_rooms_changed"
"""Sent by the Manager after ``async_sync`` created or stopped a controller."""

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.SWITCH]

DEFAULT_MIN_TEMP = 5.0
DEFAULT_MAX_TEMP = 35.0
"""Limits used when the climate entity does not declare usable ``min_temp`` /
``max_temp`` attributes (or has no state at all)."""
