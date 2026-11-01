// Validation of bands and programs, with the same rules as the server
// (engine/models.py: validate_bands, validate_setting, program_from_dict).
// The server stays the authority; tests/frontend/cases.json keeps the two in
// step. Pure module: no DOM, no window.
//
// It validates the *serialized* form (what is sent to the server): a band is
// {start, end, mode, temperature?, preset?, auto?}. Run serializeBand first on
// editor drafts (it turns empty fields into missing ones).
//
// Errors are {code, where, day, index, field}:
//   code: bad_time, end_before_start, overlap, bad_mode, missing_setting,
//         off_with_setting, bad_temperature, bad_preset, bad_band, bad_program
//   where: "week" | "holiday" | "program"; day: 0..6 for "week", else null;
//   index: band index in the list given (or null); field: the field at fault.

import { MINUTES_PER_DAY, parseTime } from "./time.js";

export const MODES = ["heat", "cool", "off"];
export const DAYS_PER_WEEK = 7;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isBlank = (value) => typeof value !== "string" || value.trim() === "";

function error(code, index, field, extra = {}) {
  return { code, where: "program", day: null, index, field, ...extra };
}

/** Errors of a (mode, temperature, preset) triple, as in validate_setting. */
function settingErrors(band, index) {
  const { mode, temperature, preset } = band;
  if (typeof mode !== "string" || !MODES.includes(mode)) {
    return [error("bad_mode", index, "mode")];
  }
  if (preset != null && isBlank(preset)) {
    return [error("bad_preset", index, "preset")];
  }
  if (mode === "off") {
    if (temperature != null) return [error("off_with_setting", index, "temperature")];
    if (preset != null) return [error("off_with_setting", index, "preset")];
    return [];
  }
  if (temperature == null) {
    return preset == null ? [error("missing_setting", index, "temperature")] : [];
  }
  if (typeof temperature !== "number" || !Number.isFinite(temperature)) {
    return [error("bad_temperature", index, "temperature")];
  }
  return [];
}

/**
 * Errors of one band, in the order of the server (``_band_from_dict`` then
 * ``_validate_band``), which is the order of "first error" that the shared
 * cases fix. `parse` errors are those of reading the band (the server raises
 * them for every band of the day before it checks any band); `check` errors
 * come after, and `range` is [start, end] when the band is valid on its own.
 */
function bandErrors(band, index) {
  if (!isObject(band)) return { parse: [error("bad_band", index, null)], check: [], range: null };
  if (band.auto !== undefined && typeof band.auto !== "boolean") {
    return { parse: [error("bad_band", index, "auto")], check: [], range: null };
  }
  // start, end, mode are read in this order: a missing one is a bad band, an
  // invalid time is a bad time, and the first problem found stops the reading.
  const times = {};
  for (const field of ["start", "end"]) {
    if (band[field] === undefined) return { parse: [error("bad_band", index, field)], check: [], range: null };
    times[field] = parseTime(band[field], { asEnd: true, strict: true });
    if (times[field] === null) return { parse: [error("bad_time", index, field)], check: [], range: null };
  }
  if (band.mode === undefined) return { parse: [error("bad_band", index, "mode")], check: [], range: null };
  const { start, end } = times;
  const check = [];
  let range = null;
  if (start >= MINUTES_PER_DAY) check.push(error("bad_time", index, "start"));
  else if (end <= 0) check.push(error("bad_time", index, "end"));
  else if (end <= start) check.push(error("end_before_start", index, "end"));
  else range = [start, end];
  if (check.length === 0) check.push(...settingErrors(band, index));
  return { parse: [], check, range: check.length === 0 ? range : null };
}

/** Errors of the bands of one day (an array of serialized bands). */
export function validateDay(bands) {
  if (!Array.isArray(bands)) return [error("bad_band", null, null)];
  const results = bands.map((band, index) => bandErrors(band, index));
  const errors = [...results.flatMap((r) => r.parse), ...results.flatMap((r) => r.check)];
  const ranges = [];
  results.forEach((result, index) => {
    if (result.range) ranges.push({ index, start: result.range[0], end: result.range[1] });
  });
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start < ranges[i - 1].end) errors.push(error("overlap", ranges[i].index, "start"));
  }
  return errors;
}

function located(errors, where, day) {
  return errors.map((e) => ({ ...e, where, day }));
}

/**
 * Errors of a whole program {name, week: [7 days], holiday}. Automatic bands
 * (`auto: true`) are computed by the server and ignored here.
 */
export function validateProgram(program) {
  if (!isObject(program)) return [error("bad_program", null, null)];
  const errors = [];
  if (isBlank(program.name)) errors.push(error("bad_program", null, "name"));
  const week = program.week;
  if (!Array.isArray(week) || week.length !== DAYS_PER_WEEK) {
    errors.push(error("bad_program", null, "week"));
  } else {
    week.forEach((day, i) => errors.push(...located(validateDay(userBands(day)), "week", i)));
  }
  // Like the server, a holiday part that is not a list is a bad band list.
  errors.push(...located(validateDay(userBands(program.holiday)), "holiday", null));
  return errors;
}

function userBands(day) {
  return Array.isArray(day) ? day.filter((band) => !(isObject(band) && band.auto === true)) : day;
}
