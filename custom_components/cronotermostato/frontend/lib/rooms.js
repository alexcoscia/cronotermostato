// Logic of the rooms part: the list of all the `climate` rooms of Home Assistant
// and where each one is assigned, the words for every status, the "until HH:MM"
// lines, the checks of a forced setting, and the actions (assign, remove, force)
// with their confirmations. No DOM. Names, areas, presets and statuses come from
// the user or the server: they are only ever returned as strings.

import { assign, unassign, setManual, toEditorError } from "./api.js";
import { climateRooms, roomIssues, temperatureLimits } from "./climate.js";
import { HOLIDAY } from "./day-editing.js";
import { formatNumber } from "./i18n.js";
import { errorMessage } from "./program-list.js";

// ---- Status: words and severity ---------------------------------------------------------------------

const KNOWN = {
  ok: { severity: "ok", icon: "check" },
  paused: { severity: "info", icon: "pause" },
  unassigned: { severity: "info", icon: "info" },
  not_running: { severity: "info", icon: "info" },
  unavailable: { severity: "warn", icon: "warn" },
  unsupported_mode: { severity: "warn", icon: "warn" },
  unsupported_preset: { severity: "warn", icon: "warn" },
  out_of_range: { severity: "warn", icon: "warn" },
  missing: { severity: "error", icon: "x" },
  error: { severity: "error", icon: "x" },
};

export const KNOWN_STATUSES = Object.keys(KNOWN);

/** {known, severity, icon} of a status. The status is an open set: anything else is `neutral`. */
export function statusInfo(status) {
  if (typeof status === "string" && Object.hasOwn(KNOWN, status)) return { known: true, ...KNOWN[status] };
  return { known: false, severity: "neutral", icon: "info" };
}

/** Plain text of a status: the words of a known one, the value itself for any other. */
export function statusText(t, status) {
  return statusInfo(status).known ? t(`status.${status}`) : t("status.unknown", { status: String(status ?? "") });
}

// ---- Time lines -------------------------------------------------------------------------------------

const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

function todayIn(now, timeZone) {
  const options = { year: "numeric", month: "2-digit", day: "2-digit" };
  for (const zone of [timeZone, undefined]) {
    try {
      return new Intl.DateTimeFormat("en-CA", zone ? { ...options, timeZone: zone } : options).format(now);
    } catch {
      // a zone that Intl does not know: try the local one
    }
  }
  return null;
}

/**
 * {time: "HH:MM", nextDay} of an ISO text from the server. The wall clock is the one written in the
 * text (the server writes it in the zone of HA); `nextDay` is true when its date is after today in that zone.
 */
export function untilInfo(iso, { now = new Date(), timeZone } = {}) {
  const match = typeof iso === "string" ? ISO.exec(iso) : null;
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) return null;
  const today = todayIn(now, timeZone);
  const time = `${match[2]}:${match[3]}`;
  return { time, nextDay: today !== null && match[1] > today };
}

/** "until 17:30", "until 06:30 tomorrow"; null when the text is not a time. */
export function untilText(t, iso, options) {
  const info = untilInfo(iso, options);
  if (!info) return null;
  if (info.nextDay && info.time === "00:00") return t("room.until_midnight");
  return t(info.nextDay ? "room.until_tomorrow" : "room.until", { time: info.time });
}

/** "Manual until 12:00", or "Manual until the end of the band" when the time is not known. */
export function manualText(t, overrideUntil, options) {
  const until = untilText(t, overrideUntil, options);
  return until ? `${t("room.manual")} ${until}` : t("room.manual_until");
}

const unitOf = (hass) => (typeof hass?.config?.unit_system?.temperature === "string" ? hass.config.unit_system.temperature : "°C");

/** "Heating 21 °C, eco" / "Off". Off never shows temperature or preset. */
export function settingText(t, slot, { hass } = {}) {
  const mode = slot?.mode;
  const label = mode === "heat" || mode === "cool" || mode === "off" ? t(`mode.${mode}`) : String(mode ?? "");
  if (mode === "off") return label;
  const temperature = slot?.temperature;
  const number = typeof temperature === "number" && Number.isFinite(temperature) ? `${formatNumber(hass, temperature, { maximumFractionDigits: 2 })} ${unitOf(hass)}` : "";
  const preset = typeof slot?.preset === "string" && slot.preset.trim() !== "" ? slot.preset : "";
  return [number ? `${label} ${number}` : label, preset].filter(Boolean).join(", ");
}

