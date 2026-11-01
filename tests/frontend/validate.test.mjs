import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateDay, validateProgram } from "../../custom_components/cronotermostato/frontend/lib/validate.js";
import { buildProgram } from "./helpers.mjs";

const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));

test("shared cases give the same outcome as the server", () => {
  assert.ok(cases.length > 40);
  for (const c of cases) {
    const errors = validateProgram(buildProgram(c));
    const outcome = errors.length ? errors[0].code : "valid";
    assert.equal(outcome, c.expect, c.name);
  }
});

const band = (start, end, mode = "heat", temperature = 20, extra = {}) => ({ start, end, mode, temperature, ...extra });

test("errors carry the band index and the field", () => {
  const errors = validateDay([band("08:00", "12:00"), band("11:00", "13:00"), band("14:00", "13:00")]);
  const overlap = errors.find((e) => e.code === "overlap");
  assert.equal(overlap.index, 1);
  const reversed = errors.find((e) => e.code === "end_before_start");
  assert.equal(reversed.index, 2);
  assert.equal(reversed.field, "end");
});

test("setting errors name the field", () => {
  assert.equal(validateDay([band("08:00", "12:00", "heat", null)])[0].field, "temperature");
  assert.equal(validateDay([band("08:00", "12:00", "off", 18)])[0].field, "temperature");
  assert.equal(validateDay([band("08:00", "12:00", "auto")])[0].field, "mode");
  assert.equal(validateDay([band("7:00", "12:00")])[0].field, "start");
});

test("validateDay does not mutate its input", () => {
  const day = [band("12:00", "18:00"), band("08:00", "12:00")];
  const copy = JSON.parse(JSON.stringify(day));
  validateDay(day);
  assert.deepEqual(day, copy);
});

test("validateProgram ignores automatic bands", () => {
  const program = buildProgram({ day: [band("08:00", "12:00")] });
  program.week[0].push({ start: "10:00", end: "24:00", mode: "off", temperature: null, auto: true });
  assert.deepEqual(validateProgram(program), []);
});

test("validateProgram locates the day", () => {
  const program = buildProgram({ day: [], day3: [band("08:00", "12:00", "heat", null)] });
  const [err] = validateProgram(program);
  assert.equal(err.code, "missing_setting");
  assert.equal(err.where, "week");
  assert.equal(err.day, 3);
  const holiday = buildProgram({ day: [], holiday: [band("08:00", "12:00", "heat", null)] });
  assert.equal(validateProgram(holiday)[0].where, "holiday");
});
