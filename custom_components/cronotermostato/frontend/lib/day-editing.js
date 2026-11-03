// Editing of the bands of a day, without DOM: the draft of a program, adding,
// changing and removing bands, copying a day, errors by band, the data of the
// 0-24 bar, the automatic bands of the preview and the compatibility notes for
// the assigned rooms. Everything is a pure function: it returns new objects and
// never touches its input. Texts that come from the user (names, presets) are
// only ever passed on as plain strings.
//
// Draft: the client form of model.js ({id, name, revision, week, holiday}) where
// every band also has a `key` (stable while the user edits, never sent to the
// server). The draft holds only the bands of the user; the automatic bands come
// from the preview of the server and are shown next to them (`mergeDay`).
// A day is identified by 0..6 (Monday..Sunday) or by HOLIDAY.

import { MINUTES_PER_DAY, parseTime, formatTime } from "./time.js";
import { validateDay, validateProgram } from "./validate.js";
import { deserializeProgram, programsEqual, serializeBand, serializeProgram, sortBands, stripAuto } from "./model.js";
import { roomIssues, DEFAULT_STEP } from "./climate.js";

export const HOLIDAY = "holiday";
export const DEFAULT_TEMPERATURE = 20;

let keyCounter = 0;
/** A new key for a band (unique in this page). */
export const newKey = () => `b${++keyCounter}`;

const isAuto = (band) => band?.auto === true;
const startOf = (band) => parseTime(band?.start, { asEnd: true, strict: false });
const endOf = (band) => parseTime(band?.end, { asEnd: true, strict: false });

/** [start, end] in minutes when the band has readable times and a positive length, else null. */
function rangeOf(band) {
  const start = startOf(band);
  const end = endOf(band);
  return start !== null && end !== null && start < MINUTES_PER_DAY && end > start ? [start, end] : null;
}

// ---- Draft ---------------------------------------------------------------------

const withKey = (band) => ({ ...band, key: band.key ?? newKey() });

/** Draft from a program of cronotermostato/state: user bands only, each with a key. */
export function draftFromServer(server) {
  const program = deserializeProgram(server);
  return {
    ...program,
    week: program.week.map((day) => stripAuto(day).map(withKey)),
    holiday: stripAuto(program.holiday).map(withKey),
  };
}

/** The bands of a day of a draft (0..6 or HOLIDAY). */
export function getDay(program, day) {
  return (day === HOLIDAY ? program.holiday : program.week[day]) ?? [];
}

/** A copy of the draft with the bands of one day replaced. */
export function setDay(program, day, bands) {
  if (day === HOLIDAY) return { ...program, holiday: bands };
  return { ...program, week: program.week.map((old, i) => (i === day ? bands : old)) };
}

/** True when the draft differs from the original program (same name and content otherwise). */
export function isDirty(draft, original) {
  return !programsEqual({ ...draft, name: original.name }, original);
}

/**
 * What to send to save: the draft without automatic bands and without editor keys,
 * the current name of the program (a rename done meanwhile is not undone) and the
 * revision the draft started from. `current` is {id, name}.
 */
export function saveRequest(draft, current) {
  const { week, holiday } = serializeProgram(draft);
  return {
    programId: current.id ?? draft.id,
    name: current.name ?? draft.name,
    week,
    holiday,
    expectedRevision: draft.revision ?? undefined,
  };
}

// ---- Bands ---------------------------------------------------------------------

/** Merged, sorted, valid ranges of the user bands of a day. */
function usedRanges(bands) {
  return bands
    .filter((band) => !isAuto(band))
    .map(rangeOf)
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);
}

/**
 * Adds a band. After the last band it starts where the previous one ends and
 * runs to 24:00 (24:00 is proposed only for the last band); if the day is full
 * to midnight, the first gap is used and the band ends where the next one starts.
 * It copies mode and temperature of the last heating/cooling band (20 °C
 * otherwise). Returns {bands, key}, or null when no minute is free.
 */
