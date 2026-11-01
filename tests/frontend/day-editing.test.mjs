import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { flush } from "./fake-hass.mjs";
import { emptyProgram, programsEqual, serializeProgram, deserializeProgram } from "../../custom_components/cronotermostato/frontend/lib/model.js";
import {
  HOLIDAY,
  draftFromServer,
  getDay,
  setDay,
  addBand,
  patchBand,
  removeBand,
  adoptAutoBand,
  copyDay,
  programErrors,
  isDirty,
  saveRequest,
  normalizeTime,
  stripSegments,
  minutesToPercent,
  segmentDetail,
  mergeDay,
  presetOptions,
  presetIsKnown,
  temperatureStep,
  stepTemperature,
  createPreviewer,
  roomWarnings,
} from "../../custom_components/cronotermostato/frontend/lib/day-editing.js";

const band = (start, end, mode = "heat", temperature = 20, preset = null, extra = {}) => ({ start, end, mode, temperature, preset, auto: false, ...extra });
const keys = (bands) => bands.map((b) => b.key);

test("a new band after the last one starts where the previous one ends and runs to 24:00", () => {
  const { bands, key } = addBand([band("06:00", "08:00", "heat", 21), band("08:00", "12:00", "heat", 19)]);
  const added = bands.find((b) => b.key === key);
  assert.equal(added.start, "12:00");
  assert.equal(added.end, "24:00");
  assert.equal(added.mode, "heat");
  assert.equal(added.auto, false);
  assert.equal(bands.length, 3);
});

test("a new band on an empty day covers the whole day", () => {
  const { bands, key } = addBand([]);
  assert.deepEqual([bands[0].start, bands[0].end], ["00:00", "24:00"]);
  assert.equal(bands[0].key, key);
});

test("24:00 is proposed as end only for the last band: a gap in the middle ends where the next band starts", () => {
  // 00:00-06:00 and 09:00-24:00 exist: the only gap is 06:00-09:00
  const { bands, key } = addBand([band("00:00", "06:00"), band("09:00", "24:00")]);
  const added = bands.find((b) => b.key === key);
  assert.deepEqual([added.start, added.end], ["06:00", "09:00"]);
});

test("no gap left: nothing to add", () => {
  assert.equal(addBand([band("00:00", "24:00")]), null);
  assert.equal(addBand([band("00:00", "12:00"), band("12:00", "24:00")]), null);
});

test("a new band copies the temperature of the last heating band, 20 otherwise", () => {
  const a = addBand([band("00:00", "06:00", "cool", 25.5)]);
  assert.equal(a.bands.find((b) => b.key === a.key).temperature, 25.5);
  assert.equal(addBand([band("00:00", "06:00", "off", null, null)]).bands[1].temperature, 20);
});

test("auto bands are ignored when adding", () => {
  const { bands, key } = addBand([band("00:00", "06:00", "off", null, null, { auto: true })]);
  const added = bands.find((b) => b.key === key);
  assert.deepEqual([added.start, added.end], ["00:00", "24:00"]);
});

test("editing the end of a band so that it overlaps the next gives `overlap` on the second", () => {
  const program = { ...emptyProgram("P"), id: "p" };
  program.week[0] = addBand([band("06:00", "08:00"), band("08:00", "12:00")]).bands.slice(0, 2).map((b, i) => ({ ...b, key: `k${i}` }));
  const edited = setDay(program, 0, patchBand(getDay(program, 0), "k0", { end: "09:00" }));
  const { byKey, summary } = programErrors(edited);
  assert.deepEqual(byKey.get("k1").map((e) => [e.code, e.field]), [["overlap", "start"]]);
  assert.equal(byKey.has("k0"), false);
  assert.deepEqual(summary.map((e) => [e.day, e.code]), [[0, "overlap"]]);
});

test("a one-minute overlap is an error, adjacent bands are not", () => {
  const p = { ...emptyProgram("P"), week: [[{ ...band("08:00", "12:00"), key: "a" }, { ...band("12:00", "13:00"), key: "b" }], [], [], [], [], [], []] };
  assert.equal(programErrors(p).summary.length, 0);
  const q = setDay(p, 0, patchBand(getDay(p, 0), "b", { start: "11:59" }));
  assert.equal(programErrors(q).byKey.get("b")[0].code, "overlap");
});

