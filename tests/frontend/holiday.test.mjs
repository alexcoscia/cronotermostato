import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { makeHass } from "./fake-hass.mjs";
import { programsEqual, deserializeProgram } from "../../custom_components/cronotermostato/frontend/lib/model.js";
import { previewDay, saveProgram } from "../../custom_components/cronotermostato/frontend/lib/api.js";
import {
  HOLIDAY,
  draftFromServer,
  getDay,
  setDay,
  addBand,
  patchBand,
  copyDay,
  programErrors,
  isDirty,
  saveRequest,
  mergeDay,
} from "../../custom_components/cronotermostato/frontend/lib/day-editing.js";
import { locationLabel, copyTargetIds, quickTargets, integrationPath, shouldHandleClick } from "../../custom_components/cronotermostato/frontend/lib/holiday.js";
import it from "../../custom_components/cronotermostato/frontend/i18n/it.js";
import en from "../../custom_components/cronotermostato/frontend/i18n/en.js";

const FE = "../../custom_components/cronotermostato/frontend";
const sband = (start, end, mode = "heat", temperature = 20) => ({ start, end, mode, temperature, preset: null, auto: false });
const server = (extra = {}) => ({
  program_id: "p1",
  name: "Casa",
  revision: "r1",
  week: [[sband("06:00", "08:00", "heat", 21)], [], [], [], [], [], []],
  holiday: [sband("09:00", "12:00", "heat", 19)],
  ...extra,
});

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

// ---- 1. the holiday part is independent from the days ------------------------------------------

test("changing a day does not change the holiday part, and the other way round", () => {
  const draft = draftFromServer(server());
  const holiday = JSON.stringify(getDay(draft, HOLIDAY));
  const week = JSON.stringify(draft.week);
  const added = addBand(getDay(draft, 3));
  const afterDay = setDay(draft, 3, added.bands);
  assert.equal(JSON.stringify(getDay(afterDay, HOLIDAY)), holiday);
  const key = getDay(draft, HOLIDAY)[0].key;
  const afterHoliday = setDay(draft, HOLIDAY, patchBand(getDay(draft, HOLIDAY), key, { temperature: 23 }));
  assert.equal(JSON.stringify(afterHoliday.week), week);
  assert.equal(getDay(afterHoliday, HOLIDAY)[0].temperature, 23);
  assert.equal(getDay(draft, HOLIDAY)[0].temperature, 19, "the draft is not touched");
});

test("a new band on the holiday part follows the same rules as on a day", () => {
  const draft = draftFromServer(server());
  const { bands } = addBand(getDay(draft, HOLIDAY));
  assert.deepEqual([bands[1].start, bands[1].end, bands[1].mode, bands[1].temperature], ["12:00", "24:00", "heat", 19]);
  assert.equal(addBand([{ ...bands[1], start: "00:00", end: "24:00", key: "x", auto: false }]), null, "a full day takes no band");
});

test("the holiday part has the same validation (errors carry the HOLIDAY day)", () => {
  const draft = setDay(draftFromServer(server()), HOLIDAY, [
    { key: "a", start: "08:00", end: "10:00", mode: "heat", temperature: 20, preset: null, auto: false },
    { key: "b", start: "09:00", end: "11:00", mode: "heat", temperature: 20, preset: null, auto: false },
    { key: "c", start: "12:00", end: "13:00", mode: "heat", temperature: "", preset: null, auto: false },
  ]);
  const { summary, byKey } = programErrors(draft);
  assert.deepEqual(summary.map((e) => [e.day, e.code, e.key]).sort(), [[HOLIDAY, "missing_setting", "c"], [HOLIDAY, "overlap", "b"]]);
  assert.ok(byKey.has("b") && byKey.has("c"));
});

test("the automatic bands of the holiday preview are merged like those of a day, and not over a user band", () => {
  const user = [{ key: "a", start: "08:00", end: "12:00", mode: "heat", temperature: 20, preset: null, auto: false }];
  const preview = [
    { start: "00:00", end: "08:00", mode: "off", auto: true },
    { start: "08:00", end: "12:00", mode: "heat", temperature: 20, auto: false },
    { start: "10:00", end: "24:00", mode: "off", auto: true },
    { start: "12:00", end: "24:00", mode: "off", auto: true },
  ];
  const rows = mergeDay(user, preview);
  assert.deepEqual(rows.map((r) => [r.start, r.end, r.auto]), [["00:00", "08:00", true], ["08:00", "12:00", false], ["12:00", "24:00", true]]);
});

// ---- 2. copy between days and holiday ----------------------------------------------------------

test("copy day -> holiday replaces the holiday part with fresh keys, leaves the days alone", () => {
  const draft = draftFromServer(server());
  const out = copyDay(draft, 0, [HOLIDAY]);
  assert.deepEqual(getDay(out, HOLIDAY).map((b) => [b.start, b.end, b.temperature]), [["06:00", "08:00", 21]]);
  assert.notEqual(getDay(out, HOLIDAY)[0].key, getDay(draft, 0)[0].key);
  assert.equal(JSON.stringify(out.week), JSON.stringify(draft.week));
});

