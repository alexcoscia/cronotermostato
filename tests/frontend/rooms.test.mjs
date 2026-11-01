import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { makeHass, flush } from "./fake-hass.mjs";
import { createT } from "../../custom_components/cronotermostato/frontend/lib/i18n.js";
import { EditorError } from "../../custom_components/cronotermostato/frontend/lib/api.js";
import { climateRooms } from "../../custom_components/cronotermostato/frontend/lib/climate.js";
import {
  KNOWN_STATUSES,
  statusInfo,
  statusText,
  untilInfo,
  untilText,
  manualText,
  nextText,
  settingText,
  roomRows,
  parseTemperature,
  manualModes,
  manualDefaults,
  validateManual,
  assignPlan,
  assignRoom,
  unassignRoom,
  forceRoom,
  createGuard,
  runAction,
  actionErrorMessage,
  issueGroups,
  toggleAction,
  availableActions,
  toggleRoom,
  reconcileManual,
  stepNotice,
  issueParams,
} from "../../custom_components/cronotermostato/frontend/lib/rooms.js";
import it from "../../custom_components/cronotermostato/frontend/i18n/it.js";
import en from "../../custom_components/cronotermostato/frontend/i18n/en.js";

const FE = "../../custom_components/cronotermostato/frontend";
const tIt = createT({ language: "it" });
const tEn = createT({ language: "en" });

const STATES = {
  "climate.soggiorno": { state: "heat", attributes: { friendly_name: "Soggiorno", hvac_modes: ["heat", "off"], preset_modes: ["eco", "home"], min_temp: 15, max_temp: 25, target_temp_step: 0.5 } },
  "climate.camera": { state: "off", attributes: { friendly_name: "Camera", hvac_modes: ["heat", "cool", "off"], preset_modes: [], min_temp: 10, max_temp: 30 } },
  "climate.bagno": { state: "unavailable", attributes: { friendly_name: "Bagno" } },
  "sensor.x": { state: "1", attributes: {} },
};
const band = (start, end, mode = "heat", temperature = 21, preset = null) => ({ start, end, mode, temperature, preset, auto: false });
const PROGRAMS = [
  { program_id: "p1", name: "Casa", revision: "1", week: [[band("06:00", "08:00")], [], [], [], [], [], []], holiday: [] },
  { program_id: "p2", name: "Estate <b>x</b>", revision: "1", week: [[band("06:00", "08:00", "cool", 40, "turbo")], [], [], [], [], [], []], holiday: [] },
];

// ---- 1. status: text and severity for every status, also an unknown one ----------------------------

test("every known status has a clear text in both languages, a severity and an icon", () => {
  assert.deepEqual([...KNOWN_STATUSES].sort(), ["error", "missing", "not_running", "ok", "out_of_range", "paused", "unassigned", "unavailable", "unsupported_mode", "unsupported_preset"]);
  const severity = { ok: "ok", paused: "info", unassigned: "info", not_running: "info", unavailable: "warn", unsupported_mode: "warn", unsupported_preset: "warn", out_of_range: "warn", missing: "error", error: "error" };
  for (const status of KNOWN_STATUSES) {
    const info = statusInfo(status);
    assert.equal(info.known, true, status);
    assert.equal(info.severity, severity[status], status);
    assert.ok(["check", "pause", "info", "warn", "x"].includes(info.icon), status);
    assert.equal(statusText(tIt, status), it[`status.${status}`]);
    assert.equal(statusText(tEn, status), en[`status.${status}`]);
    assert.notEqual(statusText(tIt, status), `status.${status}`);
  }
});

test("an unknown status is shown as it is with a neutral icon; markup stays text", () => {
  const info = statusInfo("heating_up");
  assert.deepEqual({ known: info.known, severity: info.severity, icon: info.icon }, { known: false, severity: "neutral", icon: "info" });
  assert.equal(statusText(tIt, "heating_up"), "Stato: heating_up");
  assert.equal(statusText(tEn, "heating_up"), "Status: heating_up");
  assert.equal(statusText(tEn, "<img src=x onerror=alert(1)>"), "Status: <img src=x onerror=alert(1)>");
  for (const odd of ["constructor", "__proto__", "toString", "", null, undefined, 5, {}]) {
    assert.equal(statusInfo(odd).known, false, String(odd));
    assert.equal(typeof statusText(tEn, odd), "string");
  }
});

// ---- 2. "until HH:MM", also when it is tomorrow ------------------------------------------------------

const NOW = new Date("2026-11-01T10:00:00Z"); // 11:00 in Rome

test("until: the wall clock of the server string, with 'tomorrow' when the end is on the next day", () => {
  const zone = { now: NOW, timeZone: "Europe/Rome" };
  assert.deepEqual(untilInfo("2026-11-01T17:30:00+01:00", zone), { time: "17:30", nextDay: false });
  assert.deepEqual(untilInfo("2026-11-02T00:00:00+01:00", zone), { time: "00:00", nextDay: true });
  assert.deepEqual(untilInfo("2026-11-02T06:30:00+01:00", zone), { time: "06:30", nextDay: true });
  assert.equal(untilText(tIt, "2026-11-01T17:30:00+01:00", zone), "fino alle 17:30");
  assert.equal(untilText(tIt, "2026-11-02T06:30:00+01:00", zone), "fino alle 06:30 di domani");
  assert.equal(untilText(tEn, "2026-11-02T06:30:00+01:00", zone), "until 06:30 tomorrow");
  assert.equal(untilText(tEn, "2026-11-01T17:30:00+01:00", zone), "until 17:30");
});

test("until: a day that ended up past midnight in another zone is judged in the zone of HA", () => {
  // 23:30 UTC on Nov 1 is already Nov 2 in Rome: "today" in Rome is Nov 2.
  const now = new Date("2026-11-01T23:30:00Z");
  assert.equal(untilInfo("2026-11-02T08:00:00+01:00", { now, timeZone: "Europe/Rome" }).nextDay, false);
  assert.equal(untilInfo("2026-11-02T08:00:00+01:00", { now, timeZone: "UTC" }).nextDay, true);
});

test("until: garbage gives null, an invalid zone is ignored", () => {
  for (const bad of [null, undefined, "", "tomorrow", 12, "2026-11-01", "2026-11-01T25:00", {}]) assert.equal(untilInfo(bad, { now: NOW }), null, String(bad));
  assert.equal(untilText(tIt, "nope", { now: NOW }), null);
  assert.equal(untilInfo("2026-11-01T17:30:00+01:00", { now: NOW, timeZone: "Not/AZone" }).time, "17:30");
});