export function addBand(bands) {
  const ranges = usedRanges(bands);
  let start = 0;
  let end = MINUTES_PER_DAY;
  const lastEnd = ranges.reduce((max, [, e]) => Math.max(max, e), 0);
  if (lastEnd < MINUTES_PER_DAY) {
    start = lastEnd;
  } else {
    let cursor = 0;
    let gap = null;
    for (const [s, e] of ranges) {
      if (s > cursor) {
        gap = [cursor, s];
        break;
      }
      cursor = Math.max(cursor, e);
    }
    if (gap === null) return null;
    [start, end] = gap;
  }
  const previous = [...bands].reverse().find((band) => !isAuto(band) && band.mode !== "off" && rangeOf(band));
  const temperature = previous && previous.temperature !== null && previous.temperature !== "" && Number.isFinite(Number(previous.temperature)) ? Number(previous.temperature) : DEFAULT_TEMPERATURE;
  const added = {
    key: newKey(),
    start: formatTime(start),
    end: formatTime(end),
    mode: previous?.mode ?? "heat",
    temperature,
    preset: null,
    auto: false,
  };
  return { bands: [...bands, added], key: added.key };
}

/**
 * Changes fields of one band. Changing the mode to `off` clears temperature and
 * preset (the server refuses them); going back to heat/cool leaves them empty,
 * so the band needs a temperature or a preset. A band that is edited is the
 * user's band: `auto` is cleared.
 */
export function patchBand(bands, key, patch) {
  return bands.map((band) => {
    if (band.key !== key) return band;
    const next = { ...band, ...patch, auto: false };
    if (next.mode === "off") {
      next.temperature = null;
      next.preset = null;
    }
    return next;
  });
}

export function removeBand(bands, key) {
  return bands.filter((band) => band.key !== key);
}

/** A calculated band that the user starts to edit becomes a band of the user. Returns {bands, key}. */
export function adoptAutoBand(bands, auto) {
  const adopted = withKey({ start: auto.start, end: auto.end, mode: auto.mode, temperature: auto.temperature ?? null, preset: auto.preset ?? null, auto: false, key: undefined });
  if (adopted.mode === "off") {
    adopted.temperature = null;
    adopted.preset = null;
  }
  return { bands: [...bands, adopted], key: adopted.key };
}

/** Copies the bands of the user of `from` onto each day in `targets` (replacing theirs). */
export function copyDay(program, from, targets) {
  const source = stripAuto(getDay(program, from));
  let result = program;
  for (const target of new Set(targets)) {
    if (target === from) continue;
    result = setDay(result, target, source.map((band) => ({ ...band, key: newKey() })));
  }
  return result;
}

/**
 * Accepts what people type for a time: "8:00", "800", "8", "22.30", "24". A text
 * that cannot be a time is returned as typed, so that validation flags it.
 */
export function normalizeTime(text) {
  if (typeof text !== "string") return text;
  const raw = text.trim();
  let hours;
  let minutes;
  let match = /^(\d{1,2})$/.exec(raw);
  if (match) [hours, minutes] = [match[1], "00"];
  else if ((match = /^(\d{1,2})[:.]?(\d{2})$/.exec(raw))) [hours, minutes] = [match[1], match[2]];
  else return raw;
  if (Number(minutes) > 59) return raw;
  return `${hours.padStart(2, "0")}:${minutes}`;
}

// ---- Errors ----------------------------------------------------------------------

/**
 * Errors of a draft, by band. `byKey`: Map key -> errors of that band; `summary`:
 * all of them in the order of the week ({day, code, key, field}; `day` is null for
 * the name). The check is the same as the server's (validate.js on the serialized
 * form, bands sorted by start), so an overlap is reported on the later band.
 */
export function programErrors(program) {
  const byKey = new Map();
  const summary = [];
  const add = (day, error, key) => {
    summary.push({ day, code: error.code, key: key ?? null, field: error.field ?? null });
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), error]);
  };
  const named = validateProgram({ name: program.name, week: program.week.map(() => []), holiday: [] });
  for (const error of named) add(null, error, null);
  const days = [...program.week.map((_, i) => i), HOLIDAY];
  for (const day of days) {
    const sorted = sortBands(stripAuto(getDay(program, day)));
    for (const error of validateDay(sorted.map(serializeBand))) add(day, error, error.index === null ? null : sorted[error.index]?.key);
  }
  return { byKey, summary };
}