test("copy holiday -> days and holiday -> holiday (ignored)", () => {
  const draft = draftFromServer(server());
  const out = copyDay(draft, HOLIDAY, [1, 5, HOLIDAY]);
  for (const d of [1, 5]) assert.deepEqual(getDay(out, d).map((b) => [b.start, b.end, b.temperature]), [["09:00", "12:00", 19]]);
  assert.equal(JSON.stringify(getDay(out, 0)), JSON.stringify(getDay(draft, 0)));
  assert.equal(JSON.stringify(getDay(out, HOLIDAY)), JSON.stringify(getDay(draft, HOLIDAY)));
});

test("copy does not carry the automatic bands", () => {
  const draft = setDay(draftFromServer(server()), HOLIDAY, [
    { key: "a", start: "09:00", end: "12:00", mode: "heat", temperature: 19, preset: null, auto: false },
    { key: "z", start: "12:00", end: "24:00", mode: "off", temperature: null, preset: null, auto: true },
  ]);
  assert.equal(getDay(copyDay(draft, HOLIDAY, [2]), 2).length, 1);
});

test("copy choices: the source is never a target; the holiday is offered next to the days", () => {
  assert.deepEqual(copyTargetIds(2), [0, 1, 3, 4, 5, 6, HOLIDAY]);
  assert.deepEqual(copyTargetIds(HOLIDAY), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(quickTargets("weekdays", 2), [0, 1, 3, 4]);
  assert.deepEqual(quickTargets("weekend", 5), [6]);
  assert.deepEqual(quickTargets("all", 2), [0, 1, 3, 4, 5, 6], "the holiday stays a choice of its own");
  assert.deepEqual(quickTargets("all", HOLIDAY), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(quickTargets("weekdays", HOLIDAY), [0, 1, 2, 3, 4]);
  assert.deepEqual(quickTargets("none", 1), []);
});

// ---- 3. saving, draft, equality ----------------------------------------------------------------

test("saveRequest sends the holiday part without auto bands or keys, in order", () => {
  const draft = setDay(draftFromServer(server()), HOLIDAY, [
    { key: "z", start: "12:00", end: "24:00", mode: "off", temperature: null, preset: null, auto: true },
    { key: "b", start: "15:00", end: "16:00", mode: "cool", temperature: "24", preset: "", auto: false },
    { key: "a", start: "09:00", end: "12:00", mode: "heat", temperature: 19, preset: "eco", auto: false },
  ]);
  const req = saveRequest(draft, { id: "p1", name: "Casa" });
  assert.deepEqual(req.holiday, [
    { start: "09:00", end: "12:00", mode: "heat", temperature: 19, preset: "eco" },
    { start: "15:00", end: "16:00", mode: "cool", temperature: 24 },
  ]);
  assert.equal(req.expectedRevision, "r1");
});

test("saveProgram puts the holiday part in the message and drops auto bands there too", async () => {
  const hass = makeHass({ ws: { "cronotermostato/save_program": { program_id: "p1", revision: "r2" } } });
  await saveProgram(hass, { programId: "p1", name: "Casa", week: [[], [], [], [], [], [], []], holiday: [sband("09:00", "12:00"), { start: "12:00", end: "24:00", mode: "off", auto: true }], expectedRevision: "r1" });
  assert.deepEqual(hass.wsCalls[0].holiday, [sband("09:00", "12:00")]);
});

test("previewDay of the holiday part sends the same message as for a day (the server normalizes both alike)", async () => {
  const hass = makeHass({ ws: { "cronotermostato/preview_day": { bands: [] } } });
  const bands = [{ key: "a", start: "09:00", end: "12:00", mode: "heat", temperature: 19, preset: null, auto: false }, { key: "z", start: "12:00", end: "24:00", mode: "off", auto: true }];
  await previewDay(hass, bands);
  assert.deepEqual(hass.wsCalls[0], { type: "cronotermostato/preview_day", bands: [{ start: "09:00", end: "12:00", mode: "heat", temperature: 19 }] });
});

test("the draft and programsEqual take the holiday part into account", () => {
  const s = server();
  const draft = draftFromServer(s);
  const original = deserializeProgram(s);
  assert.equal(isDirty(draft, original), false);
  const changed = setDay(draft, HOLIDAY, []);
  assert.equal(isDirty(changed, original), true);
  assert.equal(programsEqual(deserializeProgram(s), deserializeProgram({ ...s, holiday: [] })), false);
  const same = setDay(draft, 3, []);
  assert.equal(isDirty(same, original), false);
});

// ---- 4. country, subdivision and the link ---------------------------------------------------------

test("the name of the country comes from the language of HA; the code is the fallback", () => {
  assert.equal(locationLabel("IT", null, "it").country, "Italia");
  assert.equal(locationLabel("IT", null, "en").country, "Italy");
  assert.equal(locationLabel("IT", "RM", "it").text, "Italia (RM)");
  assert.equal(locationLabel("ZZ", null, "it").country, "ZZ", "unknown to Intl");
  assert.equal(locationLabel("XK", null, "en").country.length > 0, true);
  assert.equal(locationLabel("it", null, "it").country, "Italia", "lowercase code");
  assert.equal(locationLabel("IT", null, "xx-invalid-").country, "Italy", "a language Intl does not know falls back to English");
});

test("no country configured is told apart", () => {
  for (const v of [null, undefined, "", "  ", 5]) assert.equal(locationLabel(v, null, "it"), null);
});

test("a name with markup stays text: it is a bound value, never part of the template", async () => {
  const { CronoHoliday } = await import(`${FE}/components/crono-holiday.js`);
  const el = new CronoHoliday();
  el.hass = { language: "it" };
  el.country = '<img src=x onerror="alert(1)">';
  el.subdiv = '"><script>alert(2)</script>';
  const flat = flatten(el.render());
  const text = flat.values.filter((v) => typeof v === "string");
  assert.ok(text.some((v) => v.includes("<img src=x")), "the code is shown as typed");
  assert.ok(text.some((v) => v.includes("<script>")));
  assert.doesNotMatch(flat.strings.join(""), /onerror|<img|<script/);
});

test("the holiday box: country text, the note, a link to the options page; no country gives its own message", async () => {
  const { CronoHoliday } = await import(`${FE}/components/crono-holiday.js`);
  const el = new CronoHoliday();
  el.hass = { language: "it" };
  el.country = "IT";
  el.subdiv = null;
  let flat = flatten(el.render());
  assert.ok(flat.values.includes("Festività: Italia"));
  assert.ok(flat.values.includes(it["band.holiday_note"]));
  assert.ok(flat.values.includes(integrationPath));
  assert.match(integrationPath, /^\/config\/integrations\/integration\/cronotermostato$/);
  el.country = null;
  flat = flatten(el.render());
  assert.ok(flat.values.includes(it["band.country_none"]));
  assert.ok(!flat.values.includes("Festività: Italia"));
  assert.ok(flat.values.includes(integrationPath), "the link is there to set it");
});

test("the link: a plain left click navigates inside HA, modified clicks and unsaved edits keep the browser's way", () => {
  const click = (extra = {}) => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...extra });
  assert.equal(shouldHandleClick(click(), false), true);
  assert.equal(shouldHandleClick(click({ ctrlKey: true }), false), false);
  assert.equal(shouldHandleClick(click({ metaKey: true }), false), false);
  assert.equal(shouldHandleClick(click({ shiftKey: true }), false), false);
  assert.equal(shouldHandleClick(click({ button: 1 }), false), false);
  assert.equal(shouldHandleClick(click(), true), false, "unsaved edits: a new tab, so they are not lost");
});