test("manual badge says until when, or 'until the end of the band' when the time is unknown", () => {
  const zone = { now: NOW, timeZone: "Europe/Rome" };
  assert.equal(manualText(tIt, "2026-11-01T12:00:00+01:00", zone), "Manuale fino alle 12:00");
  assert.equal(manualText(tEn, "2026-11-02T01:00:00+01:00", zone), "Manual until 01:00 tomorrow");
  assert.equal(manualText(tIt, null, zone), it["room.manual_until"]);
  assert.equal(manualText(tEn, "garbage", zone), en["room.manual_until"]);
});

test("current and next band lines", () => {
  const slot = { start: "2026-11-01T06:00:00+01:00", end: "2026-11-01T17:00:00+01:00", mode: "heat", temperature: 21, preset: "eco", auto: false };
  const opts = { hass: { language: "it" } };
  assert.equal(settingText(tIt, slot, opts), "Riscaldamento 21 °C, eco");
  assert.equal(settingText(tIt, { ...slot, mode: "off", temperature: null, preset: null }, opts), "Spento");
  assert.equal(settingText(tIt, { ...slot, mode: "off", temperature: 5, preset: "x" }, opts), "Spento", "off never shows temperature or preset");
  assert.equal(settingText(tEn, { ...slot, temperature: 20.5, preset: null }, { hass: { language: "en" } }), "Heating 20.5 °C");
  assert.equal(settingText(tEn, { ...slot, temperature: 70, preset: null }, { hass: { language: "en", config: { unit_system: { temperature: "°F" } } } }), "Heating 70 °F");
  assert.equal(nextText(tIt, { ...slot, start: "2026-11-01T17:00:00+01:00", mode: "off", temperature: null, preset: null }, { ...opts, now: NOW, timeZone: "Europe/Rome" }), "poi: 17:00, Spento");
  assert.equal(nextText(tIt, null, opts), null);
  assert.equal(nextText(tIt, { mode: "heat" }, opts), null);
  // markup in a preset stays a string
  assert.ok(settingText(tIt, { ...slot, preset: "<i>x</i>" }, opts).includes("<i>x</i>"));
});

// ---- 3. rows: every climate of HA, with area, and where it is assigned --------------------------------

test("rows: all the climate rooms of HA, with area (entity first, then device), sorted by area then name", () => {
  const hass = {
    states: STATES,
    entities: { "climate.soggiorno": { area_id: "living" }, "climate.camera": { device_id: "dev1", area_id: null } },
    devices: { dev1: { area_id: "notte" } },
    areas: { living: { name: "Zona giorno" }, notte: { name: "Zona notte <b>" } },
  };
  const rooms = [{ climate_entity_id: "climate.soggiorno", program_id: "p1", program_name: "Casa", status: "ok", paused: false }];
  const rows = roomRows({ hass, rooms, programs: PROGRAMS, programId: "p1" });
  assert.deepEqual(rows.map((r) => r.id), ["climate.soggiorno", "climate.camera", "climate.bagno"]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId["climate.soggiorno"].area, "Zona giorno");
  assert.equal(byId["climate.camera"].area, "Zona notte <b>");
  assert.equal(byId["climate.bagno"].area, null);
  assert.equal(byId["climate.soggiorno"].assignedHere, true);
  assert.equal(byId["climate.camera"].assignedHere, false);
  assert.equal(byId["climate.camera"].server, null);
  assert.equal(byId["climate.camera"].status, "unassigned");
  assert.equal(byId["climate.soggiorno"].status, "ok");
  // sorted by area name, rooms without area last
  assert.deepEqual(rows.map((r) => r.area), ["Zona giorno", "Zona notte <b>", null]);
});

test("rows: a room assigned to another program says which; an assigned room that HA no longer has is listed as missing", () => {
  const hass = { states: STATES };
  const rooms = [
    { climate_entity_id: "climate.camera", program_id: "p2", program_name: "Estate <b>x</b>", status: "ok" },
    { climate_entity_id: "climate.sparita", name: "Sparita", program_id: "p1", program_name: "Casa", status: "missing" },
  ];
  const rows = roomRows({ hass, rooms, programs: PROGRAMS, programId: "p1" });
  const camera = rows.find((r) => r.id === "climate.camera");
  assert.equal(camera.assignedHere, false);
  assert.equal(camera.otherProgramId, "p2");
  assert.equal(camera.otherProgramName, "Estate <b>x</b>");
  const gone = rows.find((r) => r.id === "climate.sparita");
  assert.equal(gone.climate, null);
  assert.equal(gone.name, "Sparita");
  assert.equal(gone.assignedHere, true);
  assert.equal(gone.status, "missing");
  assert.equal(rows.find((r) => r.id === "climate.soggiorno").otherProgramId, null);
});

test("rows: no states, no registry, nothing assigned", () => {
  assert.deepEqual(roomRows({ hass: undefined, rooms: [], programs: [], programId: "p1" }), []);
  assert.deepEqual(roomRows({ hass: { states: {} }, rooms: undefined, programs: undefined, programId: null }), []);
});

// ---- 4. assigning: confirmation when moving, warnings before ------------------------------------------

function rowsFor(rooms, programId = "p1") {
  const hass = { states: STATES };
  return roomRows({ hass, rooms, programs: PROGRAMS, programId });
}
const rowOf = (rows, id) => rows.find((r) => r.id === id);

test("assignPlan: moving from another program needs confirmation and names the program", () => {
  const rows = rowsFor([{ climate_entity_id: "climate.camera", program_id: "p2", program_name: "Estate <b>x</b>", status: "ok" }]);
  const plan = assignPlan(rowOf(rows, "climate.camera"), PROGRAMS[0]);
  assert.equal(plan.moves, true);
  assert.equal(plan.fromName, "Estate <b>x</b>");
  assert.equal(plan.needsConfirm, true);
});

test("assignPlan: compatibility warnings come before assigning and do not block", () => {
  const rows = rowsFor([]);
  const plan = assignPlan(rowOf(rows, "climate.soggiorno"), PROGRAMS[1]); // cool is not supported, 40 is out of range, turbo is missing
  assert.equal(plan.moves, false);
  assert.equal(plan.needsConfirm, true, "warnings are shown before assigning");
  assert.deepEqual(plan.issues.map((g) => g.code), ["unsupported_mode"], "the controller stops at the first problem of a band: mode");
  const plain = assignPlan(rowOf(rows, "climate.soggiorno"), PROGRAMS[0]);
  assert.equal(plain.needsConfirm, false);
  assert.deepEqual(plain.issues, []);
});