test("a band ending at 24:00 and the same start on the next day are not an error", () => {
  const p = { ...emptyProgram("P"), week: [[{ ...band("20:00", "24:00"), key: "a" }], [{ ...band("00:00", "08:00"), key: "b" }], [], [], [], [], []] };
  assert.equal(programErrors(p).summary.length, 0);
});

test("errors are found for the holiday part too, and for unsorted bands", () => {
  const p = { ...emptyProgram("P"), holiday: [{ ...band("10:00", "12:00"), key: "late" }, { ...band("09:00", "11:00"), key: "early" }] };
  const { byKey, summary } = programErrors(p);
  assert.equal(byKey.get("late")[0].code, "overlap");
  assert.equal(summary[0].day, HOLIDAY);
});

test("errors keep the key of the band, wrong time and end before start", () => {
  const p = { ...emptyProgram("P"), week: [[{ ...band("25:00", "12:00"), key: "x" }, { ...band("10:00", "09:00"), key: "y" }], [], [], [], [], [], []] };
  const { byKey } = programErrors(p);
  assert.equal(byKey.get("x")[0].code, "bad_time");
  assert.equal(byKey.get("y")[0].code, "end_before_start");
});

test("the serializer never sends auto bands and drops the editor keys", () => {
  const p = { ...emptyProgram("P"), week: [[{ ...band("00:00", "08:00", "off", null, null, { auto: true }), key: "a" }, { ...band("08:00", "12:00"), key: "b" }], [], [], [], [], [], []] };
  const request = saveRequest(p, { name: "P", revision: "r1", id: "p" });
  assert.equal(request.week[0].length, 1);
  assert.deepEqual(Object.keys(request.week[0][0]).sort(), ["end", "mode", "start", "temperature"]);
  assert.equal(JSON.stringify(request).includes("auto"), false);
  assert.equal(JSON.stringify(request).includes('"key"'), false);
});

test("the save request carries the program id, the current name and the revision it started from", () => {
  const draft = { ...draftFromServer({ program_id: "p", name: "Old", revision: "r1", week: [[], [], [], [], [], [], []], holiday: [] }) };
  const request = saveRequest(draft, { name: "New name", id: "p", revision: "r2" });
  assert.equal(request.programId, "p");
  assert.equal(request.name, "New name");
  assert.equal(request.expectedRevision, "r1");
});

test("changing the mode to off clears temperature and preset", () => {
  const bands = [{ ...band("08:00", "12:00", "heat", 21, "eco"), key: "a" }];
  const [b] = patchBand(bands, "a", { mode: "off" });
  assert.equal(b.mode, "off");
  assert.equal(b.temperature, null);
  assert.equal(b.preset, null);
});

test("from off to heat the band needs a temperature or a preset", () => {
  const p = { ...emptyProgram("P"), week: [[{ ...band("08:00", "12:00", "off", null), key: "a" }], [], [], [], [], [], []] };
  assert.equal(programErrors(p).summary.length, 0);
  const heat = setDay(p, 0, patchBand(getDay(p, 0), "a", { mode: "heat" }));
  assert.equal(programErrors(heat).byKey.get("a")[0].code, "missing_setting");
  const withTemp = setDay(heat, 0, patchBand(getDay(heat, 0), "a", { temperature: "21.5" }));
  assert.equal(programErrors(withTemp).summary.length, 0);
  const withPreset = setDay(heat, 0, patchBand(getDay(heat, 0), "a", { preset: "eco" }));
  assert.equal(programErrors(withPreset).summary.length, 0);
});

test("a temperature typed as text that is not a number is flagged", () => {
  const p = { ...emptyProgram("P"), week: [[{ ...band("08:00", "12:00", "heat", "abc"), key: "a" }], [], [], [], [], [], []] };
  assert.equal(programErrors(p).byKey.get("a")[0].code, "bad_temperature");
});

test("removing a band", () => {
  assert.deepEqual(keys(removeBand([{ key: "a" }, { key: "b" }], "a")), ["b"]);
});