/** "next: 17:00, Off" (with "tomorrow" after the time when it starts the next day); null without a valid start. */
export function nextText(t, slot, options = {}) {
  const info = untilInfo(slot?.start, options);
  if (!info) return null;
  const time = info.nextDay ? `${info.time} ${t("room.tomorrow")}` : info.time;
  return t("room.next", { time: `${time}, ${settingText(t, slot, options)}` });
}

// ---- Rows: every climate of HA ------------------------------------------------------------------------

function areaOf(hass, entityId) {
  const entry = hass?.entities?.[entityId];
  const areaId = entry?.area_id ?? (entry?.device_id ? hass?.devices?.[entry.device_id]?.area_id : null);
  const name = areaId ? hass?.areas?.[areaId]?.name : null;
  return typeof name === "string" && name.trim() !== "" ? name : null;
}

const byAreaThenName = (a, b) => {
  if ((a.area === null) !== (b.area === null)) return a.area === null ? 1 : -1;
  return (a.area ?? "").localeCompare(b.area ?? "") || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
};

/**
 * One row for every `climate` of HA, plus the rooms the store has assigned that HA no longer has
 * (status `missing`, so they can still be taken off). Sorted by area, then name.
 * Row: {id, name, area, climate, server, status, assignedHere, otherProgramId, otherProgramName}.
 */
export function roomRows({ hass, rooms, programs, programId }) {
  const serverRooms = new Map((Array.isArray(rooms) ? rooms : []).map((room) => [room.climate_entity_id, room]));
  const names = new Map((Array.isArray(programs) ? programs : []).map((program) => [program.program_id ?? program.id, program.name]));
  const climates = climateRooms(hass);
  const known = new Set(climates.map((room) => room.id));
  const entries = climates.map((climate) => ({ id: climate.id, name: climate.name, climate }));
  for (const [id, server] of serverRooms) {
    if (!known.has(id)) entries.push({ id, name: typeof server.name === "string" && server.name.trim() ? server.name : id, climate: null });
  }
  return entries
    .map(({ id, name, climate }) => {
      const server = serverRooms.get(id) ?? null;
      const here = server !== null && server.program_id === programId;
      const other = server !== null && !here;
      return {
        id,
        name,
        area: areaOf(hass, id),
        climate,
        server,
        status: server ? (server.status ?? "not_running") : "unassigned",
        assignedHere: here,
        otherProgramId: other ? server.program_id : null,
        otherProgramName: other ? String(server.program_name ?? names.get(server.program_id) ?? "") : null,
      };
    })
    .sort(byAreaThenName);
}

// ---- Compatibility warnings -----------------------------------------------------------------------------

const ISSUE_ORDER = ["unsupported_mode", "unsupported_preset", "out_of_range"];
const dayOrder = (day) => (day === HOLIDAY ? 99 : day);

/** The issues of `roomIssues` as one entry per kind of problem, with the days it happens on. */
export function issueGroups(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const day = issue.where === "holiday" ? HOLIDAY : issue.day;
    const key = [issue.code, issue.code === "unsupported_mode" ? issue.mode : issue.code === "unsupported_preset" ? issue.preset : issue.temperature].join("|");
    const group = groups.get(key) ?? { code: issue.code, mode: issue.mode, preset: issue.preset, temperature: issue.temperature, days: [] };
    if (!group.days.includes(day)) group.days.push(day);
    groups.set(key, group);
  }
  const result = [...groups.values()].sort((a, b) => ISSUE_ORDER.indexOf(a.code) - ISSUE_ORDER.indexOf(b.code));
  result.forEach((group) => group.days.sort((a, b) => dayOrder(a) - dayOrder(b)));
  return result;
}

// ---- Assign and remove ------------------------------------------------------------------------------------

/** What assigning `row` to `program` means: {moves, fromName, issues, needsConfirm}. Warnings never block. */
export function assignPlan(row, program) {
  const moves = row.otherProgramId !== null && row.otherProgramId !== undefined;
  const issues = row.climate ? issueGroups(roomIssues(program, row.climate)) : [];
  return { moves, fromName: moves ? row.otherProgramName : null, issues, needsConfirm: moves || issues.length > 0 };
}

/**
 * Assign the room to the program. Asks `confirm(plan)` first when the room is used by another program
 * or the program does not suit it; on "no" nothing is sent. Returns {cancelled}.
 */
export async function assignRoom(hass, { row, program, confirm }) {
  if (row.assignedHere) return { cancelled: false };
  const plan = assignPlan(row, program);
  if (plan.needsConfirm && !(await confirm(plan))) return { cancelled: true };
  await assign(hass, program.program_id ?? program.id, row.id);
  return { cancelled: false };
}

