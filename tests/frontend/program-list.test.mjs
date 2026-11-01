import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { makeHass } from "./fake-hass.mjs";
import { createT, tn } from "../../custom_components/cronotermostato/frontend/lib/i18n.js";
import { EditorError } from "../../custom_components/cronotermostato/frontend/lib/api.js";
import {
  sortPrograms, summarizePrograms, listStatus, reconcileSelection, selectionOf, pendingSelection, noSelection, neighbourId,
  loadStoredSelection, storeSelection, SELECTION_KEY, cleanName, uniqueName, deleteBlock, createNewProgram, duplicateProgram,
  renameProgram, removeProgram, unassignRooms, errorMessage, canEdit,
} from "../../custom_components/cronotermostato/frontend/lib/program-list.js";
const { renderProgramList } = await import("../../custom_components/cronotermostato/frontend/components/crono-program-list.js");

const week = () => Array.from({ length: 7 }, () => []);
const prog = (id, name, extra = {}) => ({ program_id: id, name, revision: `rev-${id}`, week: week(), holiday: [], week_full: week(), holiday_full: [], ...extra });
const room = (id, programId, status = "ok") => ({ climate_entity_id: id, program_id: programId, status });
const HOSTILE = "<img src=x onerror=alert(1)>";

// ---- order, summaries, status ---------------------------------------------------------

test("sortPrograms: by name, then id, on a copy", () => {
  const input = [prog("b", "Beta"), prog("a2", "Alfa"), prog("a1", "Alfa")];
  assert.deepEqual(sortPrograms(input).map((p) => p.program_id), ["a1", "a2", "b"]);
  assert.deepEqual(input.map((p) => p.program_id), ["b", "a2", "a1"]);
});

test("summarizePrograms: room count, and a warning for a problem room or a room issue", () => {
  const hot = [[{ start: "08:00", end: "09:00", mode: "heat", temperature: 30, preset: null }], [], [], [], [], [], []];
  const programs = [prog("a", "A", { week: hot, week_full: hot }), prog("b", "B")];
  const rooms = [room("climate.x", "a"), room("climate.y", "a", "unavailable"), room("climate.z", "b", "paused")];
  const climate = [{ id: "climate.x", available: true, hvacModes: ["heat", "off"], presetModes: [], minTemp: 15, maxTemp: 25, step: 0.5 }];
  const [a, b] = summarizePrograms(programs, rooms, climate);
  assert.deepEqual([a.id, a.roomCount, a.warnings], ["a", 2, 2]); // x: 30 out of range, y: unavailable
  assert.deepEqual([b.id, b.roomCount, b.warnings], ["b", 1, 0]); // paused is a choice, not a warning
  assert.deepEqual(a.roomIds, ["climate.x", "climate.y"]);
});

test("listStatus: loading, not_loaded, error, empty, ready", () => {
  const base = { programs: [], loading: false, error: null, notLoaded: false };
  assert.equal(listStatus({ ...base, loading: true }).status, "loading");
  assert.equal(listStatus({ ...base, notLoaded: true }).status, "not_loaded");
  const error = new EditorError("network", "down");
  assert.deepEqual(listStatus({ ...base, error }), { status: "error", error });
  assert.equal(listStatus(base).status, "empty");
  assert.equal(listStatus({ ...base, programs: [prog("a", "A")] }).status, "ready");
  // an error after programs were read keeps the list and carries the error
  assert.deepEqual(listStatus({ ...base, programs: [prog("a", "A")], error }), { status: "ready", error });
  // not_loaded wins even with old programs
  assert.equal(listStatus({ ...base, programs: [prog("a", "A")], notLoaded: true }).status, "not_loaded");
});

// ---- selection ----------------------------------------------------------------------

test("reconcileSelection: remembered id in the list is kept; unknown remembered id falls to the first", () => {
  const programs = [prog("b", "Beta"), prog("a", "Alfa")];
  assert.deepEqual(reconcileSelection(selectionOf("b"), programs), { selection: { id: "b", seen: true, pending: false }, status: "ok" });
  const r = reconcileSelection(selectionOf("gone"), programs);
  assert.equal(r.status, "ok");
  assert.equal(r.selection.id, "a"); // first in list order
  assert.equal(reconcileSelection(noSelection(), programs).selection.id, "a");
});

test("reconcileSelection: no programs -> none", () => {
  assert.deepEqual(reconcileSelection(selectionOf("x"), []), { selection: noSelection(), status: "none" });
});

