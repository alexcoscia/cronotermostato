import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { makeHass } from "./fake-hass.mjs";
import { setPresetTemperatures, getPresetTemperatures } from "../../custom_components/cronotermostato/frontend/lib/api.js";
import { tableOf, presetTemperature, presetInputIssue, tableToSend } from "../../custom_components/cronotermostato/frontend/lib/preset-temps.js";

const FE = "../../custom_components/cronotermostato/frontend";
const flat = (r, out = { s: [], v: [] }) => {
  if (r === null || r === undefined || typeof r === "boolean") return out;
  if (Array.isArray(r)) { r.forEach((x) => flat(x, out)); return out; }
  if (typeof r === "object" && "strings" in r) { out.s.push(...r.strings); r.values.forEach((v) => flat(v, out)); return out; }
  if (typeof r !== "function") out.v.push(r);
  return out;
};
const text = (r) => { const f = flat(r); return f.s.join("|") + "\n" + f.v.filter((v) => typeof v !== "symbol").join("|"); };
const listen = (el, out, pick) => { el.dispatchEvent = (e) => { out.push(pick(e.detail)); return true; }; };

const room = (id, presets, extra = {}) => ({ id, presetModes: presets, minTemp: 7, maxTemp: 30, step: 0.5, ...extra });
const server = (id, table) => ({ climate_entity_id: id, preset_temperatures: table });

test("tableOf drops everything that is not a number", () => {
  assert.deepEqual(tableOf(server("a", { home: 20, away: "x", eco: null, b: true, c: "18.5" })), { home: 20, c: 18.5 });
  assert.deepEqual(tableOf({}), {});
  assert.deepEqual(tableOf(null), {});
  assert.deepEqual(tableOf({ preset_temperatures: [1] }), {});
});

test("presetTemperature: value, unset, varies, free text, no preset", () => {
  const a = room("climate.a", ["home", "away"]);
  const b = room("climate.b", ["home"]);
  const rooms = [server("climate.a", { home: 20, away: 16 }), server("climate.b", { home: 20 })];
  assert.deepEqual(presetTemperature("home", [a], rooms), { kind: "value", value: 20 });
  assert.deepEqual(presetTemperature("home", [a, b], rooms), { kind: "value", value: 20 }, "all rooms agree");
  assert.deepEqual(presetTemperature("away", [a, b], rooms), { kind: "value", value: 16 }, "only rooms with the preset count");
  assert.deepEqual(presetTemperature("eco", [room("climate.a", ["eco"])], rooms), { kind: "unset" });
  const other = [server("climate.a", { home: 20 }), server("climate.b", { home: 21 })];
  assert.deepEqual(presetTemperature("home", [a, b], other), { kind: "varies" });
  assert.deepEqual(presetTemperature("home", [a, b], [server("climate.a", { home: 20 })]), { kind: "varies" }, "one has it, one does not");
  assert.equal(presetTemperature("libero", [a], rooms), null, "not a preset of the rooms: the field stays free");
  assert.equal(presetTemperature(null, [a], rooms), null);
  assert.equal(presetTemperature("  ", [a], rooms), null);
  assert.equal(presetTemperature("home", [], rooms), null);
  assert.deepEqual(presetTemperature("home", [a], []), { kind: "unset" }, "room not assigned: no table");
});

test("presetInputIssue and tableToSend", () => {
  const r = room("climate.a", ["home", "away"]);
  assert.equal(presetInputIssue("", r), null);
  assert.equal(presetInputIssue("20", r), null);
  assert.equal(presetInputIssue("20,5", r), null);
  assert.equal(presetInputIssue("abc", r), "not_number");
  assert.equal(presetInputIssue("31", r), "out_of_range");
  assert.equal(presetInputIssue("6.5", r), "out_of_range");
  assert.equal(presetInputIssue("20.2", r), "bad_step");
  assert.equal(presetInputIssue("20.1", room("c", [], { step: 0.1 })), null);
  assert.deepEqual(tableToSend({ home: "20,5", away: "", gone: "9" }, r), { home: 20.5 });
});

test("api: set and get preset temperatures", async () => {
  const hass = makeHass({ ws: { "cronotermostato/set_preset_temperatures": (m) => ({ preset_temperatures: m.preset_temperatures }), "cronotermostato/get_preset_temperatures": { preset_temperatures: { home: 20 } } } });
  assert.deepEqual(await setPresetTemperatures(hass, "climate.a", { home: 20 }), { home: 20 });
  assert.deepEqual(hass.wsCalls[0], { type: "cronotermostato/set_preset_temperatures", climate_entity_id: "climate.a", preset_temperatures: { home: 20 } });
  assert.deepEqual(await getPresetTemperatures(hass, "climate.a"), { home: 20 });
});

// ---- the band row ----------------------------------------------------------------------------

async function bandRow(band, info, extra = {}) {
  const { CronoBandRow } = await import(`${FE}/components/crono-band-row.js`);
  const r = new CronoBandRow();
  r.hass = { language: "it" };
  r.band = { key: "a", start: "08:00", end: "12:00", mode: "heat", temperature: null, preset: null, auto: false, ...band };
  r.presets = ["home", "away"];
  r.hasRooms = true;
  r.presetTemp = typeof info === "function" ? info : (p) => (p === "home" || p === "away" ? info : null);
  Object.assign(r, extra);
  return r;
}

