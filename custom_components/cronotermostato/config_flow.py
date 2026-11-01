"""Config and options flow: choose the country (and subdivision) for holidays."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlowWithReload,
)
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .const import CONF_COUNTRY, CONF_SUBDIV, DOMAIN
from .engine.calendar import HolidayCalendar, supported_countries


def _select(options: list[str]) -> SelectSelector:
    return SelectSelector(
        SelectSelectorConfig(options=options, mode=SelectSelectorMode.DROPDOWN, sort=True)
    )


class _LocationStepsMixin:
    """Shared country and subdivision steps (config flow and options flow)."""

    _countries: dict[str, list[str]]
    _country: str

    async def _async_load_countries(self) -> dict[str, list[str]]:
        if not hasattr(self, "_countries"):
            self._countries = await self.hass.async_add_executor_job(  # type: ignore[attr-defined]
                supported_countries
            )
        return self._countries

    async def _async_country_step(
        self, step_id: str, user_input: dict[str, Any] | None, default: str | None
    ) -> ConfigFlowResult | None:
        """Handle the country step; return a form, or None when a country is set."""
        countries = await self._async_load_countries()
        errors: dict[str, str] = {}
        if user_input is not None:
            country = str(user_input[CONF_COUNTRY]).strip().upper()
            if country in countries:
                self._country = country
                return None
            errors[CONF_COUNTRY] = "unsupported_country"
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_COUNTRY, **({"default": default} if default else {})
                ): _select(list(countries))
            }
        )
        return self.async_show_form(  # type: ignore[attr-defined]
            step_id=step_id, data_schema=schema, errors=errors
        )

    async def _async_subdiv_form(
        self, step_id: str, default: str | None
    ) -> ConfigFlowResult:
        subdivs = self._countries[self._country]
        key = vol.Optional(
            CONF_SUBDIV, **({"default": default} if default in subdivs else {})
        )
        return self.async_show_form(  # type: ignore[attr-defined]
            step_id=step_id,
            data_schema=vol.Schema({key: _select(subdivs)}),
            description_placeholders={"country": self._country},
        )

    async def _async_check(
        self, subdiv: str | None
    ) -> str | None:
        """Return an error key when the country/subdivision pair is unusable."""
        try:
            await self.hass.async_add_executor_job(  # type: ignore[attr-defined]
                HolidayCalendar, self._country, subdiv
            )
        except ValueError:
            return "unsupported_subdiv"
        return None


class CronoConfigFlow(_LocationStepsMixin, ConfigFlow, domain=DOMAIN):
    """Handle the initial configuration."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> CronoOptionsFlow:
        """Create the options flow."""
        return CronoOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 1: the country."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        default = self.hass.config.country
        form = await self._async_country_step(
            "user", user_input, default.upper() if default else None
        )
        if form is not None:
            return form
        if self._countries[self._country]:
            return await self.async_step_subdiv()
        return await self._async_create(None)

    async def async_step_subdiv(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 2 (only if the country has subdivisions): optional subdivision."""
        if user_input is None:
            return await self._async_subdiv_form("subdiv", None)
        return await self._async_create(user_input.get(CONF_SUBDIV) or None)

    async def _async_create(self, subdiv: str | None) -> ConfigFlowResult:
        if (error := await self._async_check(subdiv)) is not None:
            return self.async_abort(reason=error)
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(
            title="Cronotermostato",
            data={CONF_COUNTRY: self._country, CONF_SUBDIV: subdiv},
        )


class CronoOptionsFlow(_LocationStepsMixin, OptionsFlowWithReload):
    """Change country and subdivision; the entry reloads and recomputes."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 1: the country."""
        from . import entry_location

        country, _ = entry_location(self.config_entry)
        form = await self._async_country_step("init", user_input, country)
        if form is not None:
            return form
        if self._countries[self._country]:
            return await self.async_step_subdiv()
        return await self._async_save(None)

    async def async_step_subdiv(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 2 (only if the country has subdivisions): optional subdivision."""
        if user_input is None:
            from . import entry_location

            country, subdiv = entry_location(self.config_entry)
            return await self._async_subdiv_form(
                "subdiv", subdiv if country == self._country else None
            )
        return await self._async_save(user_input.get(CONF_SUBDIV) or None)

    async def _async_save(self, subdiv: str | None) -> ConfigFlowResult:
        if (error := await self._async_check(subdiv)) is not None:
            return self.async_abort(reason=error)
        return self.async_create_entry(
            data={CONF_COUNTRY: self._country, CONF_SUBDIV: subdiv}
        )