test("reconcileSelection: a program that disappears after being seen -> removed, id kept", () => {
  const seen = reconcileSelection(selectionOf("a"), [prog("a", "A"), prog("b", "B")]).selection;
  const after = reconcileSelection(seen, [prog("b", "B")]);
  assert.equal(after.status, "removed");
  assert.equal(after.selection.id, "a");
  // and it stays removed on the next reads: it is never recreated or silently replaced
  assert.equal(reconcileSelection(after.selection, [prog("b", "B")]).status, "removed");
  // if it comes back (undo elsewhere) it is ok again
  assert.equal(reconcileSelection(after.selection, [prog("a", "A")]).status, "ok");
});

test("reconcileSelection: just created, not yet in the state -> pending, not removed", () => {
  const r = reconcileSelection(pendingSelection("new"), [prog("a", "A")]);
  assert.equal(r.status, "pending");
  assert.equal(r.selection.id, "new");
  assert.equal(reconcileSelection(r.selection, [prog("a", "A"), prog("new", "N")]).status, "ok");
});

test("neighbourId: next, else previous, else null", () => {
  assert.equal(neighbourId(["a", "b", "c"], "b", ["a", "c"]), "c");
  assert.equal(neighbourId(["a", "b", "c"], "c", ["a", "b"]), "b");
  assert.equal(neighbourId(["a"], "a", []), null);
  assert.equal(neighbourId(["a", "b", "c"], "a", ["c"]), "c");
  assert.equal(neighbourId([], "zz", ["q", "r"]), "q");
});

// ---- selection in the session -----------------------------------------------------

const fakeStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
};

test("session selection: stores only the id; reads it back", () => {
  const storage = fakeStorage();
  storeSelection("prog-1", storage);
  assert.deepEqual(storage.data, { [SELECTION_KEY]: "prog-1" });
  assert.equal(loadStoredSelection(storage), "prog-1");
  storeSelection(null, storage);
  assert.deepEqual(storage.data, {});
  assert.equal(loadStoredSelection(storage), null);
});

test("session selection: a throwing or missing storage never breaks", () => {
  const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(loadStoredSelection(boom), null);
  assert.doesNotThrow(() => storeSelection("x", boom));
  assert.doesNotThrow(() => storeSelection("x", null));
  assert.equal(loadStoredSelection(null), null);
  // default storage: absent in node (and a throwing accessor is covered by try/catch)
  assert.doesNotThrow(() => storeSelection("x"));
  assert.equal(loadStoredSelection(), null);
  // junk is ignored
  assert.equal(loadStoredSelection(fakeStorage({ [SELECTION_KEY]: "x".repeat(500) })), null);
});

test("session selection: a throwing sessionStorage accessor does not break", () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("denied"); } });
  try {
    assert.equal(loadStoredSelection(), null);
    assert.doesNotThrow(() => storeSelection("x"));
  } finally {
    if (before) Object.defineProperty(globalThis, "sessionStorage", before);
    else delete globalThis.sessionStorage;
  }
});

// ---- names and deletion rules ---------------------------------------------------------

test("cleanName and uniqueName", () => {
  assert.equal(cleanName("  Casa  "), "Casa");
  assert.equal(cleanName("   "), null);
  assert.equal(cleanName(null), null);
  assert.equal(uniqueName("Casa", ["Altro"]), "Casa");
  assert.equal(uniqueName("Casa", ["Casa"]), "Casa 2");
  assert.equal(uniqueName("Casa", ["Casa", "Casa 2"]), "Casa 3");
});

test("deleteBlock: null without rooms; otherwise the rooms to take off", () => {
  assert.equal(deleteBlock("a", [room("climate.x", "b")]), null);
  assert.deepEqual(deleteBlock("a", [room("climate.x", "a"), room("climate.y", "a"), room("climate.z", "b")]), { count: 2, roomIds: ["climate.x", "climate.y"] });
});

test("canEdit: only a non-admin with admin_only on is read-only", () => {
  assert.equal(canEdit({ options: { admin_only: true } }, { user: { is_admin: false } }), false);
  assert.equal(canEdit({ options: { admin_only: true } }, { user: { is_admin: true } }), true);
  assert.equal(canEdit({ options: { admin_only: false } }, { user: { is_admin: false } }), true);
  assert.equal(canEdit({ options: { admin_only: true } }, {}), true); // unknown user: the server decides
});

