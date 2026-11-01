"""Tests for the config flow and the options flow."""

import pytest
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType, InvalidData
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.cronotermostato.const import CONF_COUNTRY, CONF_SUBDIV, DOMAIN


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
    assert result["step_id"] == "init"
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
