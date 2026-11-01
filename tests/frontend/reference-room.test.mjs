import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { climateRooms } from "../../custom_components/cronotermostato/frontend/lib/climate.js";
import it from "../../custom_components/cronotermostato/frontend/i18n/it.js";
import en from "../../custom_components/cronotermostato/frontend/i18n/en.js";
import {
  ALL,
  REFERENCE_KEY,
  defaultReference,
  resolveReference,
  referenceRooms,
  referenceOptions,
  presetChoices,
  referenceHintKey,
  loadReference,
  storeReference,
} from "../../custom_components/cronotermostato/frontend/lib/reference-room.js";

const state = (name, extra = {}) => ({ state: "heat", attributes: { friendly_name: name, hvac_modes: ["heat", "off"], ...extra } });
const hass = (extra = {}) => ({
  states: {
    "climate.b": state("Bagno", { preset_modes: ["eco", "comfort"] }),
    "climate.a": state("Altra", { preset_modes: ["away", "eco"] }),
    "climate.c": state("Cucina"),
  },
  entities: { "climate.b": { area_id: "ar2" }, "climate.a": { area_id: "ar1" } },
  areas: { ar1: { name: "Zona notte" }, ar2: { name: "Giorno" } },
  ...extra,
});
const rooms = () => climateRooms(hass());
const ids = (list) => new Set(list);

test("default: assigned rooms -> all assigned; else first assigned elsewhere; else none", () => {
  const climate = rooms();
  assert.equal(defaultReference({ climate, assignedIds: ids(["climate.b"]), elsewhereIds: ids(["climate.c"]) }), ALL);
  assert.equal(defaultReference({ climate, assignedIds: ids([]), elsewhereIds: ids(["climate.c", "climate.b"]) }), "climate.b");
  assert.equal(defaultReference({ climate, assignedIds: ids([]), elsewhereIds: ids([]) }), null);
  // an assigned room that HA no longer has does not count
  assert.equal(defaultReference({ climate, assignedIds: ids(["climate.gone"]), elsewhereIds: ids([]) }), null);
});

test("resolve: a stored room wins only if it exists; ALL only with assigned rooms", () => {
  const climate = rooms();
  const base = { climate, assignedIds: ids(["climate.b"]), elsewhereIds: ids([]) };
  assert.equal(resolveReference({ ...base, stored: "climate.c" }), "climate.c");
  assert.equal(resolveReference({ ...base, stored: "climate.gone" }), ALL);
  assert.equal(resolveReference({ ...base, stored: ALL }), ALL);
  assert.equal(resolveReference({ ...base, assignedIds: ids([]), stored: ALL }), null);
  assert.equal(resolveReference({ ...base, stored: 42 }), ALL);
});

test("referenceRooms: all = assigned ones, a room = that room, null = nothing", () => {
  const climate = rooms();
  assert.deepEqual(referenceRooms(ALL, climate, ids(["climate.b", "climate.a"])).map((r) => r.id), ["climate.a", "climate.b"]);
  assert.deepEqual(referenceRooms("climate.c", climate, ids([])).map((r) => r.id), ["climate.c"]);
  assert.deepEqual(referenceRooms(null, climate, ids(["climate.b"])), []);
  assert.deepEqual(referenceRooms("climate.gone", climate, ids([])), []);
});

test("options: every climate once; assigned first; 'all' only when there are assigned rooms; label with area", () => {
  const climate = rooms();
  const none = referenceOptions({ climate, assignedIds: ids([]), hass: hass() });
  assert.equal(none.all, false);
  assert.deepEqual(none.assigned, []);
  assert.equal(none.others.length, 3);
  const some = referenceOptions({ climate, assignedIds: ids(["climate.c"]), hass: hass() });
  assert.equal(some.all, true);
  assert.deepEqual(some.assigned.map((o) => o.id), ["climate.c"]);
  assert.deepEqual(some.others.map((o) => o.id), ["climate.b", "climate.a"], "sorted by area (Giorno, Zona notte), rooms without area last in the group");
  assert.equal(some.others[0].label, "Bagno (Giorno)");
  assert.equal(some.assigned[0].label, "Cucina");
  assert.equal(some.assigned.length + some.others.length, 3);
});

