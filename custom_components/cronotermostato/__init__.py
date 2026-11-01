"""Cronotermostato: reusable weekly thermostat schedules for Home Assistant."""

from __future__ import annotations

from dataclasses import dataclass
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONF_ADMIN_ONLY,
    CONF_COUNTRY,
    CONF_SHOW_SIDEBAR,
    CONF_SUBDIV,
    DEFAULT_ADMIN_ONLY,
    DEFAULT_SHOW_SIDEBAR,
    DOMAIN,
    PLATFORMS,
)
from .engine.calendar import HolidayCalendar
from .frontend import (
    async_register_editor,
    async_register_static,
    async_unregister_editor,
)
from .manager import Manager
from .services import async_register_services
from .store import CronoStore
from .websocket_api import async_register_websocket_api

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


@dataclass
class CronoData:
    """Objects that live as long as the config entry is loaded."""

    store: CronoStore
    calendar: HolidayCalendar
    manager: Manager


type CronoConfigEntry = ConfigEntry[CronoData]


def entry_location(entry: ConfigEntry) -> tuple[str, str | None]:
    """Return (country, subdivision); the options win over the original data."""
    source = entry.options if entry.options.get(CONF_COUNTRY) else entry.data
    return source[CONF_COUNTRY], source.get(CONF_SUBDIV) or None


def entry_editor_options(entry: ConfigEntry) -> tuple[bool, bool]:
    """Return (show_sidebar, admin_only); entries without the keys use the defaults."""
    return (
        bool(entry.options.get(CONF_SHOW_SIDEBAR, DEFAULT_SHOW_SIDEBAR)),
        bool(entry.options.get(CONF_ADMIN_ONLY, DEFAULT_ADMIN_ONLY)),
    )


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register services and WebSocket commands (they exist even without a loaded entry)."""
    async_register_services(hass)
    async_register_websocket_api(hass)
    await async_register_static(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: CronoConfigEntry) -> bool:
    """Set up Cronotermostato from a config entry."""
    country, subdiv = entry_location(entry)
    try:
        # Loading the country module is blocking: keep it out of the event loop.
        calendar = await hass.async_add_executor_job(
            HolidayCalendar, country, subdiv
        )
    except ValueError as err:
        raise ConfigEntryError(
            translation_domain="cronotermostato",
            translation_key="unsupported_location",
            translation_placeholders={"country": country, "subdiv": subdiv or "-"},
        ) from err

    store = CronoStore(hass)
    await store.async_load()
    manager = Manager(hass, store, calendar)
    entry.runtime_data = CronoData(store, calendar, manager)
    try:
        await manager.async_start()
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
        await async_register_editor(hass, entry)
    except BaseException:
        await manager.async_stop()
        raise
    return True


async def async_unload_entry(hass: HomeAssistant, entry: CronoConfigEntry) -> bool:
    """Unload the config entry and stop every controller."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    await entry.runtime_data.manager.async_stop()
    await async_unregister_editor(hass)
    return True