test("changing an automatic band makes it a user band", () => {
  const auto = band("00:00", "06:30", "off", null, null, { auto: true });
  const { bands, key } = adoptAutoBand([{ ...band("06:30", "08:00"), key: "u" }], auto);
  const adopted = bands.find((b) => b.key === key);
  assert.equal(adopted.auto, false);
  assert.deepEqual([adopted.start, adopted.end, adopted.mode], ["00:00", "06:30", "off"]);
  const [again] = patchBand(bands, key, { mode: "heat", temperature: "18" }).filter((b) => b.key === key);
  assert.equal(again.auto, false);
  // and a patch on any band clears the auto flag
  assert.equal(patchBand([{ ...auto, key: "z" }], "z", { start: "01:00" })[0].auto, false);
});

test("programsEqual: a draft against the original", () => {
  const server = { program_id: "p", name: "P", revision: "r", week: [[{ start: "08:00", end: "12:00", mode: "heat", temperature: 21 }], [], [], [], [], [], []], holiday: [] };
  const original = deserializeProgram(server);
  const draft = draftFromServer(server);
  assert.equal(isDirty(draft, original), false);
  const changed = setDay(draft, 0, patchBand(getDay(draft, 0), getDay(draft, 0)[0].key, { temperature: "21.5" }));
  assert.equal(isDirty(changed, original), true);
  assert.equal(programsEqual(changed, original), false);
  const back = setDay(changed, 0, patchBand(getDay(changed, 0), getDay(changed, 0)[0].key, { temperature: 21 }));
  assert.equal(isDirty(back, original), false);
  // an empty text and no temperature are the same thing for the server
  assert.equal(isDirty(setDay(draft, 1, [{ ...band("00:00", "01:00", "off", null), key: "n", temperature: "" }]), original), true);
});

test("the auto bands of the server are not part of the draft", () => {
  const server = { program_id: "p", name: "P", revision: "r", week: [[{ start: "08:00", end: "12:00", mode: "heat", temperature: 21, auto: true }], [], [], [], [], [], []], holiday: [] };
  assert.equal(draftFromServer(server).week[0].length, 0);
});

test("copy a day onto other days replaces their bands, with new keys, and leaves the source", () => {
  const p = { ...emptyProgram("P") };
  p.week[0] = [{ ...band("06:00", "08:00"), key: "a" }, { ...band("08:00", "24:00", "off", null), key: "b", auto: true }];
  p.week[2] = [{ ...band("10:00", "11:00"), key: "old" }];
  const q = copyDay(p, 0, [1, 2, 3, 4]);
  for (const d of [1, 2, 3, 4]) {
    assert.deepEqual(getDay(q, d).map((b) => [b.start, b.end]), [["06:00", "08:00"]]);
  }
  assert.deepEqual(getDay(q, 5), []);
  assert.deepEqual(keys(getDay(q, 0)), ["a", "b"]);
  const all = [1, 2, 3, 4].flatMap((d) => keys(getDay(q, d)));
  assert.equal(new Set([...all, "a"]).size, 5);
  assert.equal(p.week[2][0].key, "old", "the input is not changed");
});

test("copy a day to the holiday part and from it; copying onto itself is ignored", () => {
  const p = emptyProgram("P");
  p.week[6] = [{ ...band("09:00", "23:00"), key: "s" }];
  const q = copyDay(p, 6, [HOLIDAY, 6]);
  assert.equal(getDay(q, HOLIDAY).length, 1);
  assert.deepEqual(keys(getDay(q, 6)), ["s"]);
  const r = copyDay(q, HOLIDAY, [0]);
  assert.equal(getDay(r, 0)[0].start, "09:00");
});

test("normalizeTime accepts what people type", () => {
  assert.equal(normalizeTime("8:00"), "08:00");
  assert.equal(normalizeTime(" 0800 "), "08:00");
  assert.equal(normalizeTime("800"), "08:00");
  assert.equal(normalizeTime("8"), "08:00");
  assert.equal(normalizeTime("22.30"), "22:30");
  assert.equal(normalizeTime("24:00"), "24:00");
  assert.equal(normalizeTime("24"), "24:00");
  assert.equal(normalizeTime("25:00"), "25:00", "kept as typed: validation flags it");
  assert.equal(normalizeTime("abc"), "abc");
  assert.equal(normalizeTime(""), "");
});

