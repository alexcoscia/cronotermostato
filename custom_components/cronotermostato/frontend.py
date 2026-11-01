"""Static files of the Cronotermostato editor."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import (
    CONF_SHOW_SIDEBAR,
    DEFAULT_SHOW_SIDEBAR,
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_URL_PATH,
    STATIC_URL_BASE,
    entry_admin_only,
)

FRONTEND_DIR = Path(__file__).parent / "frontend"
ENTRY_FILE = "cronotermostato.js"
_DATA_STATIC = f"{DOMAIN}_static_registered"


async def async_register_static(hass: HomeAssistant) -> None:
    """Serve the frontend folder under a versioned path (once per HA run).

    A static path can be neither removed nor registered twice, so this runs
    from async_setup only. The version in the path changes the URL of every
    file, sub-modules included, whenever the integration is updated.
    """
    if hass.data.get(_DATA_STATIC):
        return
    hass.data[_DATA_STATIC] = True
    integration = await async_get_integration(hass, DOMAIN)
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                f"{STATIC_URL_BASE}/{integration.version}",
                str(FRONTEND_DIR),
                cache_headers=True,
            )
        ]
    )


async def async_module_url(hass: HomeAssistant) -> str:
    """Return the versioned URL of the entry module."""
    integration = await async_get_integration(hass, DOMAIN)
    return f"{STATIC_URL_BASE}/{integration.version}/{ENTRY_FILE}"


async def async_register_editor(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Register the Lovelace card module and, if wanted, the sidebar panel.

    Call it after the entry is fully set up, and pair it with
    async_unregister_editor on unload: a panel registered twice raises.
    """
    show_sidebar = bool(entry.options.get(CONF_SHOW_SIDEBAR, DEFAULT_SHOW_SIDEBAR))
    admin_only = entry_admin_only(entry)
    module_url = await async_module_url(hass)
    frontend.add_extra_js_url(hass, module_url)
    if not show_sidebar:
        return
    # A panel with this path that is not ours must survive a failed registration.
    panel_was_there = frontend.async_panel_exists(hass, PANEL_URL_PATH)
    try:
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=PANEL_ELEMENT,
            sidebar_title="Cronotermostato",
            sidebar_icon="mdi:calendar-clock",
            module_url=module_url,
            require_admin=admin_only,
        )
    except BaseException:
        frontend.remove_extra_js_url(hass, module_url)
        if not panel_was_there:
            frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
        raise


async def async_unregister_editor(hass: HomeAssistant) -> None:
    """Remove the panel and the extra module URL; safe if either is missing."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    frontend.remove_extra_js_url(hass, await async_module_url(hass))
