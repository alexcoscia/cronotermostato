// Logic of the program list, without DOM: order, summaries, selection (and its
// memory in the session), deletion rules and the actions that call the API.
// Names come from the user and are plain text: nothing here builds markup.

import { deleteProgram, saveProgram, unassign } from "./api.js";
import { roomIssues } from "./climate.js";
import { deserializeProgram, emptyProgram, serializeProgram } from "./model.js";

const idOf = (program) => program.program_id ?? program.id;
const compareNames = (a, b) => String(a.name).localeCompare(String(b.name)) || String(idOf(a)).localeCompare(String(idOf(b)));

/** Programs sorted by name, then id (a copy). Same order as the store. */
export function sortPrograms(programs) {
  return [...programs].sort(compareNames);
}

// Room statuses that are a problem to look at (not "ok", not a choice of the user
// such as "paused", not a state that is simply not started yet).
const PROBLEM_STATUSES = new Set(["error", "missing", "unavailable", "unsupported_mode", "unsupported_preset", "out_of_range"]);

/**
 * One summary per program, in list order: {id, name, roomCount, roomIds, warnings}.
 * `rooms` are the rooms of the state (with `program_id`); `climate` the result of
 * `climateRooms(hass)` (optional): its limits give the warnings of `roomIssues`.
 */
export function summarizePrograms(programs, rooms = [], climate = []) {
  const climateById = new Map(climate.map((room) => [room.id, room]));
  return sortPrograms(programs).map((program) => {
    const mine = rooms.filter((room) => room.program_id === idOf(program));
    let warnings = 0;
    for (const room of mine) {
      if (PROBLEM_STATUSES.has(room.status)) warnings += 1;
      else if (climateById.has(room.climate_entity_id) && roomIssues(program, climateById.get(room.climate_entity_id)).length > 0) warnings += 1;
    }
    return {
      id: idOf(program),
      name: String(program.name ?? ""),
      roomCount: mine.length,
      roomIds: mine.map((room) => room.climate_entity_id),
      warnings,
    };
  });
}

/**
 * What the list shows: `loading`, `not_loaded`, `error`, `empty` or `ready`.
 * An error with programs already read keeps the list (`ready`, `error` set).
 */
export function listStatus(state) {
  const hasPrograms = state.programs.length > 0;
  if (state.notLoaded) return { status: "not_loaded", error: null };
  if (state.error && !hasPrograms) return { status: "error", error: state.error };
  if (state.loading && !hasPrograms) return { status: "loading", error: null };
  if (!hasPrograms) return { status: "empty", error: null };
  return { status: "ready", error: state.error ?? null };
}

// ---- Selection ----------------------------------------------------------------

/** Selection {id, seen, pending}: `seen` once the id was in the list, `pending` right after creating it. */
export const noSelection = () => ({ id: null, seen: false, pending: false });
export const selectionOf = (id) => ({ id, seen: false, pending: false });
/** The program just created: it may not be in the state yet, which is not "removed". */
export const pendingSelection = (id) => ({ id, seen: false, pending: true });

/**
 * Reconcile the selection with the programs read from the server.
 * Returns {selection, status}: `ok`, `pending` (just created, not read yet),
 * `removed` (it was there and is gone: the selection keeps the id so the
 * editor can say it) or `none` (no programs). A remembered id that is not in
 * the list is dropped silently, and the first program is selected.
 */
export function reconcileSelection(selection, programs) {
  const ordered = sortPrograms(programs);
  const ids = ordered.map(idOf);
  if (selection.id !== null && ids.includes(selection.id)) {
    return { selection: { id: selection.id, seen: true, pending: false }, status: "ok" };
  }
  if (selection.id !== null && selection.pending) return { selection, status: "pending" };
  if (selection.id !== null && selection.seen) return { selection, status: "removed" };
  if (ids.length === 0) return { selection: noSelection(), status: "none" };
  return { selection: { id: ids[0], seen: true, pending: false }, status: "ok" };
}

/**
 * Selection right after deleting `removedId`: the state still read may list it,
 * so reconcile on the programs without it (the neighbour, or `none` if it was
 * the last one), never `removed`. `orderedIds` is the list order before deleting.
 */
export function reconcileAfterDelete(orderedIds, programs, removedId) {
  const remaining = programs.filter((program) => idOf(program) !== removedId);
  const next = neighbourId(orderedIds, removedId, remaining.map(idOf));
  return reconcileSelection(next === null ? noSelection() : selectionOf(next), remaining);
}

/**
 * The program to select when `removedId` goes away: the next one in the old
 * order that still exists, else the previous one, else null.
 */
export function neighbourId(orderedIds, removedId, remainingIds) {
  const remaining = new Set(remainingIds);
  const at = orderedIds.indexOf(removedId);
  if (at < 0) return remainingIds.length > 0 ? remainingIds[0] : null;
  for (let i = at + 1; i < orderedIds.length; i += 1) if (remaining.has(orderedIds[i])) return orderedIds[i];
  for (let i = at - 1; i >= 0; i -= 1) if (remaining.has(orderedIds[i])) return orderedIds[i];
  return null;
}

