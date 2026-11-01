"""Tests for the room controller and the manager."""

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.cronotermostato.const import SIGNAL_ROOM_UPDATED
from custom_components.cronotermostato.const import DEFAULT_MAX_TEMP, DEFAULT_MIN_TEMP
from custom_components.cronotermostato.controller import (
    RoomController,
    temperature_limits,
)
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

    def set_climate(self, state="heat", modes=("heat", "off"), **attributes):
        self.hass.states.async_set(
            ROOM, state, {"hvac_modes": list(modes), **attributes}
        )

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
            if name in e.fail and call.data["entity_id"] == ROOM:
                raise e.fail[name]
            key = {
                "set_hvac_mode": "hvac_mode",
                "set_preset_mode": "preset_mode",
                "set_temperature": "temperature",
            }[name]
            if call.data["entity_id"] != ROOM:
                e.other_calls.append((call.data["entity_id"], name))
                return
            e.calls.append((name, call.data[key]))

        return _handle

    for name in ("set_hvac_mode", "set_preset_mode", "set_temperature"):
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


# -- unexpected errors, safe stop, races ---------------------------------


@pytest.mark.parametrize(
    "error", [TimeoutError("slow"), ValueError("bad"), KeyError("x")]
)
async def test_unexpected_error_is_isolated(env, error):
    other = "climate.studio"  # sorted after the failing room
    env.hass.states.async_set(other, "off", {"hvac_modes": ["heat", "off"]})
    env.fail["set_temperature"] = error
    await env.store.async_assign(ROOM, env.program_id)
    await env.store.async_assign(other, env.program_id)
    manager = await env.start()  # must not raise
    assert manager.controllers[ROOM].state.status == "error"
    assert manager.controllers[other].state.status == "ok"
    assert (other, "set_temperature") in env.other_calls

    del env.fail["set_temperature"]
    env.calls.clear()
    await env.go(at(26, 12))  # recovers at the next boundary
    assert manager.controllers[ROOM].state.status == "ok"


async def test_unexpected_error_in_evaluate_is_isolated(env, monkeypatch):
    other = "climate.studio"
    env.hass.states.async_set(other, "off", {"hvac_modes": ["heat", "off"]})
    await env.store.async_assign(ROOM, env.program_id)
    await env.store.async_assign(other, env.program_id)
    original = RoomController._get_timeline

    def broken(self, *, rebuild):
        if self._climate_id == ROOM:
            raise KeyError("boom")
        return original(self, rebuild=rebuild)

    monkeypatch.setattr(RoomController, "_get_timeline", broken)
    manager = await env.start()  # must not raise
    assert manager.controllers[ROOM].state.status == "error"
    assert manager.controllers[other].state.status == "ok"


async def test_sync_isolates_a_room_failing_to_start(env, monkeypatch):
    other = "climate.studio"
    env.hass.states.async_set(other, "off", {"hvac_modes": ["heat", "off"]})
    await env.store.async_assign(ROOM, env.program_id)
    await env.store.async_assign(other, env.program_id)

    async def broken(self):
        raise RuntimeError("boom")

    original = RoomController.async_start

    async def start(self):
        if self._climate_id == ROOM:
            await broken(self)
        await original(self)

    monkeypatch.setattr(RoomController, "async_start", start)
    manager = await env.start()  # must not raise
    assert manager.controllers[other].state.status == "ok"


async def test_stop_during_override_cleanup_does_not_arm_or_command(env):
    await env.store.async_assign(ROOM, env.program_id)
    await env.store.async_set_override(ROOM, Override("heat", 25.0, at(26, 10)))
    env.freezer.move_to(at(26, 11))  # expired by now
    gate, entered = asyncio.Event(), asyncio.Event()
    original = env.store.async_clear_override

    async def slow_clear(cid):
        entered.set()
        await gate.wait()
        await original(cid)

    env.store.async_clear_override = slow_clear
    controller = RoomController(env.hass, env.store, env.calendar, ROOM)
    start = env.hass.async_create_task(controller.async_start())
    await entered.wait()
    await controller.async_stop()
    gate.set()
    await start
    await env.hass.async_block_till_done()
    assert controller._unsub_timer is None
    assert env.calls == []