test("assignRoom: a room used elsewhere asks first; 'no' sends nothing", async () => {
  const hass = makeHass({ ws: { "cronotermostato/assign": {} } });
  const rows = rowsFor([{ climate_entity_id: "climate.camera", program_id: "p2", program_name: "Estate", status: "ok" }]);
  const asked = [];
  const result = await assignRoom(hass, { row: rowOf(rows, "climate.camera"), program: PROGRAMS[0], confirm: async (plan) => (asked.push(plan), false) });
  assert.equal(result.cancelled, true);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].fromName, "Estate");
  assert.equal(hass.wsCalls.length, 0, "no command if the user cancels");
  assert.equal(hass.serviceCalls.length, 0);
});

test("assignRoom: after 'yes' the room is assigned with the right ids; a free room without warnings needs no question", async () => {
  const hass = makeHass({ ws: { "cronotermostato/assign": {} } });
  const rows = rowsFor([{ climate_entity_id: "climate.camera", program_id: "p2", program_name: "Estate", status: "ok" }]);
  await assignRoom(hass, { row: rowOf(rows, "climate.camera"), program: PROGRAMS[0], confirm: async () => true });
  assert.deepEqual(hass.wsCalls, [{ type: "cronotermostato/assign", program_id: "p1", climate_entity_id: "climate.camera" }]);
  let asked = 0;
  const free = rowsFor([]);
  const done = await assignRoom(hass, { row: rowOf(free, "climate.soggiorno"), program: PROGRAMS[0], confirm: async () => (asked++, true) });
  assert.equal(asked, 0);
  assert.equal(done.cancelled, false);
  assert.equal(hass.wsCalls.length, 2);
});

test("assignRoom: with warnings it asks, and goes on after 'yes' (not blocking)", async () => {
  const hass = makeHass({ ws: { "cronotermostato/assign": {} } });
  const free = rowsFor([]);
  let plan = null;
  await assignRoom(hass, { row: rowOf(free, "climate.soggiorno"), program: PROGRAMS[1], confirm: async (p) => ((plan = p), true) });
  assert.ok(plan.issues.length > 0);
  assert.equal(hass.wsCalls.length, 1);
});

test("assignRoom: a server refusal reaches the caller as an EditorError", async () => {
  const hass = makeHass({ ws: { "cronotermostato/assign": () => { throw { code: "not_found", message: "Unknown program" }; } } });
  const free = rowsFor([]);
  await assert.rejects(assignRoom(hass, { row: rowOf(free, "climate.soggiorno"), program: PROGRAMS[0], confirm: async () => true }), (e) => e instanceof EditorError && e.code === "not_found");
});

// ---- 5. removing a room: always asks ------------------------------------------------------------------

test("unassignRoom asks first and sends nothing on 'no'", async () => {
  const hass = makeHass({ ws: { "cronotermostato/unassign": {} } });
  const rows = rowsFor([{ climate_entity_id: "climate.soggiorno", program_id: "p1", program_name: "Casa", status: "ok" }]);
  let seen = null;
  const no = await unassignRoom(hass, { row: rowOf(rows, "climate.soggiorno"), confirm: async (row) => ((seen = row.name), false) });
  assert.equal(seen, "Soggiorno");
  assert.equal(no.cancelled, true);
  assert.equal(hass.wsCalls.length, 0);
  const yes = await unassignRoom(hass, { row: rowOf(rows, "climate.soggiorno"), confirm: async () => true });
  assert.equal(yes.cancelled, false);
  assert.deepEqual(hass.wsCalls, [{ type: "cronotermostato/unassign", climate_entity_id: "climate.soggiorno" }]);
});

test("the removal text says that the room will no longer be controlled", () => {
  assert.equal(tIt("room.unassign_confirm", { name: "Soggiorno" }), "Soggiorno non sarà più comandata. Un'eventuale forzatura in corso decade.");
  assert.equal(tEn("room.unassign_confirm", { name: "Soggiorno" }), "Soggiorno will no longer be controlled. Any manual setting in progress ends.");
});

// ---- 6. forcing a setting ---------------------------------------------------------------------------

const soggiorno = () => rowOf(rowsFor([{ climate_entity_id: "climate.soggiorno", program_id: "p1", program_name: "Casa", status: "ok" }]), "climate.soggiorno");

test("temperature text: comma or point, nothing else", () => {
  assert.equal(parseTemperature("21,5"), 21.5);
  assert.equal(parseTemperature(" 21.5 "), 21.5);
  assert.equal(parseTemperature(22), 22);
  assert.equal(parseTemperature("-3"), -3);
  for (const bad of ["", "  ", "abc", "21,5,1", "1e3", "Infinity", "NaN", null, undefined, true, "0x10", "21 °C"]) assert.equal(parseTemperature(bad), null, String(bad));
});

test("modes offered: the ones of the program that the room supports", () => {
  assert.deepEqual(manualModes(soggiorno().climate), ["heat", "off"]);
  assert.deepEqual(manualModes(rowOf(rowsFor([]), "climate.camera").climate), ["heat", "cool", "off"]);
  assert.deepEqual(manualModes(rowOf(rowsFor([]), "climate.bagno").climate), ["heat", "cool", "off"], "unknown capabilities: all three, the server decides");
  assert.deepEqual(manualModes(null), ["heat", "cool", "off"]);
});

test("defaults: the current band when it is heat or cool, with a preset the room has", () => {
  const row = soggiorno();
  row.server = { ...row.server, slot: { mode: "heat", temperature: 19, preset: "eco" } };
  assert.deepEqual(manualDefaults(row), { mode: "heat", temperature: "19", preset: "eco" });
  row.server = { ...row.server, slot: { mode: "off", temperature: null, preset: null } };
  assert.deepEqual(manualDefaults(row), { mode: "heat", temperature: "", preset: "" });
  row.server = { ...row.server, slot: { mode: "heat", temperature: 19, preset: "unknown" } };
  assert.equal(manualDefaults(row).preset, "");
  row.server = { ...row.server, slot: { mode: "cool", temperature: 19, preset: null } };
  assert.equal(manualDefaults(row).mode, "heat", "the room does not cool");
});