// ---- The bar ---------------------------------------------------------------------

export function minutesToPercent(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) throw new RangeError(`Invalid minutes: ${String(minutes)}`);
  return (minutes / MINUTES_PER_DAY) * 100;
}

/**
 * Position and width in percent of each readable band on the 0-24 bar:
 * {index, key, left, width, startMin, endMin}. Bands with unreadable times are
 * skipped (the table shows their error). A band of one minute has a true width of
 * 0.07 %: the style gives segments a minimum width in pixels.
 */
export function stripSegments(bands) {
  const segments = [];
  bands.forEach((band, index) => {
    const range = rangeOf(band);
    if (!range) return;
    const [startMin, endMin] = range;
    segments.push({ index, key: band.key ?? null, left: minutesToPercent(startMin), width: ((endMin - startMin) / MINUTES_PER_DAY) * 100, startMin, endMin });
  });
  return segments;
}

/**
 * What a segment of the big bar can show for a width in pixels. `none` below 12 px (the tooltip and the
 * aria-label still say everything); `short`: only a sigla (two letters of the preset, or the rounded
 * temperature, or just the icon); `value`: icon plus the one value that tells the band apart (the
 * temperature, or the preset when there is no temperature), cut with an ellipsis if it does not fit;
 * `both`: temperature and preset; `full`: also the "calculated" mark.
 */
export const DETAIL_LEVELS = ["none", "short", "value", "both", "full"];
export function segmentDetail(widthPx) {
  if (!(widthPx >= 12)) return "none";
  if (widthPx < 34) return "short";
  if (widthPx < 80) return "value";
  if (widthPx < 130) return "both";
  return "full";
}

/** Two-letter sigla of a preset ("away" -> "AW"), "" when there is nothing to take. */
export function presetSigla(preset) {
  const letters = [...String(preset ?? "").trim()].filter((c) => /\p{L}|\p{N}/u.test(c));
  return letters.slice(0, 2).join("").toUpperCase();
}

/** How many tints of the same mode exist (0 = the plain colour of the mode). */
export const TINT_COUNT = 4;

/**
 * Tint (0..TINT_COUNT-1) of each band, to tell apart bands of the same mode that differ in value:
 * the value is the temperature, or the preset when there is no temperature. In a day, the same
 * mode and value always get the same tint; the first value met of a mode is tint 0, the next ones
 * 1, 2, 3 (then it starts again: the label says the rest). Bands without a value are tint 0.
 */
export function bandTints(bands) {
  const seen = new Map(); // mode -> [value keys in order of appearance]
  return bands.map((band) => {
    const temperature = band.temperature;
    const hasTemp = temperature !== null && temperature !== undefined && temperature !== "" && Number.isFinite(Number(temperature));
    const preset = band.preset === null || band.preset === undefined ? "" : String(band.preset).trim();
    const value = hasTemp ? `t${Number(temperature)}` : preset ? `p${preset}` : "";
    if (value === "") return 0;
    const list = seen.get(band.mode) ?? [];
    seen.set(band.mode, list);
    let at = list.indexOf(value);
    if (at < 0) at = list.push(value) - 1;
    return at % TINT_COUNT;
  });
}

const EDGE_LABEL_PX = 38; // room taken by an "HH:MM" label under the bar

/**
 * Times to write under the bar, at the edges of the segments: [{minute, left (%), align, important}]
 * left to right, never overlapping for a bar `barPx` wide. 00:00 and 24:00 come first, then the
 * edges of the longest segments; a label that would overlap one already placed is dropped, so
 * the dropped ones are the less important. `align`: "start" at the left edge, "end" at the right
 * edge, "center" otherwise (so no label leaves the bar).
 */