async def test_stop_between_hvac_mode_and_temperature(env):
    await env.store.async_assign(ROOM, env.program_id)
    gate, entered = asyncio.Event(), asyncio.Event()
    original = env.hass.services._services["climate"]["set_hvac_mode"].job.target

    async def slow(call):
        await original(call)
        entered.set()
        await gate.wait()

    env.hass.services.async_register("climate", "set_hvac_mode", slow)
    controller = RoomController(env.hass, env.store, env.calendar, ROOM)
    start = env.hass.async_create_task(controller.async_start())
    await entered.wait()
    await controller.async_stop()
    gate.set()
    await start
    await env.hass.async_block_till_done()
    assert env.calls == [("set_hvac_mode", "heat")]  # no set_temperature
    assert controller._unsub_timer is None


async def test_pending_listener_task_after_stop_does_not_command(env):
    await env.store.async_assign(ROOM, env.program_id)
    await env.store.async_set_override(ROOM, Override("heat", 25.0, at(26, 9, 30)))
    manager = await env.start()
    controller = manager.controllers[ROOM]
    env.calls.clear()
    env.set_climate("unavailable", modes=())
    await env.hass.async_block_till_done()
    await controller._lock.acquire()  # an evaluation is "in progress"
    env.set_climate("heat")  # the listener task queues behind the lock
    await asyncio.sleep(0)
    await controller.async_stop()
    env.freezer.move_to(at(26, 10))  # the override is now expired
    controller._lock.release()
    await env.hass.async_block_till_done()
    assert env.calls == []
    assert ROOM in env.store.overrides  # a stopped controller touches nothing
    assert controller._unsub_timer is None


async def test_status_not_ok_forgets_what_was_applied(env):
    """A thermostat that was away is re-commanded even on a quiet evaluation."""
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    controller = manager.controllers[ROOM]
    controller._unsub_state()  # evaluations driven by hand
    controller._unsub_state = None
    env.set_climate("unavailable", modes=())
    await controller._async_evaluate(force=False)
    assert controller.state.status == "unavailable"
    env.calls.clear()
    env.set_climate("heat")
    await controller._async_evaluate(force=False)
    assert env.calls == HEAT_23


async def test_no_double_command_when_listener_queues_behind_lock(env):
    """The store listener queued behind a running evaluation, then set_manual."""
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    controller = manager.controllers[ROOM]
    env.calls.clear()
    await controller._lock.acquire()  # e.g. a timer evaluation in progress
    task = env.hass.async_create_task(controller.async_set_manual("heat", 26.0))
    for _ in range(10):
        await asyncio.sleep(0)
    controller._lock.release()
    await task
    await env.hass.async_block_till_done()
    assert env.calls == [("set_hvac_mode", "heat"), ("set_temperature", 26.0)]


# -- temperature limits taken from the climate ---------------------------


def _state(**attributes):
    from homeassistant.core import State

    return State(ROOM, "heat", attributes)


@pytest.mark.parametrize(
    ("state", "expected"),
    [
        (_state(min_temp=15, max_temp=25), (15.0, 25.0)),
        (_state(min_temp=15.5, max_temp=25.5), (15.5, 25.5)),
        (_state(min_temp="16", max_temp="24"), (16.0, 24.0)),
        (_state(), (DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP)),
        (None, (DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP)),
        (_state(min_temp=None, max_temp=None), (DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP)),
        (_state(min_temp="abc", max_temp="xyz"), (DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP)),
        (_state(min_temp=15), (DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP)),
        (_state(max_temp=25), (DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP)),
        (_state(min_temp=25, max_temp=15), (DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP)),
        (_state(min_temp=20, max_temp=20), (DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP)),
        (_state(min_temp=float("nan"), max_temp=25), (DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP)),
        (_state(min_temp=15, max_temp=float("inf")), (DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP)),
        (_state(min_temp=True, max_temp=25), (DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP)),
    ],
)
def test_temperature_limits(state, expected):
    assert temperature_limits(state) == expected


async def test_slot_inside_climate_limits_is_applied(env):
    env.set_climate(min_temp=15, max_temp=25)
    await env.store.async_assign(ROOM, env.program_id)  # 23 degrees
    manager = await env.start()
    assert env.calls == HEAT_23
    assert manager.controllers[ROOM].state.status == "ok"


async def test_slot_at_the_limit_is_applied(env):
    env.set_climate(min_temp=15, max_temp=23)
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    assert env.calls == HEAT_23
    assert manager.controllers[ROOM].state.status == "ok"