test("preset choices: single room, union (sorted, unique), empty room, no room", () => {
  const climate = rooms();
  const one = presetChoices({ rooms: referenceRooms("climate.a", climate, ids([])), current: null });
  assert.deepEqual(one.presets, ["away", "eco"]);
  assert.equal(one.unavailable, false);
  const union = presetChoices({ rooms: climate.filter((r) => r.id !== "climate.c"), current: "eco" });
  assert.deepEqual(union.presets, ["away", "comfort", "eco"]);
  const empty = presetChoices({ rooms: referenceRooms("climate.c", climate, ids([])), current: null });
  assert.deepEqual(empty.presets, []);
  assert.equal(empty.noPresets, true);
  assert.equal(empty.hasRooms, true);
  const nobody = presetChoices({ rooms: [], current: null });
  assert.equal(nobody.hasRooms, false);
  assert.equal(nobody.noPresets, false);
});

test("a current value that is not offered is kept and flagged; empty and absent are not", () => {
  const climate = rooms();
  const rs = referenceRooms("climate.b", climate, ids([]));
  assert.equal(presetChoices({ rooms: rs, current: "away" }).unavailable, true);
  assert.equal(presetChoices({ rooms: rs, current: "eco" }).unavailable, false);
  assert.equal(presetChoices({ rooms: rs, current: "" }).unavailable, false);
  assert.equal(presetChoices({ rooms: rs, current: null }).unavailable, false);
  assert.equal(presetChoices({ rooms: [], current: "away" }).unavailable, false, "without a room nothing can be judged");
  assert.equal(presetChoices({ rooms: [], current: "away" }).current, "away");
});

test("hint key: only when no room is chosen", () => {
  assert.equal(referenceHintKey(null), "reference.pick");
  assert.equal(referenceHintKey(ALL), null);
  assert.equal(referenceHintKey("climate.a"), null);
});

test("every key used by the module exists in it and en with the same placeholders", () => {
  for (const key of ["reference.label", "reference.pick", "reference.choose", "reference.all", "reference.group_assigned", "reference.group_others", "reference.help",
    "room.preset_none", "band.preset_free", "band.preset_free_label", "band.preset_unavailable_in", "band.preset_unavailable_all", "band.preset_unknown_room", "band.preset_room_empty", "band.preset_need_room"]) {
    assert.ok(key in it && key in en, key);
    assert.deepEqual([...it[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), key);
  }
});

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}

test("storage: only the room id per program; a bad value or a throwing storage is ignored", () => {
  const s = fakeStorage();
  assert.equal(loadReference("p1", s), null);
  storeReference("p1", "climate.a", s);
  storeReference("p2", "climate.b", s);
  assert.equal(loadReference("p1", s), "climate.a");
  assert.deepEqual(JSON.parse(s.data[REFERENCE_KEY]), { p1: "climate.a", p2: "climate.b" });
  storeReference("p1", null, s);
  assert.equal(loadReference("p1", s), null);
  assert.equal(loadReference("p2", s), "climate.b");
  s.data[REFERENCE_KEY] = "{not json";
  assert.equal(loadReference("p2", s), null);
  s.data[REFERENCE_KEY] = JSON.stringify({ p2: { a: 1 }, p3: 7 });
  assert.equal(loadReference("p2", s), null);
  assert.equal(loadReference("p3", s), null);
  const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(loadReference("p1", boom), null);
  assert.doesNotThrow(() => storeReference("p1", "climate.a", boom));
});

test("storage: ids that look like object keys of the prototype are harmless", () => {
  const s = fakeStorage();
  storeReference("__proto__", "climate.a", s);
  assert.equal(loadReference("constructor", s), null);
  assert.equal(loadReference("toString", s), null);
});