export function edgeLabels(segments, barPx, labelPx = EDGE_LABEL_PX) {
  const weight = new Map(); // minute -> weight
  const add = (minute, w) => weight.set(minute, Math.max(weight.get(minute) ?? 0, w));
  for (const seg of segments) {
    const span = seg.endMin - seg.startMin;
    add(seg.startMin, span);
    add(seg.endMin, span);
  }
  add(0, Infinity);
  add(MINUTES_PER_DAY, Infinity);
  const span = (minute) => {
    const align = minute === 0 ? "start" : minute === MINUTES_PER_DAY ? "end" : "center";
    const x = (minute / MINUTES_PER_DAY) * barPx;
    const from = align === "start" ? x : align === "end" ? x - labelPx : x - labelPx / 2;
    return [from, from + labelPx, align];
  };
  const chosen = [];
  for (const [minute] of [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    const [from, to, align] = span(minute);
    if (chosen.every((c) => to <= c.from || from >= c.to)) chosen.push({ minute, from, to, align });
  }
  return chosen
    .sort((a, b) => a.minute - b.minute)
    .map(({ minute, align }) => ({ minute, left: (minute / MINUTES_PER_DAY) * 100, align, text: minute === MINUTES_PER_DAY ? "24:00" : formatTime(minute) }));
}

/**
 * Rows to show for a day: the bands of the user sorted by start, plus the
 * automatic bands of the last preview that do not overlap any of them (an
 * automatic band computed before the last edit is never shown over a new band).
 */
export function mergeDay(userBands, preview) {
  const users = sortBands(userBands);
  const ranges = users.map(rangeOf).filter(Boolean);
  const autos = Array.isArray(preview)
    ? preview
        .filter((band) => isAuto(band) && rangeOf(band))
        .filter((band) => {
          const [s, e] = rangeOf(band);
          return !ranges.some(([us, ue]) => s < ue && us < e);
        })
        .map((band) => ({ ...band, auto: true, key: `auto-${band.start}-${band.end}` }))
    : [];
  return sortBands([...users, ...autos]);
}

// ---- Presets and temperature -------------------------------------------------------

/** Union of the presets of the rooms ({presetModes}), sorted. */
export function presetOptions(rooms) {
  return [...new Set(rooms.flatMap((room) => room.presetModes ?? []))].sort((a, b) => a.localeCompare(b));
}

/** False only for a non-empty preset that no assigned room offers. */
export function presetIsKnown(preset, options) {
  return preset === null || preset === undefined || String(preset).trim() === "" || options.includes(preset);
}

/** Step of the temperature field: that of the only assigned room, otherwise 0.5. */
export function temperatureStep(rooms) {
  if (rooms.length !== 1) return DEFAULT_STEP;
  const step = Number(rooms[0].step);
  return Number.isFinite(step) && step > 0 ? step : DEFAULT_STEP;
}

const decimals = (number) => {
  const text = String(number);
  return text.includes(".") ? Math.min(3, text.split(".")[1].length) : 0;
};

/** One step up (1) or down (-1) from what is typed, without float noise; empty or invalid starts from 20. */
export function stepTemperature(current, step, direction) {
  const parsed = typeof current === "number" ? current : typeof current === "string" && current.trim() !== "" ? Number(current) : NaN;
  const base = Number.isFinite(parsed) ? parsed : DEFAULT_TEMPERATURE;
  return Number((base + direction * step).toFixed(Math.max(decimals(step), decimals(base))));
}

// ---- Preview of the automatic bands -------------------------------------------------

/**
 * Debounced calls to preview_day, one timer per day. Only the answer of the last
 * request of a day is delivered (older ones are dropped); `cancel(day)` and
 * `stop()` drop pending timers and late answers.
 */
export function createPreviewer({ preview, delay = 400, onResult, onError }) {
  const timers = new Map();
  const latest = new Map();
  const bump = (day) => {
    clearTimeout(timers.get(day));
    timers.delete(day);
    const n = (latest.get(day) ?? 0) + 1;
    latest.set(day, n);
    return n;
  };
  return {
    schedule(day, bands) {
      const mine = bump(day);
      timers.set(
        day,
        setTimeout(async () => {
          timers.delete(day);
          try {
            const result = await preview(bands);
            if (latest.get(day) === mine) onResult(day, result);
          } catch (err) {
            if (latest.get(day) === mine) onError(day, err);
          }
        }, delay),
      );
    },
    cancel(day) {
      bump(day);
    },
    stop() {
      for (const day of [...latest.keys()]) bump(day);
    },
  };
}

// ---- Compatibility with the assigned rooms --------------------------------------------

const ISSUE_ORDER = ["unsupported_mode", "unsupported_preset", "out_of_range"];
const dayOrder = (day) => (day === HOLIDAY ? 99 : day);

/**
 * Notes (never errors) about the draft for each assigned room: what the room
 * would not accept, grouped by kind: [{room, items: [{code, mode, preset,
 * temperature, days}]}]. It uses the last preview of each day (with the
 * automatic "off" bands, as the controller runs them) when there is one.
 */
export function roomWarnings(draft, previews, rooms) {
  const rowsOf = (day) =>
    mergeDay(getDay(draft, day), previews?.[day] ?? null).map((band) => {
      const s = serializeBand(band);
      const temperature = typeof s.temperature === "number" && Number.isFinite(s.temperature) ? s.temperature : null;
      return { mode: s.mode, temperature, preset: s.preset ?? null, auto: band.auto === true };
    });
  const program = { week: draft.week.map((_, i) => rowsOf(i)), holiday: rowsOf(HOLIDAY) };
  const result = [];
  for (const room of rooms) {
    const groups = new Map();
    for (const issue of roomIssues(program, room)) {
      const day = issue.where === "holiday" ? HOLIDAY : issue.day;
      const keyOf = [issue.code, issue.code === "unsupported_mode" ? issue.mode : issue.code === "unsupported_preset" ? issue.preset : issue.temperature].join("|");
      const group = groups.get(keyOf) ?? { code: issue.code, mode: issue.mode, preset: issue.preset, temperature: issue.temperature, days: [] };
      if (!group.days.includes(day)) group.days.push(day);
      groups.set(keyOf, group);
    }
    if (groups.size === 0) continue;
    const items = [...groups.values()].sort((a, b) => ISSUE_ORDER.indexOf(a.code) - ISSUE_ORDER.indexOf(b.code));
    items.forEach((item) => item.days.sort((a, b) => dayOrder(a) - dayOrder(b)));
    result.push({ room, items });
  }
  return result;
}

// ---- Names of the days ----------------------------------------------------------------

/** Name of a day (0 = Monday) in a language, with a capital letter; style "long" or "short". */
export function dayLabel(index, language = "en", style = "long") {
  if (!Number.isInteger(index) || index < 0 || index > 6) throw new RangeError(`Invalid day: ${String(index)}`);
  const text = new Intl.DateTimeFormat(language, { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + index)));
  return text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
}

// ---- Revisions: telling our own save apart from someone else's -----------------------------------

/**
 * What to do with the program read from the server, given the revision we hold (`original`):
 * `synced` (the same; the ignored revisions are no longer needed), `ignore` (a read made before
 * a save of ours, or the state of the other editor that we chose to overwrite), `conflict`
 * (someone else saved and we have unsaved edits) or `reload` (someone else saved, nothing to lose).
 */
export function syncAction({ revision, original, ignored, dirty }) {
  if (revision === original) return { action: "synced", ignored: new Set() };
  if (ignored.has(revision)) return { action: "ignore", ignored };
  return { action: dirty ? "conflict" : "reload", ignored };
}

/**
 * Revisions to ignore after a successful save: the one we started from, the ones that
 * were in the way when the conflict came up (the other editor's, when we overwrite it),
 * and what was ignored before. A read that was in flight can still bring any of them.
 */
export function revisionsToIgnore({ ignored, savedFrom, conflicts }) {
  const out = new Set(ignored);
  for (const revision of [savedFrom, ...conflicts]) if (revision !== null && revision !== undefined) out.add(revision);
  return out;
}