// ---- 5. texts, week strips, editor ---------------------------------------------------------------

test("the new texts exist in both languages with the same placeholders, and the placeholder is gone", () => {
  for (const key of ["band.country_none", "band.country_options", "band.copy_holiday", "day.title_holiday", "day.bar_holiday", "day.empty_holiday", "copy.title_holiday", "copy.body_holiday"]) {
    assert.ok(key in it && key in en, key);
    assert.deepEqual(it[key].match(/\{\w+\}/g) ?? [], en[key].match(/\{\w+\}/g) ?? [], key);
  }
  assert.ok(!("editor.soon_holiday" in it) && !("editor.soon_holiday" in en));
});

test("the week strips show the holiday as the last row, selectable like a day", async () => {
  const { CronoWeekTabs } = await import(`${FE}/components/crono-week-tabs.js`);
  const tabs = new CronoWeekTabs();
  tabs.hass = { language: "it" };
  tabs.selected = HOLIDAY;
  const row = (id, label) => ({ id, label, full: label, rows: [], count: 1, errorCount: 0 });
  tabs.days = [row(0, "Lun"), { ...row(HOLIDAY, "Festivi"), holiday: true, rows: [{ start: "09:00", end: "12:00", mode: "heat", auto: false }] }];
  const flat = flatten(tabs.render());
  assert.ok(flat.values.includes("true"), "aria-pressed on the holiday row");
  assert.ok(flat.values.includes("Festivi"));
  let chosen = null;
  tabs.dispatchEvent = (event) => (chosen = event.detail.day);
  tabs._choose(HOLIDAY);
  assert.equal(chosen, HOLIDAY);
});

test("the editor has no holiday placeholder any more and uses the holiday component", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL(`${FE}/components/crono-editor.js`, import.meta.url), "utf8");
  assert.doesNotMatch(src, /soon_holiday/);
  assert.match(src, /crono-holiday/);
});