async def test_slot_out_of_climate_limits_sends_nothing(env, caplog):
    env.set_climate(min_temp=15, max_temp=22)  # slot is 23
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    assert env.calls == []  # neither mode nor temperature
    assert manager.controllers[ROOM].state.status == "out_of_range"
    assert manager.controllers[ROOM]._last_applied is None
    assert "outside" in caplog.text


async def test_slot_below_climate_minimum(env):
    env.set_climate(min_temp=24, max_temp=30)
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    assert env.calls == []
    assert manager.controllers[ROOM].state.status == "out_of_range"


async def test_defaults_used_when_climate_has_no_limits(env):
    week = ((Band(480, 720, "heat", 36.0),),) * 7
    hot = await env.store.async_create_program("Caldo", week, ())
    await env.store.async_assign(ROOM, hot.id)
    manager = await env.start()
    assert env.calls == []
    assert manager.controllers[ROOM].state.status == "out_of_range"
    week = ((Band(480, 720, "heat", 4.0),),) * 7
    await env.store.async_update_program(hot.id, week=week)
    await env.hass.async_block_till_done()
    assert env.calls == []
    assert manager.controllers[ROOM].state.status == "out_of_range"
    week = ((Band(480, 720, "heat", 35.0),),) * 7
    await env.store.async_update_program(hot.id, week=week)
    await env.hass.async_block_till_done()
    assert env.calls == [("set_hvac_mode", "heat"), ("set_temperature", 35.0)]
    assert manager.controllers[ROOM].state.status == "ok"


@pytest.mark.parametrize(
    "attrs",
    [
        {"min_temp": None, "max_temp": None},
        {"min_temp": "x", "max_temp": "y"},
        {"min_temp": 30, "max_temp": 10},
    ],
)
async def test_malformed_limits_fall_back_to_defaults(env, attrs):
    env.set_climate(**attrs)
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    assert env.calls == HEAT_23
    assert manager.controllers[ROOM].state.status == "ok"


async def test_out_of_range_then_ok_at_next_boundary(env):
    env.set_climate(min_temp=15, max_temp=22)
    await env.store.async_assign(ROOM, env.program_id)  # 23, then off, then 20
    manager = await env.start()
    assert manager.controllers[ROOM].state.status == "out_of_range"
    await env.go(at(26, 12))  # off: no temperature, never out of range
    assert env.calls == [("set_hvac_mode", "off")]
    assert manager.controllers[ROOM].state.status == "ok"
    env.calls.clear()
    await env.go(at(26, 18))  # 20 inside
    assert env.calls == [("set_hvac_mode", "heat"), ("set_temperature", 20.0)]
    assert manager.controllers[ROOM].state.status == "ok"


async def test_out_of_range_retries_at_boundary_with_same_setting(env):
    """After out_of_range the same (mode, temperature) is tried again."""
    week = ((Band(480, 720, "heat", 23.0), Band(1080, 1380, "heat", 23.0)),) * 7
    prog = await env.store.async_create_program("Doppia", week, ())
    env.set_climate(min_temp=15, max_temp=22)
    await env.store.async_assign(ROOM, prog.id)
    manager = await env.start()
    assert manager.controllers[ROOM].state.status == "out_of_range"
    env.set_climate(min_temp=15, max_temp=25)  # the thermostat now allows it
    env.calls.clear()
    await env.go(at(26, 12))  # off slot
    await env.go(at(26, 18))  # 23 again
    assert env.calls == [("set_hvac_mode", "off")] + HEAT_23
    assert manager.controllers[ROOM].state.status == "ok"


async def test_out_of_range_warns_once_per_change(env, caplog):
    env.set_climate(min_temp=15, max_temp=22)
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    await manager.controllers[ROOM].async_refresh()
    await manager.controllers[ROOM].async_refresh()
    assert caplog.text.count("outside") == 1


async def test_override_out_of_range_sends_nothing(env):
    """A stored override (e.g. restored) outside the limits is not sent."""
    env.set_climate(min_temp=15, max_temp=22)
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    env.calls.clear()
    await env.store.async_set_override(
        ROOM, Override("heat", 30.0, at(26, 12).astimezone(UTC))
    )
    await env.hass.async_block_till_done()
    assert env.calls == []
    assert manager.controllers[ROOM].state.status == "out_of_range"