test("validate: a temperature outside the limits of the room blocks, with the message and the limits", () => {
  const room = soggiorno().climate;
  const bad = validateManual({ mode: "heat", temperature: "30", preset: "" }, room);
  assert.equal(bad.ok, false);
  assert.equal(bad.request, null);
  assert.deepEqual(bad.errors.temperature, { code: "out_of_range", params: { temperature: "30", min: "15", max: "25" } });
  assert.equal(validateManual({ mode: "heat", temperature: "14,5", preset: "" }, room).ok, false);
  assert.equal(validateManual({ mode: "heat", temperature: "15", preset: "" }, room).ok, true, "the limits are inclusive");
  assert.equal(validateManual({ mode: "heat", temperature: "25", preset: "" }, room).ok, true);
  assert.equal(validateManual({ mode: "heat", temperature: "25.1", preset: "" }, room).ok, false);
});

test("validate: heat and cool need a temperature or a preset; a preset the room lacks is refused", () => {
  const room = soggiorno().climate;
  assert.equal(validateManual({ mode: "heat", temperature: "", preset: "" }, room).errors.temperature.code, "missing_setting");
  assert.equal(validateManual({ mode: "heat", temperature: "abc", preset: "" }, room).errors.temperature.code, "bad_temperature");
  assert.equal(validateManual({ mode: "heat", temperature: "", preset: "eco" }, room).ok, true);
  assert.equal(validateManual({ mode: "heat", temperature: "", preset: "nope" }, room).errors.preset.code, "unsupported_preset");
  assert.equal(validateManual({ mode: "cool", temperature: "20", preset: "" }, room).errors.mode.code, "unsupported_mode");
  assert.equal(validateManual({ mode: "auto", temperature: "20", preset: "" }, room).errors.mode.code, "bad_mode");
});

test("validate: off needs nothing and carries neither temperature nor preset", () => {
  const room = soggiorno().climate;
  const ok = validateManual({ mode: "off", temperature: "99", preset: "eco" }, room);
  assert.equal(ok.ok, true, "a leftover temperature does not block off");
  assert.deepEqual(ok.request, { mode: "off" });
  assert.deepEqual(validateManual({ mode: "heat", temperature: "21,5", preset: "eco" }, room).request, { mode: "heat", temperature: 21.5, preset: "eco" });
  assert.deepEqual(validateManual({ mode: "heat", temperature: "21", preset: "" }, room).request, { mode: "heat", temperature: 21 });
  assert.deepEqual(validateManual({ mode: "heat", temperature: "", preset: "home" }, room).request, { mode: "heat", preset: "home" });
});

test("forceRoom with off sends no temperature and no preset, even if given", async () => {
  const hass = makeHass();
  await forceRoom(hass, soggiorno(), { mode: "off", temperature: "99", preset: "eco" });
  assert.deepEqual(hass.serviceCalls, [{ domain: "cronotermostato", service: "set_manual", data: { climate_entity_id: "climate.soggiorno", mode: "off" } }]);
});

test("forceRoom does not call the service when the form is invalid; it never touches climate.*", async () => {
  const hass = makeHass();
  const result = await forceRoom(hass, soggiorno(), { mode: "heat", temperature: "40", preset: "" });
  assert.equal(result.invalid, true);
  assert.equal(hass.serviceCalls.length, 0);
  await forceRoom(hass, soggiorno(), { mode: "heat", temperature: "21", preset: "eco" });
  assert.deepEqual(hass.serviceCalls.map((c) => `${c.domain}.${c.service}`), ["cronotermostato.set_manual"]);
  assert.deepEqual(hass.serviceCalls[0].data, { climate_entity_id: "climate.soggiorno", mode: "heat", temperature: 21, preset: "eco" });
  assert.equal(hass.wsCalls.length, 0);
});

// ---- 7. no double sending; stale state; errors ---------------------------------------------------------

test("two quick clicks send one command", async () => {
  const hass = makeHass({ ws: { "cronotermostato/unassign": async () => (await flush(), await flush(), {}) } });
  const guard = createGuard();
  const refreshes = [];
  const refresh = async () => void refreshes.push(1);
  const row = soggiorno();
  const act = () => runAction(guard, row.id, () => unassignRoom(hass, { row, confirm: async () => true }), { refresh });
  const [a, b] = await Promise.all([act(), act()]);
  assert.deepEqual([a.status, b.status].sort(), ["busy", "done"]);
  assert.equal(hass.wsCount("cronotermostato/unassign"), 1);
  assert.equal(refreshes.length, 1);
  assert.equal(guard.has(row.id), false, "free again afterwards");
  await act();
  assert.equal(hass.wsCount("cronotermostato/unassign"), 2);
});

test("different rooms do not block each other", async () => {
  const hass = makeHass({ ws: { "cronotermostato/unassign": async () => (await flush(), {}) } });
  const guard = createGuard();
  const refresh = async () => {};
  const one = (id) => runAction(guard, id, () => unassignRoom(hass, { row: { id, name: id }, confirm: async () => true }), { refresh });
  const results = await Promise.all([one("climate.a"), one("climate.b")]);
  assert.deepEqual(results.map((r) => r.status), ["done", "done"]);
  assert.equal(hass.wsCount("cronotermostato/unassign"), 2);
});

test("after an action the state is read again, also when the action failed (it may be stale)", async () => {
  const guard = createGuard();
  let refreshed = 0;
  const refresh = async () => void refreshed++;
  const ok = await runAction(guard, "r", async () => ({ cancelled: false }), { refresh });
  assert.equal(ok.status, "done");
  assert.equal(refreshed, 1);
  const err = await runAction(guard, "r", async () => { throw { code: "not_found", message: "gone" }; }, { refresh });
  assert.equal(err.status, "error");
  assert.ok(err.error instanceof EditorError);
  assert.equal(err.error.code, "not_found");
  assert.equal(refreshed, 2);
  const cancelled = await runAction(guard, "r", async () => ({ cancelled: true }), { refresh });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(refreshed, 2, "nothing happened: no reread");
});

test("a failing reread does not hide the result or leave the room locked", async () => {
  const guard = createGuard();
  const result = await runAction(guard, "r", async () => ({ cancelled: false }), { refresh: async () => { throw new Error("offline"); } });
  assert.equal(result.status, "done");
  assert.equal(guard.has("r"), false);
});

