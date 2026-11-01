import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../../custom_components/cronotermostato/frontend/lib/store.js";
import { makeHass, flush } from "./fake-hass.mjs";

const program = (id, name, revision = "r") => ({ program_id: id, name, revision, week: [[], [], [], [], [], [], []], holiday: [], week_full: [], holiday_full: [] });
const payload = (programs = [], rooms = []) => ({ programs, rooms, country: "IT", subdiv: null, options: { admin_only: true } });

function setup(handlers = {}) {
  mock.timers.enable({ apis: ["setTimeout"] });
  const hass = makeHass({ ws: { "cronotermostato/state": payload([program("b", "Beta"), program("a2", "Alfa"), program("a1", "Alfa")]), ...handlers } });
  const store = createStore();
  return { hass, store };
}
const settle = async () => { for (let i = 0; i < 5; i++) await flush(); };
afterEach(() => mock.timers.reset());

test("start loads the state: loading flag, stable order by name then id", async () => {
  const { hass, store } = setup();
  assert.equal(store.getState().loading, true);
  store.start(hass);
  await settle();
  const s = store.getState();
  assert.equal(s.loading, false);
  assert.equal(s.error, null);
  assert.equal(s.notLoaded, false);
  assert.deepEqual(s.programs.map((p) => p.program_id), ["a1", "a2", "b"]);
  assert.equal(s.country, "IT");
  assert.deepEqual(s.options, { admin_only: true });
  assert.equal(hass.activeSubs().length, 1);
  store.stop();
});

test("listeners are notified and can be removed", async () => {
  const { hass, store } = setup();
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.start(hass);
  await settle();
  assert.ok(calls >= 1);
  off();
  const before = calls;
  hass.emit();
  mock.timers.tick(250);
  await settle();
  assert.equal(calls, before);
  store.stop();
});

test("two close changed events produce a single state read, after 250 ms", async () => {
  const { hass, store } = setup();
  store.start(hass);
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), 1);
  hass.emit();
  mock.timers.tick(100);
  hass.emit();
  mock.timers.tick(200);
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), 1);
  mock.timers.tick(60);
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), 2);
  store.stop();
});

test("a refresh during a read waits for it and then reads once more", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { hass, store } = setup();
  let first = true;
  hass.wsHandlers["cronotermostato/state"] = async () => {
    if (first) { first = false; await gate; return payload([program("old", "Old")]); }
    return payload([program("new", "New")]);
  };
  store.start(hass);
  await flush();
  store.refresh();
  store.refresh();
  await flush();
  assert.equal(hass.wsCount("cronotermostato/state"), 1); // no parallel reads
  release();
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), 2); // the two refreshes became one read
  assert.deepEqual(store.getState().programs.map((p) => p.program_id), ["new"]);
  store.stop();
});

test("a changed event during a read gives one more read", async () => {
  let release;
  const { hass, store } = setup();
  store.start(hass);
  await settle();
  const gate = new Promise((r) => { release = r; });
  let slow = true;
  hass.wsHandlers["cronotermostato/state"] = async () => {
    if (slow) { slow = false; await gate; }
    return payload([program("a", "A")]);
  };
  store.refresh();
  await flush();
  hass.emit();
  mock.timers.tick(250);
  await flush();
  assert.equal(hass.wsCount("cronotermostato/state"), 2);
  release();
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), 3);
  store.stop();
});

test("not_loaded: stale flag, retries, and the subscription resumes", async () => {
  const { hass, store } = setup();
  let loaded = false;
  hass.wsHandlers["cronotermostato/state"] = () => {
    if (!loaded) throw { code: "not_loaded", message: "no" };
    return payload([program("a", "A")]);
  };
  hass.subscribeError = { code: "not_loaded", message: "no" };
  store.start(hass);
  await settle();
  let s = store.getState();
  assert.equal(s.notLoaded, true);
  assert.equal(s.loading, false);
  assert.equal(hass.activeSubs().length, 0);
  // Still not loaded after the first retry.
  mock.timers.tick(5000);
  await settle();
  assert.equal(store.getState().notLoaded, true);
  // The entry comes back: the next retry reads the state and subscribes again.
  loaded = true;
  hass.subscribeError = null;
  mock.timers.tick(30000);
  await settle();
  s = store.getState();
  assert.equal(s.notLoaded, false);
  assert.equal(s.error, null);
  assert.deepEqual(s.programs.map((p) => p.program_id), ["a"]);
  assert.equal(hass.activeSubs().length, 1);
  // No more retries once recovered.
  const reads = hass.wsCount("cronotermostato/state");
  mock.timers.tick(120000);
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), reads);
  store.stop();
});

