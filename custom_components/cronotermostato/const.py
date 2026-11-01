"""Constants for the Cronotermostato integration."""

from homeassistant.const import Platform

DOMAIN = "cronotermostato"

SIGNAL_ROOM_UPDATED = "cronotermostato_room_updated_{}"

CONF_COUNTRY = "country"
CONF_SUBDIV = "subdiv"

SIGNAL_ROOMS_CHANGED = "cronotermostato_rooms_changed"
"""Sent by the Manager after ``async_sync`` created or stopped a controller."""

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.SWITCH]
