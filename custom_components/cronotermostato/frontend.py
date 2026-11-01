"""Static files of the Cronotermostato editor."""

from __future__ import annotations

import hashlib
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
_DATA_PREFIX = f"{DOMAIN}_static_prefix"


def frontend_fingerprint(directory: Path) -> str:
    """Return the first 8 hex digits of a sha256 over all files of a folder.

    Relative names (POSIX style) and contents are hashed in path order, so the
    result depends on what the files are, not on the order they are listed in.
    Blocking: call it in the executor.
    """
    digest = hashlib.sha256()
    files = sorted(
        (p.relative_to(directory).as_posix(), p)
        for p in directory.rglob("*")
        if p.is_file()
    )
    for name, path in files:
        encoded = name.encode()
        digest.update(len(encoded).to_bytes(4, "big") + encoded)
        content = path.read_bytes()
        digest.update(len(content).to_bytes(8, "big") + content)
    return digest.hexdigest()[:8]


async def _async_static_prefix(hass: HomeAssistant) -> str:
    """Return `<base>/<version>-<fingerprint>`, computed once per HA run."""
    prefix = hass.data.get(_DATA_PREFIX)
    if prefix is None:
        integration = await async_get_integration(hass, DOMAIN)
        fingerprint = await hass.async_add_executor_job(
            frontend_fingerprint, FRONTEND_DIR
        )
        prefix = hass.data.setdefault(
            _DATA_PREFIX, f"{STATIC_URL_BASE}/{integration.version}-{fingerprint}"
        )
    return prefix


async def async_register_static(hass: HomeAssistant) -> None:
    """Serve the frontend folder under a path with a content fingerprint.

    A static path can be neither removed nor registered twice, so this runs
    from async_setup only. The version in the path changes the URL of every
    file, sub-modules included, whenever the version or any file changes.
    """
    if hass.data.get(_DATA_STATIC):
        return
    hass.data[_DATA_STATIC] = True
    prefix = await _async_static_prefix(hass)
    await hass.http.async_register_static_paths(
        [StaticPathConfig(prefix, str(FRONTEND_DIR), cache_headers=True)]
    )


async def async_module_url(hass: HomeAssistant) -> str:
    """Return the URL of the entry module (version and fingerprint in the path)."""
    return f"{await _async_static_prefix(hass)}/{ENTRY_FILE}"


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