test("a changed event after an entry reload rereads the state without duplicating the subscription", async () => {
  const { hass, store } = setup();
  store.start(hass);
  await settle();
  assert.equal(hass.activeSubs().length, 1);
  // The server side reloaded the entry: the editor is told by `changed`, and reads again.
  hass.wsHandlers["cronotermostato/state"] = payload([program("n", "New")]);
  hass.emit();
  mock.timers.tick(250);
  await settle();
  assert.deepEqual(store.getState().programs.map((p) => p.program_id), ["n"]);
  assert.equal(hass.activeSubs().length, 1); // not duplicated
  store.stop();
});

test("reconnection of the socket rereads the state", async () => {
  const { hass, store } = setup();
  store.start(hass);
  await settle();
  [...hass.readyListeners].forEach((fn) => fn());
  mock.timers.tick(250);
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), 2);
  store.stop();
});

test("a network error is kept as error and retried", async () => {
  const { hass, store } = setup();
  let fail = true;
  hass.wsHandlers["cronotermostato/state"] = () => {
    if (fail) throw new Error("offline");
    return payload([program("a", "A")]);
  };
  store.start(hass);
  await settle();
  assert.equal(store.getState().error.code, "network");
  assert.equal(store.getState().loading, false);
  fail = false;
  mock.timers.tick(5000);
  await settle();
  assert.equal(store.getState().error, null);
  assert.equal(store.getState().programs.length, 1);
  store.stop();
});

test("other errors are shown but not retried", async () => {
  const { hass, store } = setup();
  hass.wsHandlers["cronotermostato/state"] = () => { throw { code: "unauthorized", message: "no" }; };
  store.start(hass);
  await settle();
  assert.equal(store.getState().error.code, "unauthorized");
  mock.timers.tick(120000);
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), 1);
  store.stop();
});

test("stop leaves no handler, timer or late update", async () => {
  const { hass, store } = setup();
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  store.start(hass);
  await settle();
  hass.emit(); // pending debounce
  store.stop();
  assert.equal(hass.activeSubs().length, 0);
  assert.equal(hass.readyListeners.size, 0);
  const before = calls;
  const reads = hass.wsCount("cronotermostato/state");
  mock.timers.tick(120000);
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), reads);
  assert.equal(calls, before);
});

test("stop while the first read is in flight ignores its answer and the subscription", async () => {
  const { hass, store } = setup();
  let resolve;
  hass.wsHandlers["cronotermostato/state"] = () => new Promise((r) => { resolve = r; });
  store.start(hass);
  await flush();
  store.stop();
  resolve(payload([program("a", "A")]));
  await settle();
  assert.equal(store.getState().programs.length, 0);
  assert.equal(hass.activeSubs().length, 0);
});

test("stop during a pending retry after not_loaded cancels it", async () => {
  const { hass, store } = setup();
  hass.wsHandlers["cronotermostato/state"] = () => { throw { code: "not_loaded", message: "x" }; };
  store.start(hass);
  await settle();
  store.stop();
  const reads = hass.wsCount("cronotermostato/state");
  mock.timers.tick(120000);
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), reads);
});

test("start twice does not duplicate the subscription", async () => {
  const { hass, store } = setup();
  store.start(hass);
  store.start(hass);
  await settle();
  assert.equal(hass.activeSubs().length, 1);
  store.stop();
  assert.equal(hass.activeSubs().length, 0);
});

test("setHass uses the newest hass for the next read", async () => {
  const { hass, store } = setup();
  store.start(hass);
  await settle();
  const hass2 = makeHass({ ws: { "cronotermostato/state": payload([program("z", "Z")]) } });
  hass2.connection = hass.connection;
  store.setHass(hass2);
  store.refresh();
  await settle();
  assert.deepEqual(store.getState().programs.map((p) => p.program_id), ["z"]);
  assert.equal(hass.activeSubs().length, 1); // same connection: no resubscription
  store.stop();
});
