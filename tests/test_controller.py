"""Tests for the room controller and the manager."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.cronotermostato.const import SIGNAL_ROOM_UPDATED
from custom_components.cronotermostato.controller import RoomController
from custom_components.cronotermostato.engine.calendar import HolidayCalendar
from custom_components.cronotermostato.engine.models import Band, ProgramError
from custom_components.cronotermostato.manager import Manager
from custom_components.cronotermostato.store import CronoStore, Override

TZ = ZoneInfo("Europe/Rome")
ROOM = "climate.salotto"
DAY = (Band(480, 720, "heat", 23.0), Band(1080, 1380, "heat", 20.0))
WEEK = (DAY,) * 5 + ((Band(540, 600, "heat", 21.0),), ())
HOLIDAY = (Band(0, 1440, "heat", 18.0),)
HEAT_23 = [("set_hvac_mode", "heat"), ("set_temperature", 23.0)]


def at(day: int, hour: int, minute: int = 0) -> datetime:
    """Local time in October 2026 (Mon 26th, Tue 27th...)."""
    return datetime(2026, 10, day, hour, minute, tzinfo=TZ)


@dataclass
class Env:
    hass: object
    freezer: object
    store: CronoStore
    calendar: HolidayCalendar
    program_id: str
    calls: list = field(default_factory=list)
    fail: dict = field(default_factory=dict)
    managers: list = field(default_factory=list)
    other_calls: list = field(default_factory=list)

    def set_climate(self, state="heat", modes=("heat", "off")):
        self.hass.states.async_set(ROOM, state, {"hvac_modes": list(modes)})

    def manager(self) -> Manager:
        manager = Manager(self.hass, self.store, self.calendar)
        self.managers.append(manager)
        return manager

    async def start(self) -> Manager:
        manager = self.manager()
        await manager.async_start()
        await self.hass.async_block_till_done()
        return manager

    async def go(self, when: datetime) -> None:
        self.freezer.move_to(when)
        async_fire_time_changed(self.hass, when)
        await self.hass.async_block_till_done()


@pytest.fixture
async def env(hass, freezer):
    await hass.config.async_set_time_zone("Europe/Rome")
    freezer.move_to(at(26, 9))  # Monday
    store = CronoStore(hass)
    await store.async_load()
    prog = await store.async_create_program("Casa", WEEK, HOLIDAY)
    e = Env(hass, freezer, store, HolidayCalendar("IT"), prog.id)

    def handler(name):
        async def _handle(call):
            if name in e.fail:
                raise e.fail[name]
            key = "hvac_mode" if name == "set_hvac_mode" else "temperature"
            if call.data["entity_id"] != ROOM:
                e.other_calls.append((call.data["entity_id"], name))
                return
            e.calls.append((name, call.data[key]))

        return _handle

    for name in ("set_hvac_mode", "set_temperature"):
        hass.services.async_register("climate", name, handler(name))
    e.set_climate()
    yield e
    for manager in e.managers:
        await manager.async_stop()
    await hass.async_block_till_done()


async def test_applies_at_start(env):
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    assert env.calls == HEAT_23
    state = manager.controllers[ROOM].state
    assert state.status == "ok"
    assert state.slot.end == at(26, 12)
    assert state.slot.end.astimezone(UTC) == at(26, 12).astimezone(UTC)
    assert state.next_slot.band.auto is True
    assert state.manual is False
    assert state.holiday is False


async def test_applies_at_boundary(env):
    await env.store.async_assign(ROOM, env.program_id)
    await env.start()
    env.calls.clear()
    await env.go(at(26, 12))
    assert env.calls == [("set_hvac_mode", "off")]
    env.calls.clear()
    await env.go(at(26, 18))
    assert env.calls == [("set_hvac_mode", "heat"), ("set_temperature", 20.0)]


async def test_no_command_at_midnight(env):
    env.freezer.move_to(at(26, 23, 30))
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    assert env.calls == [("set_hvac_mode", "off")]
    assert manager.controllers[ROOM].state.slot.end == at(27, 8)
    env.calls.clear()
    await env.go(at(27, 0))
    await env.go(at(27, 0, 1))
    assert env.calls == []


async def test_split_long_slot_does_not_recommand(env):
    """An always-off program is split every 31 days: no command at the cut."""
    empty = await env.store.async_create_program("Vuoto", ((),) * 7, ())
    await env.store.async_assign(ROOM, empty.id)
    manager = await env.start()
    assert env.calls == [("set_hvac_mode", "off")]
    env.calls.clear()
    first_end = manager.controllers[ROOM].state.slot.end
    await env.go(first_end)
    assert manager.controllers[ROOM].state.slot.end > first_end
    assert env.calls == []


async def test_unassigned_never_commanded(env):
    await env.start()
    await env.go(at(26, 12))
    await env.go(at(26, 18))
    assert env.calls == []


async def test_unassign_stops_commanding(env):
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    env.calls.clear()
    controller = manager.controllers[ROOM]
    await env.store.async_unassign(ROOM)
    await env.hass.async_block_till_done()
    assert ROOM not in manager.controllers
    await env.go(at(26, 12))
    assert env.calls == []
    assert len(env.store._listeners) == 1  # only the manager's


async def test_paused_not_commanded(env):
    await env.store.async_assign(ROOM, env.program_id)
    await env.store.async_set_paused(ROOM, True)
    manager = await env.start()
    assert env.calls == []
    assert manager.controllers[ROOM].state.status == "paused"
    await env.go(at(26, 12))
    await env.go(at(26, 18))
    assert env.calls == []
    assert manager.controllers[ROOM].state.status == "paused"


async def test_assign_and_resume_apply_now(env):
    manager = await env.start()
    await env.store.async_assign(ROOM, env.program_id)
    await env.hass.async_block_till_done()
    assert env.calls == HEAT_23
    assert ROOM in manager.controllers

    await env.store.async_set_paused(ROOM, True)
    await env.hass.async_block_till_done()
    env.calls.clear()
    await env.go(at(26, 12, 30))  # slot changed while paused
    assert env.calls == []
    await env.store.async_set_paused(ROOM, False)
    await env.hass.async_block_till_done()
    assert env.calls == [("set_hvac_mode", "off")]
    # the timer survives the pause: the next boundary still works
    env.calls.clear()
    await env.go(at(26, 18))
    assert env.calls == [("set_hvac_mode", "heat"), ("set_temperature", 20.0)]


async def test_manual_until_end_of_slot(env):
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    controller = manager.controllers[ROOM]
    env.calls.clear()
    await controller.async_set_manual("heat", 24.0)
    await env.hass.async_block_till_done()
    assert env.calls == [("set_hvac_mode", "heat"), ("set_temperature", 24.0)]
    assert controller.state.manual is True
    assert controller.state.override_until == at(26, 12)
    assert env.store.overrides[ROOM].until == at(26, 12).astimezone(UTC)

    env.calls.clear()
    await env.go(at(26, 12))
    assert env.calls == [("set_hvac_mode", "off")]
    assert controller.state.manual is False
    assert controller.state.override_until is None
    assert ROOM not in env.store.overrides


async def test_manual_off_has_no_temperature(env):
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    env.calls.clear()
    await manager.controllers[ROOM].async_set_manual("off", 19.0)
    assert env.calls == [("set_hvac_mode", "off")]
    assert env.store.overrides[ROOM].temperature is None


async def test_manual_validation_and_unassigned(env):
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    controller = manager.controllers[ROOM]
    env.calls.clear()
    with pytest.raises(ProgramError):
        await controller.async_set_manual("heat", None)
    assert env.calls == []
    assert controller.state.manual is False

    await env.store.async_unassign(ROOM)
    with pytest.raises(ProgramError):
        await controller.async_set_manual("heat", 22.0)
    await env.hass.async_block_till_done()
    assert env.calls == []


async def test_manual_race_unassigned_during_save(env):
    """Unassigned while the override is being saved: nothing is commanded."""
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    controller = manager.controllers[ROOM]
    env.calls.clear()
    original = env.store.async_set_override

    async def racing(climate_id, override):
        await env.store.async_unassign(climate_id)
        await original(climate_id, override)  # raises ProgramError

    env.store.async_set_override = racing
    await controller.async_set_manual("heat", 25.0)
    await env.hass.async_block_till_done()
    assert env.calls == []
    assert ROOM not in manager.controllers
    assert ROOM not in env.store.overrides


async def test_resume_auto(env):
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    controller = manager.controllers[ROOM]
    await controller.async_set_manual("heat", 24.0)
    env.calls.clear()
    await controller.async_resume_auto()
    await env.hass.async_block_till_done()
    assert env.calls == HEAT_23
    assert controller.state.manual is False
    assert ROOM not in env.store.overrides


async def test_override_survives_restart(env):
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    await manager.controllers[ROOM].async_set_manual("heat", 24.0)
    await manager.async_stop()
    await env.hass.async_block_till_done()
    env.calls.clear()

    # a brand new store reads the override back from disk
    store2 = CronoStore(env.hass)
    await store2.async_load()
    env.store = store2
    manager2 = await env.start()
    state = manager2.controllers[ROOM].state
    assert env.calls == []  # the thermostat already holds the forced state
    assert state.manual is True
    assert state.override_until == at(26, 12)
    assert state.status == "ok"

    await env.go(at(26, 12))
    assert env.calls == [("set_hvac_mode", "off")]
    assert manager2.controllers[ROOM].state.manual is False


async def test_expired_override_is_dropped_on_restart(env):
    await env.store.async_assign(ROOM, env.program_id)
    await env.store.async_set_override(
        ROOM, Override("heat", 25.0, at(26, 8, 30))
    )
    manager = await env.start()
    assert env.calls == HEAT_23
    assert manager.controllers[ROOM].state.manual is False
    assert ROOM not in env.store.overrides


async def test_override_expiry_compared_in_utc(env):
    """During the repeated hour of the autumn change, instants decide."""
    env.freezer.move_to(datetime(2026, 10, 25, 0, 30, tzinfo=UTC))  # 02:30 CEST
    await env.store.async_assign(ROOM, env.program_id)
    # 01:30 UTC = 02:30 CET (second occurrence) is later than now
    await env.store.async_set_override(
        ROOM, Override("heat", 25.0, datetime(2026, 10, 25, 1, 30, tzinfo=UTC))
    )
    manager = await env.start()
    assert manager.controllers[ROOM].state.manual is True
    assert env.calls == []
    env.freezer.move_to(datetime(2026, 10, 25, 1, 30, tzinfo=UTC))
    async_fire_time_changed(env.hass, datetime(2026, 10, 25, 1, 30, tzinfo=UTC))
    await env.hass.async_block_till_done()
    assert manager.controllers[ROOM].state.manual is False


async def test_unavailable_then_available(env):
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    env.calls.clear()
    env.set_climate("unavailable", modes=())
    await env.hass.async_block_till_done()
    await env.go(at(26, 12))  # boundary while unavailable
    controller = manager.controllers[ROOM]
    assert controller.state.status == "unavailable"
    assert env.calls == []

    env.set_climate("heat")  # back, still showing the old mode
    await env.hass.async_block_till_done()
    assert env.calls == [("set_hvac_mode", "off")]
    assert controller.state.status == "ok"


async def test_unavailable_at_start_then_available(env):
    env.set_climate("unavailable", modes=())
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    assert env.calls == []
    assert manager.controllers[ROOM].state.status == "unavailable"
    env.set_climate("off")
    await env.hass.async_block_till_done()
    assert env.calls == HEAT_23


async def test_other_state_changes_do_not_command(env):
    await env.store.async_assign(ROOM, env.program_id)
    await env.start()
    env.calls.clear()
    env.set_climate("off")
    env.hass.states.async_set(ROOM, "heat", {"hvac_modes": ["heat", "off"], "x": 1})
    await env.hass.async_block_till_done()
    assert env.calls == []


async def test_unsupported_mode(env):
    week = ((Band(480, 720, "cool", 25.0),),) * 7
    cool = await env.store.async_create_program("Fresco", week, ())
    await env.store.async_assign(ROOM, cool.id)
    manager = await env.start()
    assert env.calls == []
    assert manager.controllers[ROOM].state.status == "unsupported_mode"
    await env.go(at(26, 12))  # auto off is supported: recovers
    assert env.calls == [("set_hvac_mode", "off")]
    assert manager.controllers[ROOM].state.status == "ok"


async def test_missing_climate(env):
    env.hass.states.async_remove(ROOM)
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    controller = manager.controllers[ROOM]
    assert controller.state.status == "missing"
    assert env.calls == []
    assert env.store.assignments[ROOM].program_id == env.program_id
    await env.go(at(26, 12))
    assert controller.state.status == "missing"
    assert env.calls == []
    assert env.store.assignments[ROOM].program_id == env.program_id

    env.set_climate("heat")  # reappears
    await env.hass.async_block_till_done()
    assert env.calls == [("set_hvac_mode", "off")]
    assert controller.state.status == "ok"


@pytest.mark.parametrize(
    "error", [ServiceValidationError("no"), HomeAssistantError("boom")]
)
async def test_service_error_sets_error(env, error):
    env.fail["set_temperature"] = error
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()  # must not raise
    controller = manager.controllers[ROOM]
    assert controller.state.status == "error"
    assert env.calls == [("set_hvac_mode", "heat")]

    del env.fail["set_temperature"]
    env.calls.clear()
    await env.go(at(26, 12))  # next boundary retries and recovers
    assert env.calls == [("set_hvac_mode", "off")]
    assert controller.state.status == "ok"


async def test_hvac_mode_error_skips_temperature(env):
    env.fail["set_hvac_mode"] = HomeAssistantError("boom")
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    assert manager.controllers[ROOM].state.status == "error"
    assert env.calls == []


async def test_program_edit_reschedules(env):
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    controller = manager.controllers[ROOM]
    env.calls.clear()

    new_day = (Band(480, 660, "heat", 21.0),)
    await env.store.async_update_program(env.program_id, week=(new_day,) * 7)
    await env.hass.async_block_till_done()
    await controller.async_refresh()
    assert ("set_temperature", 21.0) in env.calls
    assert controller.state.slot.end == at(26, 11)

    env.calls.clear()
    await env.go(at(26, 11))  # the old 12:00 timer is gone, the new one fires
    assert env.calls == [("set_hvac_mode", "off")]


async def test_program_rename_does_not_command(env):
    await env.store.async_assign(ROOM, env.program_id)
    await env.start()
    env.calls.clear()
    await env.store.async_update_program(env.program_id, name="Altro")
    await env.hass.async_block_till_done()
    assert env.calls == []


async def test_other_room_changes_do_not_recommand(env):
    await env.store.async_assign(ROOM, env.program_id)
    await env.start()
    env.calls.clear()
    other = "climate.camera"
    env.hass.states.async_set(other, "off", {"hvac_modes": ["heat", "off"]})
    await env.store.async_assign(other, env.program_id)
    await env.hass.async_block_till_done()
    assert env.calls == []  # the first room is untouched
    assert env.other_calls[0] == (other, "set_hvac_mode")


async def test_holiday_flag_uses_calendar(env):
    env.freezer.move_to(datetime(2026, 11, 1, 10, tzinfo=TZ))  # Sunday, All Saints
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    state = manager.controllers[ROOM].state
    assert state.holiday is True
    assert env.calls == [("set_hvac_mode", "heat"), ("set_temperature", 18.0)]


async def test_stop_removes_listeners_and_timers(env):
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    assert len(env.store._listeners) == 2  # manager + controller
    await manager.async_stop()
    assert env.store._listeners == []
    controller = RoomController(env.hass, env.store, env.calendar, ROOM)
    await controller.async_start()
    assert len(env.store._listeners) == 1
    await controller.async_stop()
    assert env.store._listeners == []
    assert controller._unsub_timer is None
    env.calls.clear()
    await env.go(at(26, 12))
    assert env.calls == []


async def test_updates_are_dispatched(env):
    seen = []
    unsub = async_dispatcher_connect(
        env.hass, SIGNAL_ROOM_UPDATED.format(ROOM), lambda: seen.append(1)
    )
    await env.store.async_assign(ROOM, env.program_id)
    await env.start()
    n = len(seen)
    assert n >= 1
    await env.go(at(26, 12))
    assert len(seen) > n
    unsub()


async def test_override_expiry_applies_current_slot(env):
    """At expiry the current slot is applied even if it equals the override."""
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    await env.store.async_set_override(ROOM, Override("heat", 23.0, at(26, 10)))
    await env.hass.async_block_till_done()
    env.calls.clear()
    await env.go(at(26, 10))
    assert env.calls == HEAT_23
    assert manager.controllers[ROOM].state.manual is False
    assert ROOM not in env.store.overrides