test("errorMessage: generic text, plus the detail text when there is one", () => {
  const t = createT({ language: "en" });
  assert.match(errorMessage(t, new EditorError("conflict", "x")), /modified elsewhere/);
  assert.match(errorMessage(t, new EditorError("invalid_format", "x", "bad_program")), /not valid.*Check the name/);
  assert.equal(errorMessage(t, new Error("boom")), "boom");
});

// ---- actions through the API (fake hass) ----------------------------------------------------

const saved = [];
const saveHass = () => makeHass({ ws: { "cronotermostato/save_program": (msg) => { saved.push(msg); return { program_id: msg.program_id ?? "new1", revision: "r1" }; } } });

test("createNewProgram: an empty program, seven empty days, no program_id, no revision", async () => {
  saved.length = 0;
  const hass = saveHass();
  assert.equal(await createNewProgram(hass, "Casa"), "new1");
  const [msg] = saved;
  assert.equal(msg.name, "Casa");
  assert.equal("program_id" in msg, false);
  assert.equal("expected_revision" in msg, false);
  assert.equal(msg.week.length, 7);
  assert.ok(msg.week.every((d) => d.length === 0));
  assert.deepEqual(msg.holiday, []);
});

const withBands = prog("p", "Casa", {
  week: [[{ start: "08:00", end: "09:00", mode: "heat", temperature: 20, preset: "eco" }, { start: "09:00", end: "10:00", mode: "off", auto: true }], [], [], [], [], [], []],
  holiday: [{ start: "10:00", end: "11:00", mode: "off" }],
});

test("duplicateProgram: same bands (no automatic ones), new name, created without id", async () => {
  saved.length = 0;
  await duplicateProgram(saveHass(), withBands, "Casa (copia)");
  const [msg] = saved;
  assert.equal("program_id" in msg, false);
  assert.equal(msg.name, "Casa (copia)");
  assert.deepEqual(msg.week[0], [{ start: "08:00", end: "09:00", mode: "heat", temperature: 20, preset: "eco" }]);
  assert.deepEqual(msg.holiday, [{ start: "10:00", end: "11:00", mode: "off" }]);
});

test("renameProgram: same content, program id and the revision that was read", async () => {
  saved.length = 0;
  await renameProgram(saveHass(), withBands, "Nuovo nome");
  const [msg] = saved;
  assert.equal(msg.program_id, "p");
  assert.equal(msg.expected_revision, "rev-p");
  assert.equal(msg.name, "Nuovo nome");
  assert.equal(msg.week[0].length, 1);
});

test("renameProgram: a conflict reaches the caller as a conflict", async () => {
  const hass = makeHass({ ws: { "cronotermostato/save_program": () => { throw { code: "conflict", message: "stale" }; } } });
  await assert.rejects(renameProgram(hass, withBands, "X"), (e) => e.code === "conflict");
});

test("removeProgram: refuses a program with rooms without calling the server", async () => {
  const hass = makeHass({ ws: { "cronotermostato/delete_program": {} } });
  await assert.rejects(removeProgram(hass, prog("p", "P"), [room("climate.x", "p")]), (e) => e.blocked.count === 1);
  assert.equal(hass.wsCount("cronotermostato/delete_program"), 0);
});

test("removeProgram: without rooms deletes with the revision", async () => {
  const hass = makeHass({ ws: { "cronotermostato/delete_program": {} } });
  await removeProgram(hass, prog("p", "P"), [room("climate.x", "other")]);
  assert.deepEqual(hass.wsCalls, [{ type: "cronotermostato/delete_program", program_id: "p", expected_revision: "rev-p" }]);
});

test("unassignRooms: keeps going after a failure and reports it", async () => {
  const hass = makeHass({ ws: { "cronotermostato/unassign": (m) => { if (m.climate_entity_id === "climate.b") throw { code: "not_found", message: "x" }; return {}; } } });
  const { done, failed } = await unassignRooms(hass, ["climate.a", "climate.b", "climate.c"]);
  assert.deepEqual(done, ["climate.a", "climate.c"]);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].id, "climate.b");
  assert.equal(failed[0].error.code, "not_found");
});

// ---- rendering: what reaches the template -------------------------------------------------