test("a preset with a value: the field shows it, read only; + and - are aria-disabled and do nothing", async () => {
  const r = await bandRow({ preset: "home" }, { kind: "value", value: 20 });
  const t = text(r.render());
  assert.equal(r._locked(), true);
  assert.ok(flat(r.render()).v.includes("20"), "the value is shown");
  assert.ok(flat(r.render()).v.includes(`${r._id}-tempnote`), "note linked with aria-describedby");
  assert.match(t, /Temperatura del preset, modificabile nelle impostazioni della stanza/);
  const events = [];
  listen(r, events, (d) => d);
  r._bump(1, undefined);
  r._bump(-1, undefined);
  assert.deepEqual(events, []);
});

test("a preset without a value: empty field, note 'not set'; with differing rooms: 'varies'", async () => {
  const unset = await bandRow({ preset: "home" }, { kind: "unset" });
  assert.match(text(unset.render()), /non è impostata/);
  assert.ok(!flat(unset.render()).v.includes("20"));
  const varies = await bandRow({ preset: "home" }, { kind: "varies" });
  assert.match(text(varies.render()), /varia da stanza a stanza/);
  assert.equal(varies._locked(), true);
});

test("no preset, or a free text with no match, or off, or an own temperature: the field is active", async () => {
  for (const [band, info] of [
    [{ preset: null, temperature: 21 }, { kind: "value", value: 20 }],
    [{ preset: null, temperature: null }, { kind: "value", value: 20 }],
    [{ preset: "libero" }, { kind: "value", value: 20 }],
    [{ preset: "home", mode: "off" }, { kind: "value", value: 20 }],
    [{ preset: "home", temperature: 22 }, { kind: "value", value: 20 }], // saved before: both
  ]) {
    const r = await bandRow(band, info);
    assert.equal(r._locked(), false, JSON.stringify(band));
    assert.ok(!flat(r.render()).v.includes(`${r._id}-tempnote`), "no note");
  }
  const r = await bandRow({ preset: null, temperature: 21 }, { kind: "value", value: 20 });
  const events = [];
  listen(r, events, (d) => d.patch);
  r._bump(1, undefined);
  assert.deepEqual(events, [{ temperature: 21.5 }]);
});

test("choosing a known preset clears the band temperature; choosing none or a free text leaves it", async () => {
  const r = await bandRow({ preset: null, temperature: 21 }, { kind: "value", value: 20 });
  const patches = [];
  listen(r, patches, (d) => d.patch);
  r._onPresetSelect({ target: { value: "p:home" } });
  r._onPresetSelect({ target: { value: "" } });
  r._onPreset({ target: { value: "libero" } });
  assert.deepEqual(patches, [{ preset: "home", temperature: null }, { preset: null }, { preset: "libero" }]);
});

test("from preset back to none: the field is active again and empty (no value is invented)", async () => {
  const r = await bandRow({ preset: "home" }, { kind: "value", value: 20 });
  assert.equal(r._locked(), true);
  r.band = { ...r.band, preset: null };
  assert.equal(r._locked(), false);
  assert.ok(!flat(r.render()).v.includes("20"));
});

test("read only row shows the preset temperature as text", async () => {
  const r = await bandRow({ preset: "home" }, { kind: "value", value: 20 }, { readOnly: true });
  assert.match(text(r.render()), /20/);
});

// ---- the room card ----------------------------------------------------------------------------

async function card(extra = {}) {
  const { CronoRoomCard } = await import(`${FE}/components/crono-room-card.js`);
  const c = new CronoRoomCard();
  c.hass = { language: "it" };
  c.canEdit = true;
  c.row = {
    id: "climate.a", name: "Salotto", area: null, assignedHere: true, status: "ok", otherProgramName: null,
    climate: room("climate.a", ["home", "away"]),
    server: { status: "ok", manual: false, slot: null, next_slot: null, preset_temperatures: { home: 20 } },
  };
  Object.assign(c, extra);
  return c;
}

test("room card: one field per preset with the table value; save sends the whole table", async () => {
  const c = await card();
  c.willUpdate();
  const out = text(c.render());
  assert.match(out, /Temperature dei preset/);
  assert.deepEqual(c._values(c.row.climate), { home: "20", away: "" });
  const events = [];
  listen(c, events, (d) => d.table);
  c._onPresetInput("away", { target: { value: "16" } });
  c._savePresets({ preventDefault() {} });
  assert.deepEqual(events, [{ home: 20, away: 16 }]);
  c._onPresetInput("home", { target: { value: "" } });
  c._savePresets({ preventDefault() {} });
  assert.deepEqual(events[1], { away: 16 }, "empty = unknown");
});

test("room card: invalid input blocks the save and is described; a new server table drops the draft", async () => {
  const c = await card();
  c.willUpdate();
  const events = [];
  listen(c, events, (d) => d);
  c._onPresetInput("home", { target: { value: "99" } });
  assert.equal(c._draftIssues(c.row.climate).get("home"), "out_of_range");
  assert.match(text(c.render()), /7 a 30|7.*30/);
  c._savePresets({ preventDefault() {} });
  c._onPresetInput("home", { target: { value: "20.2" } });
  c._savePresets({ preventDefault() {} });
  assert.deepEqual(events, []);
  c.row = { ...c.row, server: { ...c.row.server, preset_temperatures: { home: 21 } } };
  c.willUpdate();
  assert.equal(c._draft, null);
  assert.equal(c._values(c.row.climate).home, "21");
});

test("room card: no section when read only, compact, not assigned or without presets", async () => {
  for (const extra of [{ canEdit: false }, { compact: true }]) {
    const c = await card(extra);
    assert.doesNotMatch(text(c.render()), /Temperature dei preset/);
  }
  const c = await card();
  c.row = { ...c.row, assignedHere: false };
  assert.doesNotMatch(text(c.render()), /Temperature dei preset/);
  c.row = { ...c.row, assignedHere: true, climate: room("climate.a", []) };
  assert.doesNotMatch(text(c.render()), /Temperature dei preset/);
});