// ---- Selection remembered in the session (only the id) --------------------------

export const SELECTION_KEY = "cronotermostato.selected_program";

function sessionStorageOrNull() {
  try {
    return globalThis.sessionStorage ?? null; // the accessor itself can throw
  } catch {
    return null;
  }
}

export function loadStoredSelection(storage = sessionStorageOrNull()) {
  try {
    const value = storage?.getItem(SELECTION_KEY);
    return typeof value === "string" && value !== "" && value.length <= 200 ? value : null;
  } catch {
    return null;
  }
}

export function storeSelection(id, storage = sessionStorageOrNull()) {
  try {
    if (!storage) return;
    if (typeof id === "string" && id !== "") storage.setItem(SELECTION_KEY, id);
    else storage.removeItem(SELECTION_KEY);
  } catch {
    // private window or blocked storage: the selection is simply not remembered
  }
}

// ---- Names -------------------------------------------------------------------

/** Trimmed name, or null if empty. */
export function cleanName(text) {
  const name = typeof text === "string" ? text.trim() : "";
  return name === "" ? null : name;
}

/** `base`, or `base 2`, `base 3`... if a program already has that name. */
export function uniqueName(base, names) {
  const taken = new Set(names);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** True if another program (not `exceptId`) already has this name, ignoring case and extra spaces. */
export function sameNameExists(name, programs, exceptId = null) {
  const norm = (text) => String(text ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const wanted = norm(name);
  return wanted !== "" && programs.some((program) => idOf(program) !== exceptId && norm(program.name) === wanted);
}

// ---- Deletion -------------------------------------------------------------------

/** Why a program cannot be deleted: {count, roomIds}, or null if it can. */
export function deleteBlock(programId, rooms) {
  const roomIds = rooms.filter((room) => room.program_id === programId).map((room) => room.climate_entity_id);
  return roomIds.length > 0 ? { count: roomIds.length, roomIds } : null;
}

/** What is still blocking after taking rooms off: the rooms of the program that did not come off, or null. */
export function blockAfterUnassign(programId, rooms, { done }) {
  return deleteBlock(programId, rooms.filter((room) => !done.includes(room.climate_entity_id)));
}

// ---- Actions (they call the API; errors are EditorError and reach the caller) ----

const contentOf = (program) => serializeProgram(deserializeProgram(program));

/** A new empty program. Returns its id. */
export async function createNewProgram(hass, name) {
  const base = emptyProgram(name);
  const { programId } = await saveProgram(hass, { name: base.name, week: base.week, holiday: base.holiday });
  return programId;
}

/** A copy of `program` (a program of the state) with a new name. Returns the id of the copy. */
export async function duplicateProgram(hass, program, name) {
  const content = contentOf(program);
  const { programId } = await saveProgram(hass, { name, week: content.week, holiday: content.holiday });
  return programId;
}

/** Same content, new name; the revision protects against a change made elsewhere. */
export async function renameProgram(hass, program, name) {
  const content = contentOf(program);
  await saveProgram(hass, { programId: idOf(program), name, week: content.week, holiday: content.holiday, expectedRevision: program.revision });
}

/** Delete a program; refuses (without calling the server) if it has rooms. */
export async function removeProgram(hass, program, rooms) {
  const block = deleteBlock(idOf(program), rooms);
  if (block) {
    const err = new Error("program_in_use");
    err.blocked = block;
    throw err;
  }
  await deleteProgram(hass, idOf(program), program.revision);
}

/** Take the rooms off a program. Returns {done, failed: [{id, error}]}; it keeps going after a failure. */
export async function unassignRooms(hass, roomIds) {
  const done = [];
  const failed = [];
  for (const id of roomIds) {
    try {
      await unassign(hass, id);
      done.push(id);
    } catch (error) {
      failed.push({ id, error });
    }
  }
  return { done, failed };
}

// ---- Texts of errors and permissions ----------------------------------------------

/** Text for an EditorError: the generic code, plus the stable detail code when there is a text for it. */
export function errorMessage(t, err) {
  const code = err?.code;
  const generic = typeof code === "string" && t(`error.${code}`) !== `error.${code}` ? t(`error.${code}`) : null;
  const detailKey = err?.detailCode ? `validation.${err.detailCode}` : null;
  const detail = detailKey && t(detailKey) !== detailKey ? t(detailKey) : null;
  if (generic && detail) return `${generic} ${detail}`;
  return generic ?? detail ?? String(err?.message ?? "");
}

/**
 * False for a user who is not an administrator while the option "only
 * administrators" is on. It only hides buttons: the server decides (the
 * WebSocket commands check `is_admin`).
 */
export function canEdit(state, hass) {
  return !(state.options?.admin_only && hass?.user?.is_admin === false);
}
