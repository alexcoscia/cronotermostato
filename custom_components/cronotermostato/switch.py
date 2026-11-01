"""Switch: on = the room follows its program, off = forced manually."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import CronoConfigEntry, CronoData
from .const import DOMAIN, SIGNAL_ROOMS_CHANGED
from .engine.models import ProgramError
from .entity import EntityTracker, RoomEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: CronoConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Track the room switches (one per controller)."""
    data = entry.runtime_data

    def wanted() -> dict[str, Any]:
        return {
            f"{climate_id}_auto": (lambda c=climate_id: AutoSwitch(hass, data, c))
            for climate_id in data.manager.controllers
        }

    tracker = EntityTracker(hass, entry, "switch", wanted, async_add_entities)
    entry.async_on_unload(
        async_dispatcher_connect(hass, SIGNAL_ROOMS_CHANGED, tracker.reconcile)
    )
    tracker.reconcile()


class AutoSwitch(RoomEntity, SwitchEntity):
    """On while the room follows its program."""

    _attr_translation_key = "auto"
    _suffix = "auto"
    ENTITY_DOMAIN = "switch"

    def __init__(self, hass: HomeAssistant, data: CronoData, climate_id: str) -> None:
        super().__init__(hass, data, climate_id, "automatico")

    @property
    def is_on(self) -> bool | None:
        controller = self.controller
        return None if controller is None else not controller.state.manual

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Force the setting of the current slot until it ends."""
        controller = self.controller
        slot = controller.state.slot if controller else None
        if controller is None or slot is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="room_not_ready"
            )
        try:
            await controller.async_set_manual(slot.band.mode, slot.band.temperature)
        except ProgramError as err:
            raise HomeAssistantError(str(err)) from err

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Go back to the program."""
        controller = self.controller
        if controller is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="room_not_ready"
            )
        try:
            await controller.async_resume_auto()
        except ProgramError as err:
            raise HomeAssistantError(str(err)) from err
