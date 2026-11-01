"""Shared helpers for the entity platforms.

Dynamic entities
----------------
Rooms and programs come and go while Home Assistant runs. Each platform makes
an ``EntityTracker`` that, on every relevant change, compares the entities it
wants with the ones it has: new ones are added with ``async_add_entities``;
the ones no longer wanted are removed from the entity registry (which also
removes their state), and so are the registry entries left behind by an
earlier run. The room entities follow ``SIGNAL_ROOMS_CHANGED``, sent by the
``Manager`` once its controllers are started or stopped, so a room entity
never exists without a controller. The program entities follow the store.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import slugify

from .const import DOMAIN, SIGNAL_ROOM_UPDATED

if TYPE_CHECKING:
    from . import CronoData
    from .controller import RoomController
    from .engine.timeline import Slot


def room_name(hass: HomeAssistant, climate_id: str) -> str:
    """Name of the room: the name of its climate entity, else its object id.

    The entity registry comes first: at boot the state may not exist yet.
    """
    entry = er.async_get(hass).async_get(climate_id)
    if entry is not None and (name := entry.name or entry.original_name):
        return name
    state = hass.states.get(climate_id)
    if state is not None:
        return state.name
    return climate_id.split(".", 1)[1].replace("_", " ")


def slot_dict(slot: Slot | None) -> dict[str, Any] | None:
    """JSON-serializable form of a slot (datetimes in ISO format)."""
    if slot is None:
        return None
    return {
        "start": slot.start.isoformat(),
        "end": slot.end.isoformat(),
        "mode": slot.band.mode,
        "temperature": slot.band.temperature,
        "auto": slot.band.auto,
    }


class RoomEntity(Entity):
    """Base of the entities of a room (they share one device)."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _suffix: str
    """Unique id suffix (``<climate_id>_<suffix>``)."""
    ENTITY_DOMAIN: str

    def __init__(
        self, hass: HomeAssistant, data: CronoData, climate_id: str, object_suffix: str
    ) -> None:
        self._data = data
        self._climate_id = climate_id
        name = room_name(hass, climate_id)
        self._attr_unique_id = f"{climate_id}_{self._suffix}"
        # The entity id is Italian whatever the UI language is.
        self.entity_id = f"{self.ENTITY_DOMAIN}.{slugify(name)}_{object_suffix}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, climate_id)}, name=name
        )

    @property
    def controller(self) -> RoomController | None:
        """The controller of the room, if it exists."""
        return self._data.manager.controllers.get(self._climate_id)

    @property
    def available(self) -> bool:
        return self.controller is not None

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                SIGNAL_ROOM_UPDATED.format(self._climate_id),
                self.async_write_ha_state,
            )
        )
        # Program renames do not change the room's evaluation signature.
        self.async_on_remove(
            self._data.store.async_add_listener(self.async_write_ha_state)
        )


class EntityTracker:
    """Keeps the entities of one platform aligned with a wanted set."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        domain: str,
        wanted: Callable[[], dict[str, Callable[[], Entity]]],
        async_add_entities: AddConfigEntryEntitiesCallback,
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._domain = domain
        self._wanted = wanted
        self._add = async_add_entities
        self._known: set[str] = set()

    @callback
    def reconcile(self, *_: object) -> None:
        """Add the missing entities and remove the ones no longer wanted."""
        wanted = self._wanted()
        new = [make() for uid, make in wanted.items() if uid not in self._known]
        self._known = set(wanted)
        registry = er.async_get(self._hass)
        removed_devices: set[str] = set()
        for reg in er.async_entries_for_config_entry(
            registry, self._entry.entry_id
        ):
            if reg.domain == self._domain and reg.unique_id not in wanted:
                if reg.device_id:
                    removed_devices.add(reg.device_id)
                registry.async_remove(reg.entity_id)
        device_registry = dr.async_get(self._hass)
        for device_id in removed_devices:
            if not er.async_entries_for_device(
                registry, device_id, include_disabled_entities=True
            ):
                device_registry.async_remove_device(device_id)
        if new:
            self._add(new)
