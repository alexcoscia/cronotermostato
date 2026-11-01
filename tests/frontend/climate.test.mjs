import test from "node:test";
import assert from "node:assert/strict";
import { climateRooms, roomIssues, temperatureLimits } from "../../custom_components/cronotermostato/frontend/lib/climate.js";

const state = (s, attributes) => ({ state: s, attributes });

test("climateRooms lists only climate entities, sorted by name, with fallbacks", () => {
  const hass = { states: {
    "climate.b": state("heat", { friendly_name: "Bagno", hvac_modes: ["heat", "off"], preset_modes: ["home"], min_temp: 15, max_temp: 25, target_temp_step: 1 }),
    "climate.a": state("unavailable", {}),
    "sensor.x": state("1", {}),
  } };
  const rooms = climateRooms(hass);
  assert.deepEqual(rooms.map((r) => r.id), ["climate.b", "climate.a"]);
  const [b, a] = rooms;
  assert.equal(a.name, "climate.a");
  assert.equal(a.available, false);
  assert.deepEqual([a.minTemp, a.maxTemp, a.step], [5, 35, 0.5]);
  assert.deepEqual(a.hvacModes, []);
  assert.deepEqual(a.presetModes, []);
  assert.equal(b.name, "Bagno");
  assert.deepEqual([b.minTemp, b.maxTemp, b.step], [15, 25, 1]);
  assert.deepEqual(b.hvacModes, ["heat", "off"]);
  assert.equal(b.available, true);
});

test("temperatureLimits follows the controller", () => {
  assert.deepEqual(temperatureLimits({ min_temp: 15, max_temp: 25 }), [15, 25]);
  assert.deepEqual(temperatureLimits({ min_temp: "15", max_temp: "25.5" }), [15, 25.5]);
  for (const attrs of [{}, { min_temp: 25, max_temp: 15 }, { min_temp: 20, max_temp: 20 }, { min_temp: 15 }, { min_temp: true, max_temp: 25 }, { min_temp: "x", max_temp: 25 }, { min_temp: "", max_temp: 25 }, { min_temp: NaN, max_temp: 25 }, { min_temp: 15, max_temp: Infinity }, undefined]) {
    assert.deepEqual(temperatureLimits(attrs), [5, 35], JSON.stringify(attrs));
  }
});

const room = (extra = {}) => ({ id: "climate.r", available: true, hvacModes: ["heat", "off"], presetModes: ["home"], minTemp: 15, maxTemp: 25, step: 0.5, ...extra });
const band = (mode, temperature, preset) => ({ start: "07:00", end: "08:00", mode, temperature: temperature ?? null, preset: preset ?? null });
const program = (day, holiday = []) => ({ week: [day, [], [], [], [], [], []], holiday });
const codes = (issues) => issues.map((i) => i.code);

test("cool is unsupported_mode, 28 degrees out_of_range, missing preset unsupported_preset", () => {
  assert.deepEqual(codes(roomIssues(program([band("cool", 20)]), room())), ["unsupported_mode"]);
  assert.deepEqual(codes(roomIssues(program([band("heat", 28)]), room())), ["out_of_range"]);
  assert.deepEqual(codes(roomIssues(program([band("heat", null, "eco")]), room())), ["unsupported_preset"]);
  assert.deepEqual(roomIssues(program([band("heat", 20, "home"), band("off")]), room()), []);
});

test("limits are inclusive", () => {
  assert.deepEqual(roomIssues(program([band("heat", 15), band("heat", 25)]), room()), []);
  assert.deepEqual(codes(roomIssues(program([band("heat", 14.5)]), room())), ["out_of_range"]);
});

test("checks run in the controller order: mode, then preset, then range", () => {
  assert.deepEqual(codes(roomIssues(program([band("cool", 99, "eco")]), room())), ["unsupported_mode"]);
  assert.deepEqual(codes(roomIssues(program([band("heat", 99, "eco")]), room())), ["unsupported_preset"]);
  assert.deepEqual(codes(roomIssues(program([band("heat", 99, "home")]), room())), ["out_of_range"]);
});

test("a preset without temperature is never range checked", () => {
  assert.deepEqual(roomIssues(program([band("heat", null, "home")]), room({ minTemp: 30, maxTemp: 31 })), []);
});

test("issues locate the band and cover week and holiday", () => {
  const issues = roomIssues(program([band("heat", 20), band("cool", 20)], [band("heat", 30)]), room());
  assert.deepEqual(issues.map((i) => [i.code, i.where, i.day, i.index]), [
    ["unsupported_mode", "week", 0, 1],
    ["out_of_range", "holiday", null, 0],
  ]);
});

test("automatic off bands count when the full week is present", () => {
  const p = { ...program([]), week_full: [[{ start: "00:00", end: "24:00", mode: "off", auto: true }], [], [], [], [], [], []], holiday_full: [] };
  assert.deepEqual(codes(roomIssues(p, room({ hvacModes: ["heat"] }))), ["unsupported_mode"]);
  assert.deepEqual(roomIssues(p, room()), []);
});

test("an unavailable room has no issues to report", () => {
  assert.deepEqual(roomIssues(program([band("cool", 99)]), room({ available: false, hvacModes: [] })), []);
});

test("garbage in does not throw", () => {
  assert.deepEqual(roomIssues(null, room()), []);
  assert.deepEqual(roomIssues({ week: "x", holiday: null }, room()), []);
  assert.deepEqual(roomIssues(program([null, 5]), room()), []);
});