test("the pause and resume services and the return to automatic go through the existing calls", async () => {
  const hass = makeHass();
  const guard = createGuard();
  const refresh = async () => {};
  const { pauseRoom, resumeRoom, resumeAuto } = await import(`${FE}/lib/api.js`);
  await runAction(guard, "x", () => pauseRoom(hass, "climate.soggiorno"), { refresh });
  await runAction(guard, "x", () => resumeRoom(hass, "climate.soggiorno"), { refresh });
  await runAction(guard, "x", () => resumeAuto(hass, "climate.soggiorno"), { refresh });
  assert.deepEqual(hass.serviceCalls.map((c) => c.service), ["pause", "resume", "resume_auto"]);
});

test("error messages: the generic text plus what the server said for a refused value", () => {
  const out = new EditorError("invalid_format", "Temperature 40 is outside 15-25 for climate.soggiorno");
  assert.equal(actionErrorMessage(tEn, out), `${en["error.invalid_format"]} Temperature 40 is outside 15-25 for climate.soggiorno`);
  const known = new EditorError("invalid_format", "Room not assigned", "not_assigned");
  assert.equal(actionErrorMessage(tIt, known), `${it["error.invalid_format"]} ${it["validation.not_assigned"]}`);
  assert.equal(actionErrorMessage(tIt, new EditorError("network", "boom")), it["error.network"]);
  assert.equal(actionErrorMessage(tEn, new EditorError("unauthorized", "x")), en["error.unauthorized"]);
  assert.equal(actionErrorMessage(tEn, new Error("plain")), "plain");
  assert.equal(actionErrorMessage(tEn, undefined), "");
});

// ---- 8. compatibility warnings, grouped -----------------------------------------------------------------

test("issueGroups: one line per kind of problem, with the days", () => {
  const issues = [
    { code: "out_of_range", where: "week", day: 0, temperature: 40, mode: "heat", preset: null },
    { code: "out_of_range", where: "week", day: 2, temperature: 40, mode: "heat", preset: null },
    { code: "unsupported_mode", where: "holiday", day: null, temperature: null, mode: "cool", preset: null },
    { code: "unsupported_preset", where: "week", day: 1, temperature: 20, mode: "heat", preset: "turbo" },
  ];
  const groups = issueGroups(issues);
  assert.deepEqual(groups.map((g) => g.code), ["unsupported_mode", "unsupported_preset", "out_of_range"]);
  assert.deepEqual(groups[2].days, [0, 2]);
  assert.deepEqual(groups[0].days, ["holiday"]);
  assert.deepEqual(issueGroups([]), []);
});

// ---- 9. rendering: text only, switch only for who can edit ---------------------------------------------

function flatten(result, out = { strings: [], values: [] }) {
  if (result === null || result === undefined || typeof result === "boolean") return out;
  if (Array.isArray(result)) { result.forEach((r) => flatten(r, out)); return out; }
  if (typeof result === "object" && "strings" in result) {
    out.strings.push(...result.strings);
    result.values.forEach((v) => flatten(v, out));
    return out;
  }
  if (typeof result === "function") return out;
  out.values.push(result);
  return out;
}
const markup = (result) => flatten(result).strings.join("");

async function card(props = {}) {
  const { CronoRoomCard } = await import(`${FE}/components/crono-room-card.js`);
  const c = new CronoRoomCard();
  const row = soggiorno();
  row.server = { ...row.server, manual: true, override_until: "2026-11-01T12:00:00+01:00", slot: { start: "2026-11-01T06:00:00+01:00", end: "2026-11-01T17:00:00+01:00", mode: "heat", temperature: 21, preset: "eco", auto: false }, next_slot: { start: "2026-11-01T17:00:00+01:00", end: "2026-11-02T06:00:00+01:00", mode: "off", temperature: null, preset: null, auto: true } };
  c.hass = { language: "it", config: { time_zone: "Europe/Rome" } };
  c.row = row;
  c.canEdit = true;
  Object.assign(c, props);
  return c;
}

test("the room card shows status as words, the manual badge with its return button, and the bands", async () => {
  const c = await card();
  const flat = flatten(c.render());
  const html = markup(c.render());
  assert.ok(flat.values.some((v) => typeof v === "string" && v.includes(it["status.ok"])), "status in words");
  assert.ok(flat.values.some((v) => typeof v === "string" && v.startsWith("Manuale fino alle ")), "manual badge");
  assert.ok(flat.values.includes(it["room.resume_auto"]), "back to automatic");
  assert.match(html, /role="switch"/);
  assert.match(html, /aria-checked/);
});

test("the room card renders hostile names only as bound values", async () => {
  const evil = '<img src=x onerror=alert(1)> "onmouseover=x </title> ${7*7}';
  const c = await card();
  c.row = { ...c.row, name: evil, area: evil, otherProgramName: evil };
  const flat = flatten(c.render());
  const html = markup(c.render());
  assert.ok(!html.includes("<img") && !html.includes("onerror") && !html.includes("7*7"));
  assert.ok(flat.values.some((v) => typeof v === "string" && v.includes(evil)), "present as a value");
  const unknown = await card();
  unknown.row = { ...unknown.row, status: "<script>x</script>" };
  assert.ok(!markup(unknown.render()).includes("<script"));
});

test("without the right to edit the card has no switch and no remove button; pause, force and automatic stay", async () => {
  const c = await card({ canEdit: false });
  const html = markup(c.render());
  assert.doesNotMatch(html, /role="switch"/);
  const flat = flatten(c.render());
  assert.ok(flat.values.includes(it["room.resume_auto"]));
  assert.ok(flat.values.some((v) => typeof v === "string" && v.includes(it["room.pause"])));
  assert.ok(flat.values.some((v) => typeof v === "string" && v.includes(it["room.force"])));
});

test("an unassigned room offers neither pause nor force nor automatic", async () => {
  const c = await card();
  c.row = { ...c.row, server: null, assignedHere: false, status: "unassigned" };
  const flat = flatten(c.render());
  assert.ok(!flat.values.includes(it["room.resume_auto"]));
  assert.ok(!flat.values.some((v) => typeof v === "string" && v.includes(it["room.force"])));
  assert.ok(!flat.values.some((v) => typeof v === "string" && v.includes(it["room.pause"])));
});