/** Take the room off its program. Always asks `confirm(row)` first; on "no" nothing is sent. */
export async function unassignRoom(hass, { row, confirm }) {
  if (!(await confirm(row))) return { cancelled: true };
  await unassign(hass, row.id);
  return { cancelled: false };
}

/** Number of an issue as HA's language writes it; "" when there is none. */
function numberText(hass, value) {
  return typeof value === "number" && Number.isFinite(value) ? formatNumber(hass, value, { maximumFractionDigits: 2 }) : "";
}

/** The placeholders of the text `issue.<code>` for one grouped issue of a room. */
export function issueParams(t, issue, climate, hass) {
  return {
    mode: ["heat", "cool", "off"].includes(issue.mode) ? t(`mode.${issue.mode}`) : String(issue.mode),
    preset: String(issue.preset),
    temperature: numberText(hass, issue.temperature),
    min: numberText(hass, climate?.minTemp),
    max: numberText(hass, climate?.maxTemp),
  };
}

/** What the switch of a room does: "assign", "unassign", or null when the user may not edit or there is no program. */
export function toggleAction({ canEdit, program, row }) {
  if (canEdit !== true || !program || !row) return null;
  return row.assignedHere ? "unassign" : "assign";
}

/**
 * Which actions make sense for a room. A room the program does not run (`not_running`, `missing`)
 * or that is not assigned has none: the server would refuse them. `note` is the key of a short
 * explanation, or null.
 */
export function availableActions(row) {
  const none = { force: false, pause: false, resume: false, auto: false, note: null };
  const server = row?.server ?? null;
  if (server === null) return none;
  if (row.status === "not_running" || row.status === "missing") return { ...none, note: row.status === "missing" ? "room.missing_note" : "room.not_running_note" };
  const paused = server.paused === true || row.status === "paused";
  return { force: true, pause: !paused, resume: paused, auto: server.manual === true, note: null };
}

/**
 * Switch of a room, on the state as it is NOW: the state is read again first, the row and the
 * program are worked out again and the question (if any) shows those. Unassigning is sent only if the
 * room is still assigned to this program, also after the question. Returns {cancelled, changed?}:
 * `changed` when the room is no longer what the user saw (nothing is sent).
 * `readState` returns {state: {rooms, programs}, program} after reading the server.
 */
export async function toggleRoom(hass, { row, programId, readState, confirm }) {
  const find = async () => {
    const { state, program } = await readState();
    const now = roomRows({ hass, rooms: state?.rooms, programs: state?.programs, programId }).find((r) => r.id === row.id) ?? null;
    return { now, program };
  };
  const changed = { cancelled: true, changed: true };
  const first = await find();
  if (!first.now || !first.program || first.now.assignedHere !== row.assignedHere) return changed;
  if (row.assignedHere) {
    let ok = true;
    const result = await unassignRoom(hass, {
      row: first.now,
      confirm: async (r) => {
        if (!(await confirm(r))) return false;
        const again = await find();
        ok = again.now !== null && again.now.assignedHere;
        return ok;
      },
    });
    return ok ? result : changed;
  }
  return assignRoom(hass, { row: first.now, program: first.program, confirm });
}

/** The dialog of a forced setting follows the rows: gone when its room disappeared or can no longer be forced. */
export function reconcileManual(manual, rows) {
  if (!manual) return { manual: null, gone: false };
  const row = rows.find((r) => r.id === manual.id);
  if (!row || !availableActions(row).force) return { manual: null, gone: true };
  return { manual, gone: false };
}

// ---- Forcing a setting --------------------------------------------------------------------------------------

const MODES = ["heat", "cool", "off"];

