// Configuration of the Lovelace card `cronotermostato-card`: validation and the filter of the
// rooms. No DOM. Home Assistant shows the message of a thrown error in place of the card, so the
// messages say what is wrong and what is allowed (they are in English: the card has no `hass`, so
// no language, when `setConfig` runs).
//
// Options (all optional):
//   view        "rooms" (default) | "editor"
//   title       text above the card
//   program_id  rooms: only the rooms that run this program; editor: opens this program
//   rooms       list of `climate.*` entity ids: only these rooms (view "rooms")
// Other keys (`type`, `grid_options`, `visibility`, ...) belong to Home Assistant and are ignored.
//
// The default is "rooms": the compact view is what a dashboard usually needs (status and forcing),
// and it is cheap; the full editor in a card is a deliberate choice.

import { roomRows } from "./rooms.js";

export const VIEWS = ["rooms", "editor"];
export const DEFAULT_VIEW = "rooms";

const CLIMATE_ID = /^climate\.[a-z0-9_]+$/;

const shown = (value) => {
  let text;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

/** A valid, complete configuration: {view, title, program_id, rooms}. Throws `Error` with a clear message otherwise. */
export function normalizeConfig(config) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Invalid configuration: expected an object with the options of the card (view, title, program_id, rooms)");
  }
  const { view = DEFAULT_VIEW, title, program_id: programId, rooms } = config;
  if (!VIEWS.includes(view)) throw new Error(`Unknown view ${shown(view)}: use "rooms" or "editor"`);
  if (title !== undefined && title !== null && typeof title !== "string") throw new Error(`Invalid "title": expected text, got ${shown(title)}`);
  if (programId !== undefined && programId !== null && typeof programId !== "string") throw new Error(`Invalid "program_id": expected text, got ${shown(programId)}`);
  let list = null;
  if (rooms !== undefined && rooms !== null) {
    if (!Array.isArray(rooms)) throw new Error(`Invalid "rooms": expected a list of climate entity ids, got ${shown(rooms)}`);
    for (const id of rooms) {
      if (typeof id !== "string" || !CLIMATE_ID.test(id)) throw new Error(`Invalid "rooms": ${shown(id)} is not a climate entity id (like climate.living_room)`);
    }
    list = [...new Set(rooms)];
    if (list.length === 0) list = null; // an empty list means "all the rooms"
  }
  return {
    view,
    title: (title ?? "").trim(),
    program_id: (programId ?? "").trim() === "" ? null : programId.trim(),
    rooms: list,
  };
}

/**
 * The rows (of `roomRows`) the compact view shows: rooms that run a program, then the filters
 * of the card on the rooms and on the program.
 */
export function cardRows(rows, config) {
  const wanted = config.rooms === null ? null : new Set(config.rooms);
  return rows.filter((row) => row.server !== null && (wanted === null || wanted.has(row.id)) && (config.program_id === null || row.server.program_id === config.program_id));
}

// The parts of `hass` that change what the compact view shows. HA replaces `hass` at EVERY state
// change of the house, so the rows are recomputed only when one of these changed (by identity).
const HASS_KEYS = ["language", "locale", "themes", "config", "entities", "devices", "areas"];

/**
 * Memoizes the rows of the card. Call it with {hass, rooms, programs, config}; it returns
 * {rows, hass}: the rows (same array while nothing relevant changed) and the `hass` to hand to
 * the children (the one the rows were computed with, so they do not render again for the
 * unrelated state changes of the house). Relevant: the state objects of the assigned `climate`
 * rooms, the keys in HASS_KEYS, and the `rooms`/`programs` of the store and the card config.
 * `compute` is only for tests.
 */
export function createRowsMemo(compute = ({ hass, rooms, programs }) => roomRows({ hass, rooms, programs, programId: null })) {
  let last = null;
  let result = null;
  return ({ hass, rooms, programs, config }) => {
    if (last !== null && last.rooms === rooms && last.programs === programs && last.config === config && sameHass(last, hass)) return result;
    const ids = (Array.isArray(rooms) ? rooms : []).map((room) => room.climate_entity_id);
    last = { rooms, programs, config, ids, states: ids.map((id) => hass?.states?.[id]), keys: HASS_KEYS.map((key) => hass?.[key]) };
    result = { rows: cardRows(compute({ hass, rooms, programs }), config), hass };
    return result;
  };
}

function sameHass(last, hass) {
  if (!last.keys.every((value, i) => value === hass?.[HASS_KEYS[i]])) return false;
  return last.ids.every((id, i) => last.states[i] === hass?.states?.[id]);
}
