import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  emptyProgram, cloneProgram, stripAuto, serializeBand, serializeProgram,
  deserializeProgram, sortBands, programsEqual, dayName,
} from "../../custom_components/cronotermostato/frontend/lib/model.js";
import { validateProgram } from "../../custom_components/cronotermostato/frontend/lib/validate.js";

const serialization = JSON.parse(readFileSync(new URL("./serialization.json", import.meta.url)));

test("shared serialization cases", () => {
  for (const c of serialization) {
    const out = serializeProgram(c.draft);
    assert.deepEqual(out, c.expected, c.name);
    assert.deepEqual(validateProgram(out), [], c.name);
  }
});

test("emptyProgram has seven empty days and a holiday part", () => {
  const p = emptyProgram("Casa");
  assert.equal(p.name, "Casa");
  assert.equal(p.week.length, 7);
  assert.ok(p.week.every((d) => Array.isArray(d) && d.length === 0));
  assert.deepEqual(p.holiday, []);
  p.week[0].push({});
  assert.equal(p.week[1].length, 0);
});

test("cloneProgram is deep", () => {
  const p = emptyProgram("A");
  p.week[2].push({ start: "08:00", end: "09:00", mode: "off" });
  const c = cloneProgram(p);
  c.week[2][0].mode = "heat";
  assert.equal(p.week[2][0].mode, "off");
  assert.ok(programsEqual(p, cloneProgram(p)));
  assert.ok(!programsEqual(p, c));
});

test("stripAuto removes automatic bands from a week", () => {
  const week = emptyProgram("A").week;
  week[0] = [
    { start: "00:00", end: "08:00", mode: "off", auto: true },
    { start: "08:00", end: "12:00", mode: "heat", temperature: 20, auto: false },
    { start: "12:00", end: "24:00", mode: "off", auto: true },
  ];
  const out = stripAuto(week);
  assert.equal(out[0].length, 1);
  assert.equal(out[0][0].start, "08:00");
  assert.equal(week[0].length, 3);
  assert.equal(stripAuto(week[0]).length, 1);
});

test("serializeBand omits empty fields and keeps numbers", () => {
  assert.deepEqual(serializeBand({ start: "08:00", end: "09:00", mode: "heat", temperature: 20, preset: null, auto: false }),
    { start: "08:00", end: "09:00", mode: "heat", temperature: 20 });
  assert.deepEqual(serializeBand({ start: "08:00", end: "09:00", mode: "heat", temperature: "", preset: "eco" }),
    { start: "08:00", end: "09:00", mode: "heat", preset: "eco" });
  assert.deepEqual(serializeBand({ start: "08:00", end: "09:00", mode: "off", temperature: 5, preset: "x" }),
    { start: "08:00", end: "09:00", mode: "off" });
  assert.equal(serializeBand({ start: "a", end: "b", mode: "heat", temperature: "abc" }).temperature, "abc");
});

test("deserializeProgram uses user bands and keeps the revision", () => {
  const server = {
    program_id: "p1", name: "Casa", revision: "abc",
    week: [[{ start: "08:00", end: "12:00", mode: "heat", temperature: 20, auto: false, preset: null }], [], [], [], [], [], []],
    holiday: [],
    week_full: [[{ start: "00:00", end: "08:00", mode: "off", temperature: null, auto: true, preset: null }]],
    holiday_full: [],
  };
  const p = deserializeProgram(server);
  assert.equal(p.id, "p1");
  assert.equal(p.revision, "abc");
  assert.equal(p.week.length, 7);
  assert.equal(p.week[0].length, 1);
  assert.equal(p.week[0][0].auto, false);
  assert.deepEqual(validateProgram(p), []);
  assert.deepEqual(deserializeProgram({ id: "q", name: "N", week: server.week, holiday: [] }).id, "q");
});

test("program name with markup stays plain text", () => {
  const name = "<script>alert(1)</script>";
  const p = emptyProgram(name);
  assert.equal(p.name, name);
  assert.equal(serializeProgram(p).name, name);
  assert.equal(cloneProgram(p).name, name);
  assert.equal(deserializeProgram({ id: "x", name, week: p.week, holiday: [] }).name, name);
});

test("sortBands sorts by start without mutating", () => {
  const bands = [{ start: "12:00", end: "13:00" }, { start: "08:00", end: "09:00" }, { start: "8:30", end: "9:00" }];
  const sorted = sortBands(bands);
  assert.deepEqual(sorted.map((b) => b.start), ["08:00", "8:30", "12:00"]);
  assert.equal(bands[0].start, "12:00");
});

test("dayName has Monday at 0", () => {
  assert.equal(dayName(0, "en"), "Monday");
  assert.equal(dayName(6, "en"), "Sunday");
  assert.equal(dayName(0, "it"), "lunedì");
  assert.throws(() => dayName(7), RangeError);
});
