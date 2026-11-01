import test from "node:test";
import assert from "node:assert/strict";
import * as api from "../../custom_components/cronotermostato/frontend/lib/api.js";
import { makeHass, flush } from "./fake-hass.mjs";

const { EditorError } = api;

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail("expected a rejection");
}

test("loadState returns the payload with safe defaults", async () => {
  const hass = makeHass({ ws: { "cronotermostato/state": { programs: [{ program_id: "a" }], rooms: [], country: "IT", subdiv: null, options: { admin_only: true } } } });
  const state = await api.loadState(hass);
  assert.equal(state.programs[0].program_id, "a");
  assert.equal(state.country, "IT");
  assert.deepEqual(state.options, { admin_only: true });
  const bare = await api.loadState(makeHass({ ws: { "cronotermostato/state": {} } }));
  assert.deepEqual(bare.programs, []);
  assert.deepEqual(bare.rooms, []);
  assert.deepEqual(bare.options, { admin_only: true });
});

test("WebSocket errors become EditorError with code and detailCode", async () => {
  const cases = [
    [{ code: "conflict", message: "elsewhere" }, "conflict"],
    [{ code: "not_found", message: "x" }, "not_found"],
    [{ code: "invalid_format", message: "Overlapping", detail_code: "overlap" }, "invalid_format"],
    [{ code: "unauthorized", message: "no" }, "unauthorized"],
    [{ code: "not_loaded", message: "no" }, "not_loaded"],
  ];
  for (const [server, code] of cases) {
    const hass = makeHass({ ws: { "cronotermostato/state": () => { throw server; } } });
    const err = await rejection(api.loadState(hass));
    assert.ok(err instanceof EditorError, code);
    assert.equal(err.code, code);
    assert.equal(err.message, server.message);
    assert.equal(err.detailCode, server.detail_code ?? null);
  }
});

test("errors without a string code are network errors; other server codes are invalid_format", async () => {
  for (const thrown of [3, new Error("boom"), undefined, { code: 3 }]) {
    const hass = makeHass({ ws: { "cronotermostato/state": () => { throw thrown; } } });
    const err = await rejection(api.loadState(hass));
    assert.equal(err.code, "network", String(thrown));
  }
  const hass = makeHass({ ws: { "cronotermostato/state": () => { throw { code: "home_assistant_error", message: "m" }; } } });
  assert.equal((await rejection(api.loadState(hass))).code, "invalid_format");
});

test("an EditorError passes through unchanged", async () => {
  const original = new EditorError("conflict", "x", "d");
  const hass = makeHass({ ws: { "cronotermostato/state": () => { throw original; } } });
  assert.equal(await rejection(api.loadState(hass)), original);
});

test("saveProgram sends only the given fields and returns ids", async () => {
  const hass = makeHass({ ws: { "cronotermostato/save_program": { program_id: "casa", revision: "abc" } } });
  const week = [[], [], [], [], [], [], []];
  const created = await api.saveProgram(hass, { name: "Casa", week, holiday: [] });
  assert.deepEqual(created, { programId: "casa", revision: "abc" });
  assert.deepEqual(hass.wsCalls[0], { type: "cronotermostato/save_program", name: "Casa", week, holiday: [] });
  await api.saveProgram(hass, { programId: "casa", name: "Casa", week, holiday: [], expectedRevision: "abc" });
  assert.equal(hass.wsCalls[1].program_id, "casa");
  assert.equal(hass.wsCalls[1].expected_revision, "abc");
});

test("saveProgram never sends automatic bands", async () => {
  const hass = makeHass({ ws: { "cronotermostato/save_program": { program_id: "p", revision: "r" } } });
  const auto = { start: "00:00", end: "07:00", mode: "off", auto: true };
  const user = { start: "07:00", end: "08:00", mode: "heat", temperature: 20 };
  await api.saveProgram(hass, { name: "P", week: [[auto, user], [], [], [], [], [], []], holiday: [auto] });
  assert.deepEqual(hass.wsCalls[0].week[0], [user]);
  assert.deepEqual(hass.wsCalls[0].holiday, []);
});

test("previewDay sends serialized bands without auto and returns the bands", async () => {
  const hass = makeHass({ ws: { "cronotermostato/preview_day": { bands: [{ start: "00:00", end: "24:00", mode: "off", auto: true }] } } });
  const out = await api.previewDay(hass, [{ start: "07:00", end: "08:00", mode: "heat", temperature: "20.5", preset: "", auto: false }]);
  assert.equal(out.length, 1);
  assert.deepEqual(hass.wsCalls[0].bands, [{ start: "07:00", end: "08:00", mode: "heat", temperature: 20.5 }]);
});