test("minutes to percent for the bar", () => {
  assert.equal(minutesToPercent(0), 0);
  assert.equal(minutesToPercent(720), 50);
  assert.equal(minutesToPercent(1440), 100);
  assert.throws(() => minutesToPercent(-1), RangeError);
  assert.throws(() => minutesToPercent(1441), RangeError);
});

test("segments of the bar: position and width, a band that ends at 24:00, a one-minute band", () => {
  const segs = stripSegments([band("06:00", "12:00"), band("23:00", "24:00"), band("12:00", "12:01")]);
  assert.deepEqual(segs.map((s) => [s.left, s.width]), [[25, 25], [(1380 / 1440) * 100, (60 / 1440) * 100], [50, (1 / 1440) * 100]]);
  assert.ok(segs.every((s) => s.left + s.width <= 100 + 1e-9));
  assert.ok(Math.abs(segs[1].left + segs[1].width - 100) < 1e-9);
  assert.ok(segs[2].width > 0);
});

test("segments skip bands with unreadable times and keep the index of the band", () => {
  const segs = stripSegments([band("xx", "12:00"), band("10:00", "09:00"), band("08:00", "09:00")]);
  assert.deepEqual(segs.map((s) => s.index), [2]);
});

test("segmentDetail decides how much a segment of a given width in pixels can show", () => {
  assert.equal(segmentDetail(10), "none");
  assert.equal(segmentDetail(30), "icon");
  assert.equal(segmentDetail(60), "temperature");
  assert.equal(segmentDetail(100), "preset");
  assert.equal(segmentDetail(200), "full");
  assert.ok(["none", "icon", "temperature", "preset", "full"].includes(segmentDetail(0)));
});

test("sorting: the display rows are ordered by start and keep the order of equal starts", () => {
  const rows = mergeDay([band("12:00", "13:00", "heat", 20, null, { key: "c" }), band("06:00", "08:00", "heat", 20, null, { key: "a" })], null);
  assert.deepEqual(rows.map((r) => r.key), ["a", "c"]);
});

test("mergeDay adds the automatic bands of the preview that do not overlap a user band", () => {
  const user = [band("06:00", "08:00", "heat", 21, null, { key: "a" })];
  const preview = [
    band("00:00", "06:00", "off", null, null, { auto: true }),
    band("06:00", "08:00"),
    band("08:00", "24:00", "off", null, null, { auto: true }),
  ];
  const rows = mergeDay(user, preview);
  assert.deepEqual(rows.map((r) => [r.start, r.end, r.auto]), [["00:00", "06:00", true], ["06:00", "08:00", false], ["08:00", "24:00", true]]);
  // the user just added a band over the old auto one: the stale auto band is not shown
  const moved = mergeDay([band("07:00", "10:00", "heat", 21, null, { key: "a" })], preview);
  assert.deepEqual(moved.map((r) => [r.start, r.end, r.auto]), [["00:00", "06:00", true], ["07:00", "10:00", false]]);
  assert.deepEqual(mergeDay(user, null).map((r) => r.auto), [false]);
});

test("preset options are the union of the presets of the assigned rooms; a free one is flagged", () => {
  const rooms = [{ presetModes: ["eco", "home"] }, { presetModes: ["home", "away"] }];
  assert.deepEqual(presetOptions(rooms), ["away", "eco", "home"]);
  assert.deepEqual(presetOptions([]), []);
  assert.equal(presetIsKnown("eco", ["eco"]), true);
  assert.equal(presetIsKnown("comfort", ["eco"]), false);
  assert.equal(presetIsKnown("", ["eco"]), true);
  assert.equal(presetIsKnown(null, ["eco"]), true);
});

test("temperature step: that of the only assigned room, else 0.5", () => {
  assert.equal(temperatureStep([{ step: 0.1 }]), 0.1);
  assert.equal(temperatureStep([{ step: 1 }, { step: 0.5 }]), 0.5);
  assert.equal(temperatureStep([]), 0.5);
  assert.equal(temperatureStep([{ step: 0 }]), 0.5);
  assert.equal(temperatureStep([{ step: "x" }]), 0.5);
});