// Walks a Lit TemplateResult: static strings and bound values, recursively.
function flatten(result, out = { strings: [], values: [] }) {
  if (result === null || result === undefined || typeof result === "boolean") return out;
  if (Array.isArray(result)) { result.forEach((r) => flatten(r, out)); return out; }
  if (typeof result === "object" && "strings" in result) {
    out.strings.push(...result.strings);
    result.values.forEach((v) => flatten(v, out));
    return out;
  }
  if (typeof result === "function") return out; // event handlers
  out.values.push(result);
  return out;
}

const noop = () => {};
function view(summaries, overrides = {}) {
  const hass = { language: "en" };
  return {
    t: createT(hass), tn: (k, c, p) => tn(hass, k, c, p), status: "ready", error: null, summaries, selectedId: summaries[0]?.id ?? null, canEdit: true,
    on: { select: noop, create: noop, rename: noop, duplicate: noop, remove: noop, retry: noop }, ...overrides,
  };
}
const sum = (id, name, roomCount = 0, warnings = 0) => ({ id, name, roomCount, roomIds: [], warnings });

test("render: a hostile name is only a bound value, never part of the static markup", () => {
  const { strings, values } = flatten(renderProgramList(view([sum("a", HOSTILE, 2, 1)])));
  const staticMarkup = strings.join("");
  assert.ok(!staticMarkup.includes("<img"), "static template must not contain the name");
  assert.ok(!staticMarkup.includes("onerror"));
  // it appears as plain strings (text/attribute bindings): name, title and aria-label
  assert.ok(values.includes(HOSTILE), "name bound as text");
  assert.ok(values.some((v) => typeof v === "string" && v.startsWith(`${HOSTILE},`)), "aria-label is a plain string");
});

test("render: no value that carries markup is produced from a name (no template/unsafe directive)", () => {
  const result = flatten(renderProgramList(view([sum("a", "<script>alert(1)</script>"), sum("b", '"><img src=x onerror=alert(1)>')])));
  for (const v of result.values) assert.notEqual(typeof v?._$litDirective$, "function");
  assert.ok(!result.strings.join("").includes("<script"));
});

test("render: very long name and emoji go through unchanged (truncation is CSS + title)", () => {
  const long = "Camera ".repeat(300);
  const emoji = "🔥 Salotto 🛋️ 👨‍👩‍👧";
  const { values } = flatten(renderProgramList(view([sum("a", long), sum("b", emoji)])));
  assert.ok(values.includes(long));
  assert.ok(values.includes(emoji));
});

test("render: states", () => {
  const text = (v) => { const f = flatten(renderProgramList(v)); return f.strings.join("|"); };
  assert.match(text(view([], { status: "loading" })), /role="status"/);
  assert.match(text(view([], { status: "not_loaded" })), /role="status"/);
  assert.match(text(view([], { status: "error", error: new EditorError("network", "down") })), /role="alert"/);
  const empty = flatten(renderProgramList(view([], { status: "empty" })));
  assert.ok(empty.values.includes("No programs yet. Create the first one to start."));
  // loading shows no list
  assert.ok(!text(view([], { status: "loading" })).includes("<ul"));
});

test("render: the selected row is marked by aria-current, an icon and text, not by colour alone", () => {
  const f = flatten(renderProgramList(view([sum("a", "A"), sum("b", "B")], { selectedId: "b" })));
  assert.ok(f.values.includes("true") && f.values.includes("false"));
  assert.ok(f.values.some((v) => v === "B, 0 rooms, selected"), "aria-label says selected");
  assert.ok(f.values.some((v) => v === "A, 0 rooms"));
});

test("render: actions off without a selection or without permission", () => {
  const strings = (v) => flatten(renderProgramList(v));
  // `?disabled=` bindings get a boolean value; read them in order: new, rename, duplicate, delete
  const flags = (v) => {
    const out = [];
    const walk = (r) => { if (Array.isArray(r)) r.forEach(walk); else if (r && typeof r === "object" && "strings" in r) { r.strings.forEach((s, i) => { if (/\?disabled=$/.test(s)) out.push(r.values[i]); }); r.values.forEach(walk); } };
    walk(renderProgramList(v));
    return out;
  };
  assert.deepEqual(flags(view([sum("a", "A")])), [false, false, false, false]);
  assert.deepEqual(flags(view([sum("a", "A")], { selectedId: null })), [false, true, true, true]);
  assert.deepEqual(flags(view([sum("a", "A")], { canEdit: false })), [true, true, true, true]);
  assert.ok(strings(view([sum("a", "A")], { canEdit: false })).values.includes("Only administrators can edit programs."));
});