test("delete, assign, unassign and countries use the right commands", async () => {
  const hass = makeHass({ ws: {
    "cronotermostato/delete_program": null,
    "cronotermostato/assign": null,
    "cronotermostato/unassign": null,
    "cronotermostato/countries": { IT: [] },
  } });
  await api.deleteProgram(hass, "casa", "rev");
  await api.assign(hass, "casa", "climate.sala");
  await api.unassign(hass, "climate.sala");
  assert.deepEqual(await api.loadCountries(hass), { IT: [] });
  assert.deepEqual(hass.wsCalls.slice(0, 3), [
    { type: "cronotermostato/delete_program", program_id: "casa", expected_revision: "rev" },
    { type: "cronotermostato/assign", program_id: "casa", climate_entity_id: "climate.sala" },
    { type: "cronotermostato/unassign", climate_entity_id: "climate.sala" },
  ]);
  await api.deleteProgram(hass, "casa");
  assert.ok(!("expected_revision" in hass.wsCalls[4]));
});

test("room services", async () => {
  const hass = makeHass();
  await api.pauseRoom(hass, "climate.a");
  await api.resumeRoom(hass, "climate.a");
  await api.resumeAuto(hass, "climate.a");
  await api.setManual(hass, "climate.a", { mode: "heat", temperature: 21, preset: "home" });
  await api.setManual(hass, "climate.a", { mode: "off", temperature: 21, preset: "home" });
  await api.setManual(hass, "climate.a", { mode: "cool", temperature: null, preset: "" });
  assert.deepEqual(hass.serviceCalls.map((c) => [c.domain, c.service]), [
    ["cronotermostato", "pause"], ["cronotermostato", "resume"], ["cronotermostato", "resume_auto"],
    ["cronotermostato", "set_manual"], ["cronotermostato", "set_manual"], ["cronotermostato", "set_manual"],
  ]);
  assert.deepEqual(hass.serviceCalls[3].data, { climate_entity_id: "climate.a", mode: "heat", temperature: 21, preset: "home" });
  assert.deepEqual(hass.serviceCalls[4].data, { climate_entity_id: "climate.a", mode: "off" });
  assert.deepEqual(hass.serviceCalls[5].data, { climate_entity_id: "climate.a", mode: "cool" });
});

test("service errors become EditorError", async () => {
  const hass = makeHass();
  hass.serviceHandler = () => { throw { code: "service_validation_error", message: "bad" }; };
  const err = await rejection(api.pauseRoom(hass, "climate.a"));
  assert.ok(err instanceof EditorError);
  assert.equal(err.code, "invalid_format");
  hass.serviceHandler = () => { throw new Error("offline"); };
  assert.equal((await rejection(api.pauseRoom(hass, "climate.a"))).code, "network");
});

test("subscribe delivers changed events and cancel leaves no handler", async () => {
  const hass = makeHass();
  let changes = 0;
  const cancel = api.subscribe(hass, () => { changes += 1; });
  await flush();
  assert.equal(hass.activeSubs().length, 1);
  assert.equal(hass.subs[0].msg.type, "cronotermostato/subscribe");
  hass.emit({ type: "changed" });
  hass.emit({ type: "other" });
  assert.equal(changes, 1);
  cancel();
  assert.equal(hass.activeSubs().length, 0);
  assert.equal(hass.readyListeners.size, 0);
  hass.emit();
  assert.equal(changes, 1);
  cancel(); // idempotent
  assert.equal(hass.subs[0].unsubCalls, 1);
});

test("cancelling before the subscription is established still unsubscribes", async () => {
  const hass = makeHass();
  const cancel = api.subscribe(hass, () => {});
  cancel();
  await flush();
  assert.equal(hass.activeSubs().length, 0);
  assert.equal(hass.subs.length === 0 || hass.subs[0].unsubCalls === 1, true);
});

test("subscribe reports a failed subscription once, mapped", async () => {
  const hass = makeHass();
  hass.subscribeError = { code: "not_loaded", message: "no" };
  const errors = [];
  api.subscribe(hass, () => {}, { onError: (e) => errors.push(e) });
  await flush();
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof EditorError);
  assert.equal(errors[0].code, "not_loaded");
});

test("a failed subscription after cancel is not reported", async () => {
  const hass = makeHass();
  hass.subscribeError = { code: "not_loaded", message: "no" };
  const errors = [];
  const cancel = api.subscribe(hass, () => {}, { onError: (e) => errors.push(e) });
  cancel();
  await flush();
  assert.equal(errors.length, 0);
});

test("a reconnection (ready) is reported as onReconnect, until cancelled", async () => {
  const hass = makeHass();
  let ready = 0;
  const cancel = api.subscribe(hass, () => {}, { onReconnect: () => { ready += 1; } });
  await flush();
  [...hass.readyListeners].forEach((fn) => fn());
  assert.equal(ready, 1);
  cancel();
  assert.equal(hass.readyListeners.size, 0);
});
