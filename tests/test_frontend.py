"""Tests for the static files and the module URL of the editor."""

import logging
from unittest.mock import patch

from pytest_homeassistant_custom_component.common import MockConfigEntry
from yarl import URL

from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntryState
from homeassistant.loader import async_get_integration
from homeassistant.setup import async_setup_component

from custom_components.cronotermostato.const import (
    CONF_ADMIN_ONLY,
    CONF_COUNTRY,
    CONF_SHOW_SIDEBAR,
    CONF_SUBDIV,
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_URL_PATH,
    STATIC_URL_BASE,
)
from custom_components.cronotermostato.frontend import (
    async_module_url,
    async_register_static,
)


async def _base(hass):
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    version = (await async_get_integration(hass, DOMAIN)).version
    return f"{STATIC_URL_BASE}/{version}"


async def test_static_file_served(hass, hass_client):
    base = await _base(hass)
    client = await hass_client()
    resp = await client.get(f"{base}/cronotermostato.js")
    assert resp.status == 200
    assert "javascript" in resp.headers["Content-Type"]
    assert "Cronotermostato" in await resp.text()

    assert (await client.get(f"{base}/missing.js")).status == 404


async def test_static_path_traversal(hass, hass_client):
    base = await _base(hass)
    client = await hass_client()
    # encoded=True keeps the client from normalising the dots away.
    for tail in (
        "../manifest.json",
        "%2e%2e/manifest.json",
        "%2E%2E%2Fmanifest.json",
        "..%2fmanifest.json",
        "....//manifest.json",
        "sub/../../manifest.json",
    ):
        resp = await client.get(URL(f"{base}/{tail}", encoded=True))
        assert resp.status in (400, 403, 404), (tail, resp.status)
        assert "domain" not in await resp.text(), tail


async def test_static_registered_once(hass, hass_client):
    base = await _base(hass)

    def count():
        return sum(
            1
            for r in hass.http.app.router.resources()
            if getattr(r, "canonical", "").startswith(base)
        )

    first = count()
    assert first >= 1
    # A second pass must not register the path again.
    await async_register_static(hass)
    assert count() == first
    client = await hass_client()
    assert (await client.get(await async_module_url(hass))).status == 200


async def test_module_url_has_version(hass):
    version = (await async_get_integration(hass, DOMAIN)).version
    assert await async_module_url(hass) == (
        f"{STATIC_URL_BASE}/{version}/cronotermostato.js"
    )


async def _entry(hass, **options):
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_COUNTRY: "IT", CONF_SUBDIV: None},
        options=options,
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    return entry


def _extra_urls(hass):
    return hass.data[frontend.DATA_EXTRA_MODULE_URL].urls


async def test_panel_registered_by_default(hass):
    entry = await _entry(hass)
    assert frontend.async_panel_exists(hass, PANEL_URL_PATH)
    panel = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH]
    assert panel.require_admin is True
    assert panel.sidebar_title == "Cronotermostato"
    assert panel.sidebar_icon == "mdi:calendar-clock"
    custom = panel.config["_panel_custom"]
    version = (await async_get_integration(hass, DOMAIN)).version
    assert version in custom["module_url"]
    assert custom["module_url"] == await async_module_url(hass)
    assert custom["name"] == PANEL_ELEMENT
    assert custom["module_url"] in _extra_urls(hass)
    await hass.config_entries.async_unload(entry.entry_id)


async def test_panel_not_registered_when_disabled(hass):
    entry = await _entry(hass, **{CONF_SHOW_SIDEBAR: False})
    assert not frontend.async_panel_exists(hass, PANEL_URL_PATH)
    assert await async_module_url(hass) in _extra_urls(hass)
    await hass.config_entries.async_unload(entry.entry_id)


async def test_admin_only_false(hass):
    entry = await _entry(hass, **{CONF_ADMIN_ONLY: False})
    assert hass.data[frontend.DATA_PANELS][PANEL_URL_PATH].require_admin is False
    await hass.config_entries.async_unload(entry.entry_id)


async def _set_editor(hass, entry, **values):
    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"next_step_id": "editor"}
    )
    await hass.config_entries.options.async_configure(result["flow_id"], values)
    await hass.async_block_till_done()


