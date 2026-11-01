// The "reference room" of the program editor: the climate whose presets (and
// temperature step) the band fields offer. It is only an aid to filling in the
// bands: it is never saved in the program. Pure functions, no DOM. Names and
// presets come from Home Assistant and are returned as plain strings.

import { areaOf } from "./rooms.js";

/** The choice "all the rooms assigned to this program" (union of their presets). */
export const ALL = "*";
export const REFERENCE_KEY = "cronotermostato.reference_room";

const MAX_ID = 200;

/** All / the first room assigned elsewhere / nothing. `climate`: climateRooms(hass), sorted. */
export function defaultReference({ climate, assignedIds, elsewhereIds }) {
  if (climate.some((room) => assignedIds.has(room.id))) return ALL;
  const elsewhere = climate.find((room) => elsewhereIds.has(room.id));
  return elsewhere ? elsewhere.id : null;
}

/** The remembered choice if it still makes sense, otherwise the default. */
export function resolveReference({ stored, climate, assignedIds, elsewhereIds }) {
  if (stored === ALL && climate.some((room) => assignedIds.has(room.id))) return ALL;
  if (typeof stored === "string" && stored !== ALL && climate.some((room) => room.id === stored)) return stored;
  return defaultReference({ climate, assignedIds, elsewhereIds });
}

/** The rooms a choice stands for (climateRooms rows). */
export function referenceRooms(choice, climate, assignedIds) {
  if (choice === ALL) return climate.filter((room) => assignedIds.has(room.id));
  if (typeof choice !== "string") return [];
  return climate.filter((room) => room.id === choice);
}

const byAreaThenName = (a, b) => {
  if ((a.area === null) !== (b.area === null)) return a.area === null ? 1 : -1;
  return (a.area ?? "").localeCompare(b.area ?? "") || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
};

/** Options of the select: {all, assigned: [{id, label}], others: [{id, label}]}; every climate exactly once. */
export function referenceOptions({ climate, assignedIds, hass }) {
  const entries = climate.map((room) => {
    const area = areaOf(hass, room.id);
    return { id: room.id, name: room.name, area, label: area ? `${room.name} (${area})` : room.name };
  });
  const assigned = entries.filter((e) => assignedIds.has(e.id)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const others = entries.filter((e) => !assignedIds.has(e.id)).sort(byAreaThenName);
  const strip = ({ id, label }) => ({ id, label });
  return { all: assigned.length > 0, assigned: assigned.map(strip), others: others.map(strip) };
}

/**
 * What the preset select of a band offers for the rooms of the reference and the value now in the band.
 * {presets (sorted, unique), hasRooms, noPresets (a room is chosen and has none), unavailable (the value is
 * set but no chosen room has it), current}.
 */
export function presetChoices({ rooms, current }) {
  const presets = [...new Set(rooms.flatMap((room) => room.presetModes ?? []))].sort((a, b) => a.localeCompare(b));
  const value = current === null || current === undefined ? "" : String(current);
  const hasRooms = rooms.length > 0;
  return {
    presets,
    hasRooms,
    noPresets: hasRooms && presets.length === 0,
    unavailable: hasRooms && value.trim() !== "" && !presets.includes(current),
    current: value,
  };
}

/** The i18n key of the hint under the select, or null. */
export function referenceHintKey(choice) {
  return choice === null || choice === undefined ? "reference.pick" : null;
}

// ---- Remembered in the session: program id -> room id (nothing else) ------------------

function sessionStorageOrNull() {
  try {
    return globalThis.sessionStorage ?? null; // the accessor itself can throw
  } catch {
    return null;
  }
}

function readMap(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(REFERENCE_KEY) ?? "null");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    return new Map(Object.entries(parsed).filter(([k, v]) => typeof v === "string" && v !== "" && v.length <= MAX_ID && k.length <= MAX_ID));
  } catch {
    return new Map();
  }
}

export function loadReference(programId, storage = sessionStorageOrNull()) {
  return readMap(storage).get(String(programId)) ?? null;
}

/** `roomId` null forgets the choice for that program. */
export function storeReference(programId, roomId, storage = sessionStorageOrNull()) {
  try {
    if (!storage) return;
    const map = readMap(storage);
    if (typeof roomId === "string" && roomId !== "" && roomId.length <= MAX_ID) map.set(String(programId), roomId);
    else map.delete(String(programId));
    if (map.size === 0) storage.removeItem(REFERENCE_KEY);
    else storage.setItem(REFERENCE_KEY, JSON.stringify(Object.fromEntries([...map].slice(-100))));
  } catch {
    // private window or blocked storage: the choice is simply not remembered
  }
}