/** A number from text typed with a point or a comma; null for anything else. */
export function parseTemperature(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

/** The modes of the program that the room supports; all three when its capabilities are not known. */
export function manualModes(room) {
  const supported = MODES.filter((mode) => room?.hvacModes?.includes(mode));
  return supported.length > 0 ? supported : [...MODES];
}

/** First values of the form: the current band when it is heating or cooling that the room supports. */
export function manualDefaults(row) {
  const modes = manualModes(row.climate);
  const slot = row.server?.slot ?? null;
  const fromSlot = slot && (slot.mode === "heat" || slot.mode === "cool") && modes.includes(slot.mode);
  const mode = fromSlot ? slot.mode : (modes.find((m) => m !== "off") ?? "off");
  const temperature = fromSlot && typeof slot.temperature === "number" && Number.isFinite(slot.temperature) ? String(slot.temperature) : "";
  const preset = fromSlot && typeof slot.preset === "string" && row.climate?.presetModes?.includes(slot.preset) ? slot.preset : "";
  return { mode, temperature, preset };
}

/**
 * Check the form of the dialog against the room. Returns {ok, errors, request}; `errors` has at most
 * `mode`, `temperature` and `preset`, each {code, params}. `off` carries neither temperature nor preset.
 * `format` writes the numbers of the message.
 */
export function validateManual(form, room, format = String) {
  const errors = {};
  const mode = form?.mode;
  if (!MODES.includes(mode)) errors.mode = { code: "bad_mode", params: {} };
  else if (room && room.hvacModes.length > 0 && !room.hvacModes.includes(mode)) errors.mode = { code: "unsupported_mode", params: { mode } };
  if (mode === "off" || errors.mode?.code === "bad_mode") {
    return Object.keys(errors).length > 0 ? { ok: false, errors, request: null } : { ok: true, errors, request: { mode: "off" } };
  }
  const text = typeof form.temperature === "number" ? String(form.temperature) : String(form.temperature ?? "").trim();
  const preset = typeof form.preset === "string" ? form.preset.trim() : "";
  const temperature = text === "" ? null : parseTemperature(text);
  if (text !== "" && temperature === null) errors.temperature = { code: "bad_temperature", params: {} };
  else if (text === "" && preset === "") errors.temperature = { code: "missing_setting", params: {} };
  else if (temperature !== null) {
    const [min, max] = temperatureLimits({ min_temp: room?.minTemp, max_temp: room?.maxTemp });
    if (!(min <= temperature && temperature <= max)) errors.temperature = { code: "out_of_range", params: { temperature: format(temperature), min: format(min), max: format(max) } };
  }
  if (preset !== "" && room && !room.presetModes.includes(preset)) errors.preset = { code: "unsupported_preset", params: { preset } };
  if (Object.keys(errors).length > 0) return { ok: false, errors, request: null };
  const request = { mode };
  if (temperature !== null) request.temperature = temperature;
  if (preset !== "") request.preset = preset;
  return { ok: true, errors, request };
}

/**
 * {step} when a typed temperature is not a multiple of the step the room declares: the thermostat
 * will round it. Never blocks; null when there is nothing to say (off, no number, no declared step).
 */
export function stepNotice(form, room) {
  if (!room || room.stepKnown !== true || form?.mode === "off") return null;
  const value = parseTemperature(form?.temperature);
  const step = room.step;
  if (value === null || !(step > 0)) return null;
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) > 1e-6 ? { step } : null;
}

/** Force a setting until the end of the band. {invalid, errors} without calling the service when the form is wrong. */
export async function forceRoom(hass, row, form) {
  const checked = validateManual(form, row.climate);
  if (!checked.ok) return { invalid: true, errors: checked.errors };
  await setManual(hass, row.id, checked.request);
  return { invalid: false, errors: {} };
}

// ---- Running an action ---------------------------------------------------------------------------------------

/** The keys (rooms) whose action is running: a second click on the same one does nothing. */
export function createGuard() {
  const running = new Set();
  return { has: (key) => running.has(key), add: (key) => running.add(key), delete: (key) => running.delete(key) };
}

/**
 * Run `action` once per key at a time. Afterwards the state is read again (`refresh`), also after an
 * error: the room may have changed meanwhile. Returns {status: busy | done | cancelled | error, error?}.
 * Nothing is thrown.
 */
export async function runAction(guard, key, action, { refresh } = {}) {
  if (guard.has(key)) return { status: "busy" };
  guard.add(key);
  try {
    let outcome;
    try {
      const value = await action();
      outcome = value?.cancelled === true ? { status: "cancelled", value } : { status: "done", value };
    } catch (error) {
      outcome = { status: "error", error: toEditorError(error) };
    }
    if (outcome.status !== "cancelled") {
      try {
        await refresh?.();
      } catch {
        // the next event or reconnection reads it; the result of the action stands
      }
    }
    return outcome;
  } finally {
    guard.delete(key);
  }
}

/** Text of an error of an action: the generic one and, for a refused value, what the server said. */
export function actionErrorMessage(t, err) {
  const base = errorMessage(t, err);
  const message = typeof err?.message === "string" ? err.message.trim() : "";
  const detailKey = err?.detailCode ? `validation.${err.detailCode}` : null;
  const hasDetail = detailKey !== null && t(detailKey) !== detailKey;
  if (err?.code === "invalid_format" && !hasDetail && message !== "" && message !== "invalid_format") return `${base} ${message}`;
  return base;
}
