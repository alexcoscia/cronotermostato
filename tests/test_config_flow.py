"""Tests for the config flow and the options flow."""

from unittest.mock import patch

import pytest
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType, InvalidData
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.cronotermostato import entry_editor_options, entry_location
from custom_components.cronotermostato.const import (
    CONF_ADMIN_ONLY,
    CONF_COUNTRY,
    CONF_SHOW_SIDEBAR,
    CONF_SUBDIV,
    DOMAIN,
)


async def _start(hass):
    return await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )


async def test_country_with_subdivisions_then_optional_subdiv(hass):
    result = await _start(hass)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_COUNTRY: "IT"}
    )
    assert result["step_id"] == "subdiv"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {CONF_COUNTRY: "IT", CONF_SUBDIV: None}


async def test_subdiv_chosen(hass):
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_COUNTRY: "IT"}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_SUBDIV: "RM"}
    )
    assert result["data"] == {CONF_COUNTRY: "IT", CONF_SUBDIV: "RM"}


async def test_unknown_country_rejected_by_selector(hass):
    result = await _start(hass)
    with pytest.raises(InvalidData):
        await hass.config_entries.flow.async_configure(
            result["flow_id"], {CONF_COUNTRY: "it"}
        )


async def test_country_is_normalized_to_uppercase(hass):
    result = await _start(hass)
    flow = hass.config_entries.flow._progress[result["flow_id"]]
    out = await flow.async_step_user({CONF_COUNTRY: " it "})
    assert out["step_id"] == "subdiv"
    assert flow._country == "IT"


async def test_country_without_subdivisions_skips_step(hass):
    from custom_components.cronotermostato.engine.calendar import supported_countries

    plain = next(c for c, v in supported_countries().items() if not v and c != "XK")
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_COUNTRY: plain}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {CONF_COUNTRY: plain, CONF_SUBDIV: None}


async def test_second_instance_rejected(hass):
    MockConfigEntry(domain=DOMAIN, data={CONF_COUNTRY: "IT", CONF_SUBDIV: None}).add_to_hass(hass)
    result = await _start(hass)
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"


async def test_options_change_country_and_subdiv(hass):
    entry = MockConfigEntry(
        domain=DOMAIN, data={CONF_COUNTRY: "IT", CONF_SUBDIV: None}, unique_id=DOMAIN
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.MENU
    assert result["step_id"] == "init"
    assert result["menu_options"] == ["location", "editor"]
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"next_step_id": "location"}
    )
    assert result["step_id"] == "location"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_COUNTRY: "US"}
    )
    assert result["step_id"] == "subdiv"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_SUBDIV: "CA"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert entry.options == {CONF_COUNTRY: "US", CONF_SUBDIV: "CA"}
    assert entry.runtime_data.calendar.country == "US"
    assert entry.runtime_data.calendar.subdiv == "CA"
    await hass.config_entries.async_unload(entry.entry_id)


async def _setup_entry(hass, options=None):
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_COUNTRY: "IT", CONF_SUBDIV: None},
        options=options or {},
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def _open_step(hass, entry, step):
    result = await hass.config_entries.options.async_init(entry.entry_id)
    return await hass.config_entries.options.async_configure(
        result["flow_id"], {"next_step_id": step}
    )


async def test_old_entry_uses_editor_defaults(hass):
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_COUNTRY: "IT", CONF_SUBDIV: None})
    assert entry_editor_options(entry) == (True, True)
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_COUNTRY: "IT"},
        options={CONF_COUNTRY: "US", CONF_SUBDIV: "CA"},
    )
    assert entry_editor_options(entry) == (True, True)
    assert entry_location(entry) == ("US", "CA")


async def test_editor_options_saved_and_reload_once(hass):
    entry = await _setup_entry(hass, {CONF_COUNTRY: "US", CONF_SUBDIV: "CA"})
    result = await _open_step(hass, entry, "editor")
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "editor"
    with patch.object(
        hass.config_entries, "async_reload", wraps=hass.config_entries.async_reload
    ) as reload:
        result = await hass.config_entries.options.async_configure(
            result["flow_id"], {CONF_SHOW_SIDEBAR: False, CONF_ADMIN_ONLY: False}
        )
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert reload.call_count == 1
    assert entry.options == {
        CONF_COUNTRY: "US",
        CONF_SUBDIV: "CA",
        CONF_SHOW_SIDEBAR: False,
        CONF_ADMIN_ONLY: False,
    }
    assert entry_editor_options(entry) == (False, False)
    assert entry_location(entry) == ("US", "CA")
    await hass.config_entries.async_unload(entry.entry_id)


async def test_editor_form_defaults_follow_entry(hass):
    entry = await _setup_entry(hass, {CONF_SHOW_SIDEBAR: False})
    result = await _open_step(hass, entry, "editor")
    defaults = {str(k): k.default() for k in result["data_schema"].schema}
    assert defaults == {CONF_SHOW_SIDEBAR: False, CONF_ADMIN_ONLY: True}
    await hass.config_entries.async_unload(entry.entry_id)


async def test_location_keeps_editor_options(hass):
    entry = await _setup_entry(
        hass, {CONF_SHOW_SIDEBAR: False, CONF_ADMIN_ONLY: False}
    )
    result = await _open_step(hass, entry, "location")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_COUNTRY: "US"}
    )
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_SUBDIV: "CA"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert entry.options == {
        CONF_COUNTRY: "US",
        CONF_SUBDIV: "CA",
        CONF_SHOW_SIDEBAR: False,
        CONF_ADMIN_ONLY: False,
    }
    await hass.config_entries.async_unload(entry.entry_id)


async def test_location_without_subdivisions_keeps_editor_options(hass):
    from custom_components.cronotermostato.engine.calendar import supported_countries

    plain = next(c for c, v in supported_countries().items() if not v and c != "XK")
    entry = await _setup_entry(hass, {CONF_ADMIN_ONLY: False})
    result = await _open_step(hass, entry, "location")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_COUNTRY: plain}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert entry.options == {
        CONF_COUNTRY: plain,
        CONF_SUBDIV: None,
        CONF_ADMIN_ONLY: False,
    }
    await hass.config_entries.async_unload(entry.entry_id)