test("a paused room offers Resume, not Pause", async () => {
  const c = await card();
  c.row = { ...c.row, status: "paused", server: { ...c.row.server, paused: true, manual: false } };
  const flat = flatten(c.render());
  assert.ok(flat.values.some((v) => typeof v === "string" && v.includes(it["room.resume"])));
  assert.ok(!flat.values.some((v) => typeof v === "string" && v === it["room.pause"]));
});

test("the manual dialog shows the limits of the room and the note on how long it lasts; markup in presets stays text", async () => {
  const { CronoManualDialog } = await import(`${FE}/components/crono-manual-dialog.js`);
  const d = new CronoManualDialog();
  d.hass = { language: "it" };
  const row = soggiorno();
  row.climate = { ...row.climate, presetModes: ["eco", "<b>x</b>"] };
  d.room = row;
  d.open = true;
  d.willUpdate(new Map([["room", undefined]]));
  const html = markup(d.render());
  const flat = flatten(d.render());
  assert.ok(flat.values.includes(it["room.force_note"]));
  assert.ok(flat.values.some((v) => typeof v === "string" && v.includes("15") && v.includes("25") && v.includes("accetta")), "limits");
  assert.ok(flat.values.includes("<b>x</b>"));
  assert.ok(!html.includes("<b>x</b>"));
  assert.match(html, /inputmode="decimal"/, "a text field: a number field would erase \"19.\" while typing");
});

// ---- 10. texts --------------------------------------------------------------------------------------

test("all the new texts exist in both languages with the same placeholders; the rooms placeholder is gone", () => {
  const keys = Object.keys(en).filter((k) => /^(room|status|issue)\./.test(k));
  assert.ok(keys.length > 20);
  for (const key of keys) {
    assert.ok(key in it, key);
    assert.deepEqual(it[key].match(/\{\w+\}/g)?.sort() ?? [], en[key].match(/\{\w+\}/g)?.sort() ?? [], key);
  }
  assert.ok(!("editor.soon_rooms" in it) && !("editor.soon_rooms" in en) && !("editor.soon" in en));
});

test("every room.*, status.* and issue.* key is used by the code (nothing orphaned)", () => {
  const dir = new URL(`${FE}/`, import.meta.url).pathname;
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".js") && !d.includes("i18n") && e.name !== "lit.js" ? [`${d}/${e.name}`] : []));
  const code = walk(dir).map((f) => readFileSync(f, "utf8")).join("\n");
  const orphans = Object.keys(en).filter((k) => /^(room|status|issue)\./.test(k)).filter((key) => {
    const base = key.replace(/_(one|other)$/, "");
    if (/^status\./.test(key)) {
      const name = key.slice("status.".length);
      return name === "unknown" ? !code.includes('"status.unknown"') : !KNOWN_STATUSES.includes(name);
    }
    return !code.includes(`"${base}"`) && !code.includes(`\`${base}\``) && !(base.startsWith("issue.") && code.includes("`issue.${"));
  });
  assert.deepEqual(orphans, []);
});

test("the editor uses the rooms component", () => {
  const src = readFileSync(new URL(`${FE}/components/crono-editor.js`, import.meta.url), "utf8");
  assert.match(src, /<crono-rooms/);
  assert.doesNotMatch(src, /_placeholder|soon_rooms/);
});

test("climateRooms keeps working for the rows (sanity)", () => {
  assert.equal(climateRooms({ states: STATES }).length, 3);
});

// ---- 11. review fixes: canEdit, actions per status, stale state, texts ---------------------------------

const withStatus = (status, extra = {}) => ({ ...soggiorno(), status, server: { ...soggiorno().server, ...extra } });

test("toggleAction: without the right to edit (or without a program) nothing can be done", () => {
  const free = rowOf(rowsFor([]), "climate.soggiorno");
  assert.equal(toggleAction({ canEdit: false, program: PROGRAMS[0], row: free }), null);
  assert.equal(toggleAction({ canEdit: false, program: PROGRAMS[0], row: soggiorno() }), null);
  assert.equal(toggleAction({ canEdit: true, program: null, row: free }), null);
  assert.equal(toggleAction({ canEdit: true, program: PROGRAMS[0], row: free }), "assign");
  assert.equal(toggleAction({ canEdit: true, program: PROGRAMS[0], row: soggiorno() }), "unassign");
  assert.equal(toggleAction({ canEdit: undefined, program: PROGRAMS[0], row: free }), null, "unknown is not allowed");
});

test("the rooms component ignores the switch without canEdit and sends nothing", async () => {
  const { CronoRooms } = await import(`${FE}/components/crono-rooms.js`);
  const hass = makeHass({ ws: { "cronotermostato/assign": {}, "cronotermostato/unassign": {} } });
  hass.states = STATES;
  const c = new CronoRooms();
  c.hass = hass;
  c.program = PROGRAMS[0];
  c.state = { rooms: [], programs: PROGRAMS, loading: false };
  c.canEdit = false;
  const free = rowOf(rowsFor([]), "climate.soggiorno");
  c._onToggle({ detail: { row: free } });
  c._onToggle({ detail: { row: soggiorno() } });
  await flush();
  await flush();
  assert.equal(hass.wsCalls.length, 0);
  assert.equal(c._ask, null);
});

test("the room card has no switch role without canEdit, also for an assigned room", async () => {
  const c = await card({ canEdit: false });
  assert.doesNotMatch(markup(c.render()), /role="switch"|crono-room-toggle/);
  assert.match(markup((await card({ canEdit: true })).render()), /role="switch"/);
});

test("availableActions: not running and missing rooms offer no pause, force or resume, only an explanation", () => {
  for (const status of ["not_running", "missing"]) {
    const a = availableActions(withStatus(status));
    assert.deepEqual({ force: a.force, pause: a.pause, resume: a.resume, auto: a.auto }, { force: false, pause: false, resume: false, auto: false }, status);
    assert.equal(a.note, `room.${status}_note`);
  }
  assert.equal(availableActions(withStatus("not_running", { manual: true })).auto, false);
  const free = availableActions({ ...soggiorno(), server: null, status: "unassigned" });
  assert.deepEqual({ force: free.force, pause: free.pause, resume: free.resume, auto: free.auto, note: free.note }, { force: false, pause: false, resume: false, auto: false, note: null });
  const ok = availableActions(withStatus("ok"));
  assert.deepEqual({ force: ok.force, pause: ok.pause, resume: ok.resume, auto: ok.auto, note: ok.note }, { force: true, pause: true, resume: false, auto: false, note: null });
  assert.equal(availableActions(withStatus("ok", { manual: true })).auto, true);
  const paused = availableActions(withStatus("paused", { paused: true }));
  assert.deepEqual({ force: paused.force, pause: paused.pause, resume: paused.resume }, { force: true, pause: false, resume: true });
  for (const status of ["unavailable", "unsupported_mode", "unsupported_preset", "out_of_range", "error", "heating_up"]) assert.equal(availableActions(withStatus(status)).force, true, status);
  assert.ok(it["room.not_running_note"] && en["room.not_running_note"] && it["room.missing_note"] && en["room.missing_note"]);
});

