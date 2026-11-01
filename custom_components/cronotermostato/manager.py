"""Manager: one room controller per assigned climate entity."""

from __future__ import annotations

import asyncio
from collections.abc import Callable

from homeassistant.core import HomeAssistant, callback

from .controller import RoomController
from .engine.calendar import HolidayCalendar
from .store import CronoStore


class Manager:
    """Creates and stops the room controllers following the assignments."""

    def __init__(
        self, hass: HomeAssistant, store: CronoStore, calendar: HolidayCalendar
    ) -> None:
        self._hass = hass
        self._store = store
        self._calendar = calendar
        self.controllers: dict[str, RoomController] = {}
        self._lock = asyncio.Lock()
        self._unsub: Callable[[], None] | None = None
        self._stopped = True

    async def async_start(self) -> None:
        """Start following the store and start a controller per room."""
        self._stopped = False
        if self._unsub is None:
            self._unsub = self._store.async_add_listener(self._store_changed)
        await self.async_sync()

    async def async_stop(self) -> None:
        """Stop every controller and the store listener."""
        self._stopped = True
        if self._unsub:
            self._unsub()
            self._unsub = None
        async with self._lock:
            controllers, self.controllers = list(self.controllers.values()), {}
            for controller in controllers:
                await controller.async_stop()

    async def async_refresh_all(self) -> None:
        """Reapply the current setting of every room."""
        for controller in list(self.controllers.values()):
            await controller.async_refresh()

    async def async_sync(self) -> None:
        """Align the controllers with the assignments."""
        async with self._lock:
            if self._stopped:
                return
            wanted = set(self._store.assignments)
            for climate_id in [c for c in self.controllers if c not in wanted]:
                await self.controllers.pop(climate_id).async_stop()
            for climate_id in sorted(wanted - set(self.controllers)):
                controller = RoomController(
                    self._hass, self._store, self._calendar, climate_id
                )
                self.controllers[climate_id] = controller
                await controller.async_start()

    @callback
    def _store_changed(self) -> None:
        if set(self._store.assignments) != set(self.controllers):
            self._hass.async_create_task(self.async_sync())
