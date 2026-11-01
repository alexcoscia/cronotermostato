// Pure data helpers for programs (no DOM, no window).
// Client form of a program: {id, name, revision, week: [7 days], holiday}; a
// band is {start, end, mode, temperature, preset, auto}. Names are plain text.

import { parseTime } from "./time.js";
import { DAYS_PER_WEEK } from "./validate.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A new program with seven empty days and an empty holiday part. */
export function emptyProgram(name) {
  return {
    id: null,
    name,
    revision: null,
    week: Array.from({ length: DAYS_PER_WEEK }, () => []),
    holiday: [],
  };
}

export function cloneProgram(program) {
  return structuredClone(program);
}

const isAuto = (band) => isObject(band) && band.auto === true;

/** Remove the automatic bands from a week (array of days) or from one day. */
export function stripAuto(daysOrDay) {
  if (!Array.isArray(daysOrDay)) return daysOrDay;
  if (daysOrDay.some(Array.isArray) || daysOrDay.length === 0) {
    return daysOrDay.map((day) => (Array.isArray(day) ? day.filter((b) => !isAuto(b)) : day));
  }
  return daysOrDay.filter((b) => !isAuto(b));
}

/**
 * The band as the server wants it: no `auto`, no empty temperature/preset,
 * nothing at all besides start/end/mode for `off`, temperature as a number
 * (a text that is not a number is kept as is, so validation flags it).
 */
export function serializeBand(band) {
  const out = { start: band.start, end: band.end, mode: band.mode };
  if (band.mode === "off") return out;
  const { temperature, preset } = band;
  if (typeof temperature === "string") {
    const text = temperature.trim();
    if (text !== "") out.temperature = Number.isFinite(Number(text)) ? Number(text) : temperature;
  } else if (temperature !== null && temperature !== undefined) {
    out.temperature = temperature;
  }
  if (preset !== null && preset !== undefined && !(typeof preset === "string" && preset.trim() === "")) {
    out.preset = preset;
  }
  return out;
}

/** Bands sorted by start time (a copy; unparsable starts go last). */
export function sortBands(bands) {
  const key = (band) => parseTime(band.start, { asEnd: true }) ?? Infinity;
  return bands
    .map((band, i) => ({ band, i, k: key(band) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((entry) => entry.band);
}

const serializeDay = (day) => sortBands(stripAuto(day)).map(serializeBand);

/** The part of a program that is sent when saving: {name, week, holiday}. */
export function serializeProgram(program) {
  return {
    name: program.name,
    week: program.week.map(serializeDay),
    holiday: serializeDay(program.holiday),
  };
}

function bandFromServer(band) {
  return {
    start: band.start,
    end: band.end,
    mode: band.mode,
    temperature: band.temperature ?? null,
    preset: band.preset ?? null,
    auto: band.auto === true,
  };
}

/** Client program from a program of cronotermostato/state (user bands only). */
export function deserializeProgram(server) {
  return {
    id: server.program_id ?? server.id ?? null,
    name: server.name,
    revision: server.revision ?? null,
    week: server.week.map((day) => day.map(bandFromServer)),
    holiday: server.holiday.map(bandFromServer),
  };
}

/** True if two programs have the same name and content (for unsaved drafts). */
export function programsEqual(a, b) {
  return JSON.stringify(serializeProgram(a)) === JSON.stringify(serializeProgram(b));
}

/** Name of the day, 0 = Monday, in the given language. */
export function dayName(index, language = "en") {
  if (!Number.isInteger(index) || index < 0 || index >= DAYS_PER_WEEK) {
    throw new RangeError(`Invalid day: ${String(index)}`);
  }
  // 2024-01-01 was a Monday.
  const date = new Date(Date.UTC(2024, 0, 1 + index));
  return new Intl.DateTimeFormat(language, { weekday: "long", timeZone: "UTC" }).format(date);
}