async def test_set_manual_out_of_range_raises_and_stores_nothing(env):
    env.set_climate(min_temp=15, max_temp=25)
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    env.calls.clear()
    with pytest.raises(ServiceValidationError) as err:
        await manager.controllers[ROOM].async_set_manual("heat", 30.0)
    assert err.value.translation_key == "temperature_out_of_range"
    assert err.value.translation_placeholders == {
        "min": "15.0",
        "max": "25.0",
        "temperature": "30.0",
        "entity_id": ROOM,
    }
    assert env.store.overrides == {}
    assert env.calls == []


async def test_set_manual_uses_defaults_when_climate_missing(env):
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    env.hass.states.async_remove(ROOM)
    await env.hass.async_block_till_done()
    controller = manager.controllers[ROOM]
    with pytest.raises(ServiceValidationError):
        await controller.async_set_manual("heat", 36.0)
    await controller.async_set_manual("heat", 30.0)  # inside 5-35
    assert env.store.overrides[ROOM].temperature == 30.0


# -- preset -----------------------------------------------------------------

PRESETS = ["none", "away", "comfort", "eco", "home", "sleep", "activity"]


async def _assign_week(env, band, name="Preset"):
    prog = await env.store.async_create_program(name, ((band,),) * 7, ())
    await env.store.async_assign(ROOM, prog.id)
    return prog


async def test_preset_and_temperature_order(env):
    """mode, then preset, then temperature."""
    env.set_climate(preset_modes=PRESETS)
    await _assign_week(env, Band(480, 720, "heat", 21.0, preset="comfort"))
    await env.start()
    assert env.calls == [
        ("set_hvac_mode", "heat"),
        ("set_preset_mode", "comfort"),
        ("set_temperature", 21.0),
    ]


async def test_preset_only_sends_no_temperature(env):
    env.set_climate(preset_modes=PRESETS)
    await _assign_week(env, Band(480, 720, "heat", None, preset="home"))
    manager = await env.start()
    assert env.calls == [("set_hvac_mode", "heat"), ("set_preset_mode", "home")]
    assert manager.controllers[ROOM].state.status == "ok"


async def test_preset_none_is_valid_when_listed(env):
    env.set_climate(preset_modes=PRESETS)
    await _assign_week(env, Band(480, 720, "heat", None, preset="none"))
    manager = await env.start()
    assert env.calls == [("set_hvac_mode", "heat"), ("set_preset_mode", "none")]
    assert manager.controllers[ROOM].state.status == "ok"


async def test_unsupported_preset_sends_nothing_not_even_mode(env, caplog):
    env.set_climate(preset_modes=PRESETS)
    await _assign_week(env, Band(480, 720, "heat", 21.0, preset="boost"))
    manager = await env.start()
    assert env.calls == []
    state = manager.controllers[ROOM].state
    assert state.status == "unsupported_preset"
    assert manager.controllers[ROOM]._last_applied is None
    assert "boost" in caplog.text
    await env.go(at(26, 12))  # automatic off slot recovers
    assert env.calls == [("set_hvac_mode", "off")]
    assert manager.controllers[ROOM].state.status == "ok"


async def test_unsupported_preset_when_climate_has_no_presets(env):
    await _assign_week(env, Band(480, 720, "heat", None, preset="home"))
    manager = await env.start()  # no preset_modes attribute at all
    assert env.calls == []
    assert manager.controllers[ROOM].state.status == "unsupported_preset"


async def test_unsupported_preset_warns_once_per_change(env, caplog):
    env.set_climate(preset_modes=PRESETS)
    await _assign_week(env, Band(480, 720, "heat", 21.0, preset="boost"))
    manager = await env.start()
    await manager.controllers[ROOM].async_refresh()
    await manager.controllers[ROOM].async_refresh()
    assert caplog.text.count("does not support preset") == 1


async def test_unsupported_mode_wins_over_preset_check(env):
    env.set_climate(preset_modes=PRESETS)
    await _assign_week(env, Band(480, 720, "cool", None, preset="home"))
    manager = await env.start()
    assert env.calls == []
    assert manager.controllers[ROOM].state.status == "unsupported_mode"