test("stepTemperature moves by the step without float noise and starts from 20 when empty", () => {
  assert.equal(stepTemperature(20, 0.1, 1), 20.1);
  assert.equal(stepTemperature("20.3", 0.1, 1), 20.4);
  assert.equal(stepTemperature(21, 0.5, -1), 20.5);
  assert.equal(stepTemperature("", 0.5, 1), 20.5);
  assert.equal(stepTemperature(null, 1, -1), 19);
  assert.equal(stepTemperature("abc", 0.5, 1), 20.5);
});

test("the previewer waits, asks once for a burst and ignores answers that arrived late", async () => {
  const calls = [];
  const results = [];
  let release;
  const preview = (bands) => {
    calls.push(bands);
    if (calls.length === 1) return new Promise((resolve) => (release = () => resolve([{ tag: "old" }])));
    return Promise.resolve([{ tag: "new" }]);
  };
  const p = createPreviewer({ preview, delay: 5, onResult: (day, bands) => results.push([day, bands]), onError: () => results.push("error") });
  p.schedule(0, [1]);
  p.schedule(0, [2]);
  p.schedule(0, [3]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [3]);
  p.schedule(0, [4]); // asks again while the first answer has not come
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 2);
  release();
  await flush();
  assert.deepEqual(results, [[0, [{ tag: "new" }]]]);
  p.stop();
});

test("the previewer reports a failure and can be cancelled for a day", async () => {
  const errors = [];
  const p = createPreviewer({ preview: async () => { throw new Error("boom"); }, delay: 5, onResult: () => assert.fail("no result"), onError: (day, err) => errors.push([day, err.message]) });
  p.schedule(HOLIDAY, []);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(errors, [[HOLIDAY, "boom"]]);
  const q = createPreviewer({ preview: async () => assert.fail("not asked"), delay: 5, onResult: () => {}, onError: () => {} });
  q.schedule(1, []);
  q.cancel(1);
  await new Promise((r) => setTimeout(r, 20));
  q.stop();
});

test("roomWarnings: compatibility issues of the assigned rooms, grouped, never errors", () => {
  const draft = { ...emptyProgram("P") };
  draft.week[0] = [{ ...band("06:00", "08:00", "heat", 30, "eco"), key: "a" }];
  draft.week[1] = [{ ...band("06:00", "08:00", "heat", 20, "home"), key: "b" }];
  draft.week[2] = [{ ...band("06:00", "08:00", "heat", 30, "home"), key: "c" }]; // the preset is reported first, as the controller does
  const room = { id: "climate.k", name: "<b>Kitchen</b>", available: true, hvacModes: ["heat"], presetModes: ["eco"], minTemp: 5, maxTemp: 25, step: 0.5 };
  const out = roomWarnings(draft, null, [room]);
  assert.equal(out.length, 1);
  assert.equal(out[0].room.name, "<b>Kitchen</b>");
  const codes = out[0].items.map((i) => i.code).sort();
  assert.deepEqual(codes, ["out_of_range", "unsupported_preset"]);
  assert.deepEqual(out[0].items.find((i) => i.code === "out_of_range").days, [0]);
  assert.deepEqual(out[0].items.find((i) => i.code === "unsupported_preset").days, [1, 2]);
  assert.deepEqual(roomWarnings(draft, null, []), []);
});

test("hostile text stays text: names, presets and rooms are never interpreted", () => {
  const evil = '<img src=x onerror=alert(1)>';
  const p = { ...emptyProgram(evil), week: [[{ ...band("08:00", "12:00", "heat", 21, evil), key: "a" }], [], [], [], [], [], []] };
  const request = saveRequest(p, { name: evil, id: "p", revision: "r" });
  assert.equal(request.name, evil);
  assert.equal(request.week[0][0].preset, evil);
  assert.deepEqual(presetOptions([{ presetModes: [evil] }]), [evil]);
  assert.equal(presetIsKnown(evil, []), false);
  assert.equal(programErrors(p).summary.length, 0);
});

