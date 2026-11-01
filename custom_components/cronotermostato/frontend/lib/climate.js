// The `climate` rooms of Home Assistant and the checks of a program against
// a room, with the same rules and fallbacks as the server (controller.py:
// temperature_limits and RoomController._apply). No DOM.

export const DEFAULT_MIN_TEMP = 5;
export const DEFAULT_MAX_TEMP = 35;
export const DEFAULT_STEP = 0.5;

/** Like Python's `_finite`: a number or a numeric text, never a bool, never NaN/Infinity. */
function finite(value) {
  if (typeof value === "boolean") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** [min, max] of a climate from its attributes: both finite with min < max, else 5/35. */
export function temperatureLimits(attributes) {
  const low = finite(attributes?.min_temp);
  const high = finite(attributes?.max_temp);
  return low !== null && high !== null && low < high ? [low, high] : [DEFAULT_MIN_TEMP, DEFAULT_MAX_TEMP];
}

const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);

/** The climate entities of `hass.states`, sorted by name. */
export function climateRooms(hass) {
  const rooms = Object.entries(hass?.states ?? {})
    .filter(([id]) => id.startsWith("climate."))
    .map(([id, state]) => {
      const attributes = state?.attributes ?? {};
      const [minTemp, maxTemp] = temperatureLimits(attributes);
      const step = finite(attributes.target_temp_step);
      return {
        id,
        name: typeof attributes.friendly_name === "string" && attributes.friendly_name.trim() ? attributes.friendly_name : id,
        available: state?.state !== "unavailable",
        hvacModes: strings(attributes.hvac_modes),
        presetModes: strings(attributes.preset_modes),
        minTemp,
        maxTemp,
        step: step !== null && step > 0 ? step : DEFAULT_STEP,
      };
    });
  return rooms.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The first problem the controller would find with a band, or null (same order: mode, preset, range). */
function bandIssue(band, room) {
  if (!room.hvacModes.includes(band.mode)) return "unsupported_mode";
  const preset = band.preset ?? null;
  if (preset !== null && !room.presetModes.includes(preset)) return "unsupported_preset";
  const temperature = band.temperature ?? null;
  if (temperature !== null && !(room.minTemp <= temperature && temperature <= room.maxTemp)) return "out_of_range";
  return null;
}

function dayIssues(bands, where, day, room) {
  if (!Array.isArray(bands)) return [];
  const issues = [];
  bands.forEach((band, index) => {
    if (band === null || typeof band !== "object") return;
    const code = bandIssue(band, room);
    if (code) {
      issues.push({ code, where, day, index, mode: band.mode, temperature: band.temperature ?? null, preset: band.preset ?? null, auto: band.auto === true });
    }
  });
  return issues;
}

/**
 * Problems of a program for a room, band by band. Uses `week_full`/`holiday_full`
 * (with the automatic "off" bands) when the program has them, as the controller
 * runs the normalized program. An unavailable room reports nothing: its
 * attributes are not there.
 */
export function roomIssues(program, room) {
  if (!program || !room || room.available === false) return [];
  const week = Array.isArray(program.week_full) ? program.week_full : program.week;
  const holiday = Array.isArray(program.holiday_full) ? program.holiday_full : program.holiday;
  const issues = [];
  if (Array.isArray(week)) week.forEach((bands, day) => issues.push(...dayIssues(bands, "week", day, room)));
  issues.push(...dayIssues(holiday, "holiday", null, room));
  return issues;
}
