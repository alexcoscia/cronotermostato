// The table "temperature of each preset" of an assigned room. Home Assistant does not say which
// temperature a preset sets (only the setpoint of the active one), so the integration keeps a table
// per room, filled in by the user. It is only informative: the engine sends the preset to the
// thermostat and never reads the table. No DOM.

/** A finite number from a number or a numeric text, else null. Booleans and blanks are not numbers. */
function finite(value) {
  if (typeof value === "boolean" || value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** The table of a server room as {preset: number}; anything that is not a number is dropped. */
export function tableOf(serverRoom) {
  const raw = serverRoom?.preset_temperatures;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const table = {};
  for (const [preset, value] of Object.entries(raw)) {
    const number = finite(value);
    if (number !== null) table[preset] = number;
  }
  return table;
}

/**
 * What the temperature field of a band with `preset` shows for the reference rooms.
 * `rooms`: climateRooms rows of the reference; `serverRooms`: state.rooms (carry the tables).
 * Returns null when the preset is not one of those rooms' presets (a free text: the field stays
 * the user's), else {kind: "value", value} | {kind: "unset"} | {kind: "varies"}.
 * Only the rooms that have the preset count; the value is shown when all of them agree.
 */
export function presetTemperature(preset, rooms, serverRooms) {
  if (typeof preset !== "string" || preset.trim() === "") return null;
  const owners = (rooms ?? []).filter((room) => (room.presetModes ?? []).includes(preset));
  if (owners.length === 0) return null;
  const byId = new Map((Array.isArray(serverRooms) ? serverRooms : []).map((room) => [room.climate_entity_id, room]));
  const values = owners.map((room) => {
    const table = tableOf(byId.get(room.id));
    return Object.hasOwn(table, preset) ? table[preset] : null;
  });
  if (values.every((v) => v === null)) return { kind: "unset" };
  if (values.every((v) => v === values[0])) return { kind: "value", value: values[0] };
  return { kind: "varies" };
}

const near = (a, b) => Math.abs(a - b) < 1e-6;

/**
 * Check what is typed for one preset against the room: null when fine (empty = unknown, stored as null).
 * Returns "not_number" | "out_of_range" | "bad_step". The server checks the same rules.
 */
export function presetInputIssue(text, room) {
  if (text === null || text === undefined || String(text).trim() === "") return null;
  const value = finite(String(text).replace(",", "."));
  if (value === null) return "not_number";
  if (!(room.minTemp <= value && value <= room.maxTemp)) return "out_of_range";
  const ratio = value / room.step;
  if (!near(ratio, Math.round(ratio))) return "bad_step";
  return null;
}

/** The table to send: the room's presets only, empty = unknown (omitted), values as numbers. */
export function tableToSend(draft, room) {
  const table = {};
  for (const preset of room.presetModes ?? []) {
    const value = finite(String(draft?.[preset] ?? "").replace(",", "."));
    if (value !== null) table[preset] = value;
  }
  return table;
}