test("the room card of a not running or missing room has no action buttons but explains why", async () => {
  for (const status of ["not_running", "missing"]) {
    const c = await card();
    c.row = { ...c.row, status, server: { ...c.row.server, manual: false } };
    const flat = flatten(c.render());
    assert.ok(!flat.values.some((v) => typeof v === "string" && (v.includes(it["room.force"]) || v.includes(it["room.pause"]))), status);
    assert.doesNotMatch(markup(c.render()), /crono-room-(force|pause|resume|auto)/, status);
    assert.ok(flat.values.includes(it[`room.${status}_note`]), status);
    assert.match(markup(c.render()), /role="switch"/, "removing stays possible for admins");
  }
});

// stale state: the room changes between the click and the reread
const stateWith = (rooms) => ({ rooms, programs: PROGRAMS });
const serverRoom = (program_id, extra = {}) => ({ climate_entity_id: "climate.soggiorno", program_id, program_name: program_id === "p1" ? "Casa" : "Estate", status: "ok", ...extra });
const readerOf = (rooms, program = PROGRAMS[0]) => async () => ({ state: stateWith(rooms), program });

test("toggleRoom: a room moved to another program while the user was looking asks with the right source program", async () => {
  const hass = makeHass({ ws: { "cronotermostato/assign": {} } });
  hass.states = STATES;
  const clicked = rowOf(rowsFor([serverRoom("p2")]), "climate.soggiorno"); // the user saw p2
  const seen = [];
  const result = await toggleRoom(hass, { row: clicked, programId: "p1", readState: readerOf([serverRoom("p3", { program_name: "Inverno" })]), confirm: async (plan) => (seen.push(plan.fromName), true) });
  assert.equal(result.cancelled, false);
  assert.deepEqual(seen, ["Inverno"], "the dialog is the updated one");
  assert.equal(hass.wsCalls.length, 1);
});

test("toggleRoom: unassign is sent only if the room is still assigned to this program, checked before and after the question", async () => {
  const hass = makeHass({ ws: { "cronotermostato/unassign": {} } });
  hass.states = STATES;
  const clicked = soggiorno(); // assigned to p1
  // moved elsewhere before the dialog
  const before = await toggleRoom(hass, { row: clicked, programId: "p1", readState: readerOf([serverRoom("p2")]), confirm: async () => assert.fail("no question for a changed room") });
  assert.deepEqual({ cancelled: before.cancelled, changed: before.changed }, { cancelled: true, changed: true });
  // already removed
  const gone = await toggleRoom(hass, { row: clicked, programId: "p1", readState: readerOf([]), confirm: async () => assert.fail("no question") });
  assert.equal(gone.changed, true);
  // moved while the dialog was open
  let reads = 0;
  const readState = async () => ({ state: stateWith([serverRoom(++reads === 1 ? "p1" : "p2")]), program: PROGRAMS[0] });
  const during = await toggleRoom(hass, { row: clicked, programId: "p1", readState, confirm: async () => true });
  assert.deepEqual({ cancelled: during.cancelled, changed: during.changed }, { cancelled: true, changed: true });
  assert.equal(hass.wsCalls.length, 0, "nothing sent in any of the three cases");
  // unchanged: sent
  const ok = await toggleRoom(hass, { row: clicked, programId: "p1", readState: readerOf([serverRoom("p1")]), confirm: async () => true });
  assert.equal(ok.cancelled, false);
  assert.deepEqual(hass.wsCalls, [{ type: "cronotermostato/unassign", climate_entity_id: "climate.soggiorno" }]);
});

test("toggleRoom: assigning a room that is already here by now, or a program that vanished, is cancelled as changed", async () => {
  const hass = makeHass({ ws: { "cronotermostato/assign": {} } });
  hass.states = STATES;
  const free = rowOf(rowsFor([]), "climate.soggiorno");
  const here = await toggleRoom(hass, { row: free, programId: "p1", readState: readerOf([serverRoom("p1")]), confirm: async () => assert.fail("no") });
  assert.equal(here.changed, true);
  const noProgram = await toggleRoom(hass, { row: free, programId: "p1", readState: readerOf([], null), confirm: async () => assert.fail("no") });
  assert.equal(noProgram.changed, true);
  assert.equal(hass.wsCalls.length, 0);
});

test("toggleRoom: the dialog uses the program as just read (its issues), not the one seen at the click", async () => {
  const hass = makeHass({ ws: { "cronotermostato/assign": {} } });
  hass.states = STATES;
  const free = rowOf(rowsFor([]), "climate.soggiorno");
  let issues = null;
  await toggleRoom(hass, { row: free, programId: "p2", readState: readerOf([], PROGRAMS[1]), confirm: async (plan) => ((issues = plan.issues.length), true) });
  assert.ok(issues > 0);
});

test("runAction passes the value of a cancelled action to the caller", async () => {
  const r = await runAction(createGuard(), "r", async () => ({ cancelled: true, changed: true }), { refresh: async () => {} });
  assert.deepEqual({ status: r.status, changed: r.value.changed }, { status: "cancelled", changed: true });
});

test("reconcileManual: the dialog closes (and forgets) when the room disappears or can no longer be forced", () => {
  const rows = rowsFor([serverRoom("p1")]);
  const manual = { id: "climate.soggiorno", busy: false, error: null };
  assert.deepEqual(reconcileManual(manual, rows), { manual, gone: false });
  assert.deepEqual(reconcileManual(manual, rowsFor([])), { manual: null, gone: true });
  assert.deepEqual(reconcileManual(manual, rowsFor([serverRoom("p1", { status: "not_running" })])), { manual: null, gone: true });
  assert.deepEqual(reconcileManual(null, rows), { manual: null, gone: false });
});