async def test_reload_applies_options(hass, caplog):
    caplog.set_level(logging.WARNING)
    entry = await _entry(hass)
    assert frontend.async_panel_exists(hass, PANEL_URL_PATH)

    await _set_editor(hass, entry, **{CONF_SHOW_SIDEBAR: False, CONF_ADMIN_ONLY: True})
    assert entry.state is ConfigEntryState.LOADED
    assert not frontend.async_panel_exists(hass, PANEL_URL_PATH)
    assert await async_module_url(hass) in _extra_urls(hass)

    await _set_editor(hass, entry, **{CONF_SHOW_SIDEBAR: True, CONF_ADMIN_ONLY: False})
    assert frontend.async_panel_exists(hass, PANEL_URL_PATH)
    assert hass.data[frontend.DATA_PANELS][PANEL_URL_PATH].require_admin is False

    await _set_editor(hass, entry, **{CONF_SHOW_SIDEBAR: True, CONF_ADMIN_ONLY: True})
    assert hass.data[frontend.DATA_PANELS][PANEL_URL_PATH].require_admin is True

    assert "Overwriting panel" not in caplog.text
    assert "Removing unknown panel" not in caplog.text
    await hass.config_entries.async_unload(entry.entry_id)


async def test_unload_removes_everything(hass, caplog):
    caplog.set_level(logging.WARNING)
    entry = await _entry(hass)
    url = await async_module_url(hass)
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert not frontend.async_panel_exists(hass, PANEL_URL_PATH)
    assert url not in _extra_urls(hass)

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert frontend.async_panel_exists(hass, PANEL_URL_PATH)
    assert url in _extra_urls(hass)
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert "Removing unknown panel" not in caplog.text


async def test_unload_without_panel_is_silent(hass, caplog):
    caplog.set_level(logging.WARNING)
    entry = await _entry(hass, **{CONF_SHOW_SIDEBAR: False})
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert "Removing unknown panel" not in caplog.text


async def test_setup_failure_leaves_no_panel(hass):
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_COUNTRY: "IT", CONF_SUBDIV: None},
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)
    with patch(
        "custom_components.cronotermostato.manager.Manager.async_start",
        side_effect=RuntimeError("boom"),
    ):
        assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_ERROR
    assert not frontend.async_panel_exists(hass, PANEL_URL_PATH)
    assert await async_module_url(hass) not in _extra_urls(hass)


async def test_setup_failure_in_registration_stops_manager(hass):
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_COUNTRY: "IT", CONF_SUBDIV: None},
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)
    with (
        patch(
            "custom_components.cronotermostato.async_register_editor",
            side_effect=RuntimeError("boom"),
        ),
        patch(
            "custom_components.cronotermostato.manager.Manager.async_stop"
        ) as stop,
    ):
        assert not await hass.config_entries.async_setup(entry.entry_id)
    stop.assert_awaited_once()
    assert not frontend.async_panel_exists(hass, PANEL_URL_PATH)


CLIENT_ID = "https://example.com/app"


async def _panels_for(hass, hass_ws_client, user):
    token = hass.auth.async_create_access_token(
        await hass.auth.async_create_refresh_token(user, CLIENT_ID)
    )
    client = await hass_ws_client(hass, token)
    await client.send_json({"id": 1, "type": "get_panels"})
    msg = await client.receive_json()
    assert msg["success"]
    return msg["result"]


async def test_panel_hidden_from_non_admin(
    hass, hass_ws_client, hass_admin_user, hass_read_only_user
):
    assert await async_setup_component(hass, "frontend", {})
    entry = await _entry(hass)
    assert PANEL_URL_PATH not in await _panels_for(hass, hass_ws_client, hass_read_only_user)
    assert PANEL_URL_PATH in await _panels_for(hass, hass_ws_client, hass_admin_user)

    await _set_editor(hass, entry, **{CONF_SHOW_SIDEBAR: True, CONF_ADMIN_ONLY: False})
    assert PANEL_URL_PATH in await _panels_for(hass, hass_ws_client, hass_read_only_user)
    await hass.config_entries.async_unload(entry.entry_id)