async def test_range_check_skipped_without_temperature(env):
    """A preset-only band is fine even if the climate limits are odd."""
    env.set_climate(preset_modes=PRESETS, min_temp=15, max_temp=22)
    await _assign_week(env, Band(480, 720, "heat", None, preset="home"))
    manager = await env.start()
    assert manager.controllers[ROOM].state.status == "ok"
    assert env.calls == [("set_hvac_mode", "heat"), ("set_preset_mode", "home")]


async def test_range_check_still_applies_with_preset_and_temperature(env):
    env.set_climate(preset_modes=PRESETS, min_temp=15, max_temp=22)
    await _assign_week(env, Band(480, 720, "heat", 30.0, preset="home"))
    manager = await env.start()
    assert env.calls == []
    assert manager.controllers[ROOM].state.status == "out_of_range"


async def test_preset_failure_stops_following_commands(env):
    env.set_climate(preset_modes=PRESETS)
    env.fail["set_preset_mode"] = HomeAssistantError("boom")
    await _assign_week(env, Band(480, 720, "heat", 21.0, preset="home"))
    manager = await env.start()
    assert env.calls == [("set_hvac_mode", "heat")]  # no set_temperature
    assert manager.controllers[ROOM].state.status == "error"


async def test_same_command_key_includes_preset(env):
    """Adjacent bands that differ only by preset are two slots: command sent."""
    env.set_climate(preset_modes=PRESETS)
    day = (
        Band(480, 720, "heat", None, preset="home"),
        Band(720, 900, "heat", None, preset="eco"),
    )
    prog = await env.store.async_create_program("Due", (day,) * 7, ())
    await env.store.async_assign(ROOM, prog.id)
    await env.start()
    env.calls.clear()
    await env.go(at(26, 12))
    assert env.calls == [("set_hvac_mode", "heat"), ("set_preset_mode", "eco")]


async def test_manual_with_preset(env):
    env.set_climate(preset_modes=PRESETS)
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    controller = manager.controllers[ROOM]
    env.calls.clear()
    await controller.async_set_manual("heat", None, "eco")
    assert env.calls == [("set_hvac_mode", "heat"), ("set_preset_mode", "eco")]
    assert env.store.overrides[ROOM].preset == "eco"
    assert env.store.overrides[ROOM].temperature is None
    assert controller.state.manual is True


async def test_manual_with_preset_and_temperature_order(env):
    env.set_climate(preset_modes=PRESETS)
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    env.calls.clear()
    await manager.controllers[ROOM].async_set_manual("heat", 22.0, "home")
    assert env.calls == [
        ("set_hvac_mode", "heat"),
        ("set_preset_mode", "home"),
        ("set_temperature", 22.0),
    ]


async def test_manual_needs_preset_or_temperature(env):
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    env.calls.clear()
    with pytest.raises(ProgramError):
        await manager.controllers[ROOM].async_set_manual("heat", None, None)
    assert env.calls == []


async def test_manual_off_ignores_preset(env):
    """Like the temperature, a preset given with ``off`` is dropped."""
    env.set_climate(preset_modes=PRESETS)
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    env.calls.clear()
    await manager.controllers[ROOM].async_set_manual("off", 19.0, "home")
    assert env.calls == [("set_hvac_mode", "off")]
    assert env.store.overrides[ROOM].preset is None


async def test_manual_unsupported_preset_stores_but_sends_nothing(env):
    env.set_climate(preset_modes=PRESETS)
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    env.calls.clear()
    await manager.controllers[ROOM].async_set_manual("heat", None, "boost")
    assert env.calls == []
    assert manager.controllers[ROOM].state.status == "unsupported_preset"


async def test_manual_range_not_checked_without_temperature(env):
    env.set_climate(preset_modes=PRESETS, min_temp=15, max_temp=22)
    await env.store.async_assign(ROOM, env.program_id)
    manager = await env.start()
    await manager.controllers[ROOM].async_set_manual("heat", None, "home")
    assert manager.controllers[ROOM].state.manual is True


async def test_restart_keeps_override_with_preset_without_resending(env):
    env.set_climate(preset_modes=PRESETS)
    await env.store.async_assign(ROOM, env.program_id)
    until = at(26, 12).astimezone(UTC)
    await env.store.async_set_override(ROOM, Override("heat", None, until, "eco"))
    manager = await env.start()
    assert env.calls == []
    assert manager.controllers[ROOM].state.manual is True