test("the rooms component forgets a forced-setting dialog whose room vanished, and says so", async () => {
  const { CronoRooms } = await import(`${FE}/components/crono-rooms.js`);
  const hass = makeHass();
  hass.states = STATES;
  const c = new CronoRooms();
  c.hass = hass;
  c.program = PROGRAMS[0];
  c.state = stateWith([serverRoom("p1")]);
  c._manual = { id: "climate.soggiorno", busy: false, error: null };
  c.state = stateWith([]);
  c.willUpdate();
  assert.equal(c._manual, null);
  assert.ok(c._notice);
  c.state = stateWith([serverRoom("p1")]);
  c.willUpdate();
  assert.equal(c._manual, null, "it does not come back");
  // _applyManual with a vanished row
  c._manual = { id: "climate.soggiorno", busy: false, error: null };
  c.state = stateWith([]);
  await c._applyManual({ detail: { form: { mode: "heat", temperature: "20", preset: "" } } });
  assert.equal(c._manual, null);
  assert.equal(hass.serviceCalls.length, 0);
});

test("stepNotice: a value that is not a multiple of the step of the room warns, without blocking", () => {
  const room = { ...soggiorno().climate, step: 0.5, stepKnown: true };
  assert.equal(stepNotice({ mode: "heat", temperature: "21,3" }, room).step, 0.5);
  assert.equal(stepNotice({ mode: "heat", temperature: "21,5" }, room), null);
  assert.equal(stepNotice({ mode: "heat", temperature: "21" }, room), null);
  assert.equal(stepNotice({ mode: "heat", temperature: "20.7" }, { ...room, step: 0.1 }), null, "0.1 steps: float noise is not a warning");
  assert.equal(stepNotice({ mode: "off", temperature: "21,3" }, room), null);
  assert.equal(stepNotice({ mode: "heat", temperature: "" }, room), null);
  assert.equal(stepNotice({ mode: "heat", temperature: "abc" }, room), null);
  assert.equal(stepNotice({ mode: "heat", temperature: "21,3" }, { ...room, stepKnown: false }), null, "a step the room does not declare is not imposed");
  assert.equal(stepNotice({ mode: "heat", temperature: "21,3" }, null), null);
  assert.equal(validateManual({ mode: "heat", temperature: "21,3", preset: "" }, room).ok, true, "never blocks");
  assert.equal(climateRooms({ states: STATES }).find((r) => r.id === "climate.soggiorno").stepKnown, true);
  assert.equal(climateRooms({ states: STATES }).find((r) => r.id === "climate.camera").stepKnown, false);
});

test("the manual dialog shows the step notice in both languages", async () => {
  const { CronoManualDialog } = await import(`${FE}/components/crono-manual-dialog.js`);
  for (const [language, table] of [["it", it], ["en", en]]) {
    const d = new CronoManualDialog();
    d.hass = { language };
    d.room = soggiorno();
    d.open = true;
    d.willUpdate(new Map());
    d._form = { mode: "heat", temperature: "21,3", preset: "" };
    const flat = flatten(d.render());
    assert.ok(flat.values.some((v) => typeof v === "string" && v === createT({ language })("room.step_note", { step: "0,5 °C".replace(",", language === "en" ? "." : ",") })), language);
    d._form = { mode: "heat", temperature: "21,5", preset: "" };
    assert.ok(!flatten(d.render()).values.some((v) => typeof v === "string" && v.includes(table["room.step_note"].slice(0, 12))), language);
  }
});

test("texts: Move, removal drops a forced setting, midnight, dirty draft note", async () => {
  assert.equal(tIt("room.move"), "Sposta");
  assert.equal(tEn("room.move"), "Move");
  assert.match(tIt("room.unassign_confirm", { name: "S" }), /forzatura in corso decade/);
  assert.match(tEn("room.unassign_confirm", { name: "S" }), /manual setting in progress ends/);
  const zone = { now: NOW, timeZone: "Europe/Rome" };
  assert.equal(untilText(tIt, "2026-11-02T00:00:00+01:00", zone), "fino a mezzanotte");
  assert.equal(untilText(tEn, "2026-11-02T00:00:00+01:00", zone), "until midnight");
  assert.equal(untilText(tIt, "2026-11-01T00:00:00+01:00", zone), "fino alle 00:00", "00:00 of today is not midnight to come");
  assert.equal(untilText(tIt, "2026-11-02T00:30:00+01:00", zone), "fino alle 00:30 di domani");
  assert.equal(it["room.dirty_note"], "Ci sono modifiche non salvate: gli avvisi riguardano il programma salvato.");
  assert.ok(en["room.dirty_note"]);
  const { CronoRooms } = await import(`${FE}/components/crono-rooms.js`);
  const c = new CronoRooms();
  c.hass = { language: "it", states: STATES };
  const free = rowOf(rowsFor([]), "climate.soggiorno");
  const ask = { kind: "assign", row: free, plan: assignPlan(free, PROGRAMS[1]) };
  c.dirty = false;
  assert.ok(!flatten(c._askContent(tIt, ask)).values.includes(it["room.dirty_note"]));
  c.dirty = true;
  assert.ok(flatten(c._askContent(tIt, ask)).values.includes(it["room.dirty_note"]));
  // the button of a move says Move
  const moving = { kind: "assign", row: free, plan: { ...ask.plan, moves: true, fromName: "X" } };
  c._ask = moving;
  assert.ok(flatten(c._renderAsk(tIt)).values.includes("Sposta"));
  c._ask = ask;
  assert.ok(flatten(c._renderAsk(tIt)).values.includes("Assegna"));
});

test("issue temperatures and limits are written with the number format of HA, not String()", () => {
  const climate = { minTemp: 15, maxTemp: 25 };
  const issue = { code: "out_of_range", temperature: 40.5, mode: "heat", preset: null };
  const p = issueParams(tIt, issue, climate, { language: "it" });
  assert.deepEqual([p.temperature, p.min, p.max], ["40,5", "15", "25"]);
  assert.equal(issueParams(tEn, issue, climate, { language: "en" }).temperature, "40.5");
  assert.equal(issueParams(tIt, { code: "unsupported_mode", mode: "cool", temperature: null, preset: null }, climate, { language: "it" }).mode, it["mode.cool"]);
  assert.equal(issueParams(tIt, { code: "unsupported_mode", mode: "x", temperature: null, preset: null }, null, { language: "it" }).temperature, "");
});