test("day names: capital letter, long and short, Monday first", async () => {
  const { dayLabel } = await import("../../custom_components/cronotermostato/frontend/lib/day-editing.js");
  assert.equal(dayLabel(0, "it"), "Lunedì");
  assert.equal(dayLabel(6, "it"), "Domenica");
  assert.equal(dayLabel(0, "en", "short"), "Mon");
  assert.throws(() => dayLabel(7), RangeError);
});

// ---- Rendering of hostile text: only ever bound values, never markup ------------------------

const EVIL = '<img src=x onerror=alert(1)>"><script>alert(2)</script>';

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

// The only directives the components use: live (property binding), repeat, styleMap. None of them parses markup.
const { live, repeat, styleMap } = await import("../../custom_components/cronotermostato/frontend/lit.js");
const SAFE_DIRECTIVES = new Set([live("x"), repeat([], (x) => x, () => ""), styleMap({})].map((d) => d._$litDirective$));

function assertOnlyText(flat, label) {
  const markup = flat.strings.join("");
  assert.ok(!markup.includes("<img") && !markup.includes("<script") && !markup.includes("onerror"), `${label}: static template has no user text`);
  for (const v of flat.values) {
    if (typeof v?._$litDirective$ === "function") assert.ok(SAFE_DIRECTIVES.has(v._$litDirective$), `${label}: only safe directives`);
  }
}

test("render: a free preset with markup is a bound value in the band row", async () => {
  const { CronoBandRow } = await import("../../custom_components/cronotermostato/frontend/components/crono-band-row.js");
  const row = new CronoBandRow();
  row.hass = { language: "it" };
  row.hasRooms = true;
  row.presets = [EVIL];
  row.band = { key: "a", start: "08:00", end: "12:00", mode: "heat", temperature: 21, preset: EVIL, auto: false };
  const flat = flatten(row.render());
  assertOnlyText(flat, "band row");
  assert.ok(flat.values.includes(EVIL), "the preset is a plain value");
});

test("render: the day and the week strips only bind texts", async () => {
  const { CronoDay } = await import("../../custom_components/cronotermostato/frontend/components/crono-day.js");
  const { CronoWeekTabs } = await import("../../custom_components/cronotermostato/frontend/components/crono-week-tabs.js");
  const rows = [{ key: "a", start: "08:00", end: "12:00", mode: "heat", temperature: 21, preset: EVIL, auto: false }];
  const day = new CronoDay();
  day.hass = { language: "en" };
  day.label = EVIL;
  day.rows = rows;
  const flatDay = flatten(day.render());
  assertOnlyText(flatDay, "day");
  assert.ok(flatDay.values.some((v) => typeof v === "string" && v.includes(EVIL)));
  const tabs = new CronoWeekTabs();
  tabs.hass = { language: "en" };
  tabs.days = [{ id: 0, label: EVIL, full: EVIL, rows, count: 1, errorCount: 0 }];
  assertOnlyText(flatten(tabs.render()), "week tabs");
});

test("render: room names and program names in warnings, errors and dialogs are text", async () => {
  const { CronoEditor } = await import("../../custom_components/cronotermostato/frontend/components/crono-editor.js");
  const { createT } = await import("../../custom_components/cronotermostato/frontend/lib/i18n.js");
  const editor = new CronoEditor();
  editor.hass = { language: "it" };
  const t = createT(editor.hass);
  const draft = { ...emptyProgram(EVIL), id: "p" };
  draft.week[0] = [{ ...band("06:00", "08:00", "heat", 30, EVIL), key: "a" }, { ...band("07:00", "09:00", "heat", 20, null), key: "b" }];
  const room = { id: "climate.x", name: EVIL, available: true, hvacModes: ["heat"], presetModes: ["eco"], minTemp: 5, maxTemp: 25, step: 0.5 };
  const warnings = flatten(editor._renderRoomWarnings(t, draft, [room], "it"));
  assertOnlyText(warnings, "room warnings");
  assert.ok(warnings.values.includes(EVIL) || warnings.values.some((v) => typeof v === "string" && v.includes(EVIL)));
  const { summary } = programErrors(draft);
  assert.ok(summary.length > 0);
  assertOnlyText(flatten(editor._renderErrors(t, draft, summary, "it")), "errors");
  assertOnlyText(flatten(editor._renderDialogs(t)), "dialogs");
});
