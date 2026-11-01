"""Static files of the Cronotermostato editor."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DOMAIN, STATIC_URL_BASE

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
