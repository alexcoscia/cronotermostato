import "./dom-stub.mjs";
import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { makeHass, flush } from "./fake-hass.mjs";

const FE = "../../custom_components/cronotermostato/frontend";
const { createSharedStore } = await import(`${FE}/lib/store.js`);
const { createRowsMemo, normalizeConfig } = await import(`${FE}/lib/card-config.js`);

const settle = async () => { for (let i = 0; i < 5; i++) await flush(); };
const program = (id, name) => ({ program_id: id, name, revision: "r", week: [[], [], [], [], [], [], []], holiday: [], week_full: [], holiday_full: [] });
const payload = { programs: [program("p1", "Casa")], rooms: [{ climate_entity_id: "climate.a", program_id: "p1", status: "ok" }], country: "IT", subdiv: null, options: { admin_only: true } };

afterEach(() => mock.timers.reset());

// ---- shared store: reference counting --------------------------------------------------------------

test("two cards share ONE subscription and ONE state read", async () => {
  const hass = makeHass({ ws: { "cronotermostato/state": payload } });
  const shared = createSharedStore();
  const a = shared.acquire(hass);
  const b = shared.acquire(hass);
  assert.equal(a, b);
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), 1);
  assert.equal(hass.subs.length, 1);
  assert.equal(shared.refs, 2);
  assert.equal(a.getState().loading, false);
  shared.release();
  shared.release();
});

test("removing one card keeps the other one working; removing all cancels the subscription", async () => {
  const hass = makeHass({ ws: { "cronotermostato/state": payload } });
  const shared = createSharedStore();
  const store = shared.acquire(hass);
  shared.acquire(hass);
  await settle();
  shared.release();
  assert.equal(hass.activeSubs().length, 1, "one card left: still subscribed");
  let seen = 0;
  store.subscribe(() => { seen += 1; });
  await store.refresh();
  assert.ok(seen > 0, "the remaining card still gets state");
  shared.release();
  assert.equal(hass.activeSubs().length, 0, "no card left: subscription cancelled");
  assert.equal(hass.subs[0].unsubCalls, 1);
  shared.release(); // extra release is harmless
  assert.equal(shared.refs, 0);
});

test("a card added after all were removed starts the store again", async () => {
  const hass = makeHass({ ws: { "cronotermostato/state": payload } });
  const shared = createSharedStore();
  shared.acquire(hass);
  await settle();
  shared.release();
  assert.equal(hass.activeSubs().length, 0);
  const store = shared.acquire(hass);
  await settle();
  assert.equal(hass.activeSubs().length, 1);
  assert.equal(hass.subs.length, 2);
  assert.equal(hass.wsCount("cronotermostato/state"), 2);
  assert.equal(store.getState().loading, false);
  shared.release();
});

// ---- memoization of the rows -------------------------------------------------------------------------------

const climate = (name) => ({ state: "heat", attributes: { friendly_name: name } });
const ROOMS = [{ climate_entity_id: "climate.a", program_id: "p1", status: "ok" }];
const PROGRAMS = [{ program_id: "p1", name: "Casa" }];

function memoSetup() {
  let calls = 0;
  const compute = (args) => (calls += 1, [{ id: "climate.a", server: ROOMS[0], args }]);
  const memo = createRowsMemo(compute);
  const config = normalizeConfig({});
  const a = climate("A");
  const base = { states: { "climate.a": a, "sensor.x": { state: "1" } }, language: "it", locale: { language: "it" }, themes: { darkMode: false }, config: { time_zone: "UTC" }, entities: {}, devices: {}, areas: {} };
  const run = (hass, extra = {}) => memo({ hass, rooms: ROOMS, programs: PROGRAMS, config, ...extra });
  return { run, base, a, config, calls: () => calls };
}

test("rows are not recomputed when nothing relevant changed in hass", () => {
  const { run, base, calls } = memoSetup();
  const first = run(base);
  const again = run({ ...base, states: { ...base.states, "sensor.x": { state: "2" } } }); // another entity changed
  assert.equal(calls(), 1);
  assert.equal(again.rows, first.rows);
  assert.equal(again.hass, first.hass, "the children keep the same hass, so they do not render again");
});

test("rows are recomputed when a visible climate, language, locale, themes or the data change", () => {
  const { run, base, config, calls } = memoSetup();
  run(base);
  run({ ...base, states: { ...base.states, "climate.a": climate("A2") } });
  assert.equal(calls(), 2, "visible climate state");
  run({ ...base, states: { ...base.states, "climate.a": climate("A2") }, language: "en" });
  assert.equal(calls(), 3, "language");
  run({ ...base, states: { ...base.states, "climate.a": climate("A2") }, language: "en", locale: { language: "en" } });
  assert.equal(calls(), 4, "locale");
  const hass = { ...base, states: { ...base.states, "climate.a": climate("A2") }, language: "en", locale: { language: "en" }, themes: { darkMode: true } };
  run(hass);
  assert.equal(calls(), 5, "themes");
  run(hass, { rooms: [...ROOMS] });
  assert.equal(calls(), 6, "rooms of the store");
  run(hass, { rooms: [...ROOMS], programs: [...PROGRAMS] });
  assert.equal(calls(), 7, "programs of the store");
  run(hass, { rooms: [...ROOMS], programs: [...PROGRAMS], config: { ...config } });
  assert.equal(calls(), 8, "configuration of the card");
});

test("a room that appears or disappears in hass.states recomputes", () => {
  const { run, base, calls } = memoSetup();
  run(base);
  const { "climate.a": _gone, ...states } = base.states;
  run({ ...base, states });
  assert.equal(calls(), 2);
});

// ---- the card element: connect / disconnect ----------------------------------------------------------------

const observers = [];
globalThis.ResizeObserver = class {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
    this.disconnects = 0;
    observers.push(this);
  }
  observe(target) { this.observed.push(target); }
  disconnect() { this.disconnects += 1; }
};

const { CronotermostatoCard } = await import(`${FE}/components/crono-card.js`);

// No browser: Lit gets a fake render root and does not render; the lifecycle code of the card runs for real.
function makeCard(shared, hass, config = {}) {
  const card = new CronotermostatoCard();
  card.createRenderRoot = () => ({});
  card.performUpdate = () => {};
  Object.defineProperty(card, "isConnected", { value: true, configurable: true });
  card._shared = shared;
  card.setConfig(config);
  card.hass = hass;
  return card;
}

test("connecting a card takes a reference of the shared store and observes its size", async () => {
  observers.length = 0;
  const hass = makeHass({ ws: { "cronotermostato/state": payload } });
  const shared = createSharedStore();
  const card = makeCard(shared, hass);
  card.connectedCallback();
  await settle();
  assert.equal(shared.refs, 1);
  assert.equal(hass.activeSubs().length, 1);
  assert.equal(observers.length, 1);
  assert.deepEqual(observers[0].observed, [card]);
  assert.equal(card._state.loading, false, "the card got the state of the store");
  card.disconnectedCallback();
});

test("removing the card releases the store (subscription cancelled) and disconnects the ResizeObserver", async () => {
  observers.length = 0;
  const hass = makeHass({ ws: { "cronotermostato/state": payload } });
  const shared = createSharedStore();
  const card = makeCard(shared, hass);
  card.connectedCallback();
  await settle();
  card.disconnectedCallback();
  assert.equal(shared.refs, 0, "store reference released");
  assert.equal(hass.activeSubs().length, 0, "subscription cancelled");
  assert.equal(observers[0].disconnects, 1, "ResizeObserver disconnected");
  assert.equal(card._resize, null);
  card.disconnectedCallback(); // twice is harmless
  assert.equal(shared.refs, 0);
  assert.equal(observers[0].disconnects, 1);
});

test("two cards on the page: one subscription; removing one keeps the other, removing both cancels it", async () => {
  observers.length = 0;
  const hass = makeHass({ ws: { "cronotermostato/state": payload } });
  const shared = createSharedStore();
  const a = makeCard(shared, hass);
  const b = makeCard(shared, hass, { title: "B" });
  a.connectedCallback();
  b.connectedCallback();
  await settle();
  assert.equal(hass.subs.length, 1);
  assert.equal(hass.wsCount("cronotermostato/state"), 1);
  a.disconnectedCallback();
  assert.equal(hass.activeSubs().length, 1);
  assert.equal(observers[0].disconnects, 1);
  assert.equal(observers[1].disconnects, 0);
  b.disconnectedCallback();
  assert.equal(hass.activeSubs().length, 0);
  assert.equal(observers[1].disconnects, 1);
});

test("a card put back after being removed subscribes again (and a new observer)", async () => {
  observers.length = 0;
  const hass = makeHass({ ws: { "cronotermostato/state": payload } });
  const shared = createSharedStore();
  const card = makeCard(shared, hass);
  card.connectedCallback();
  await settle();
  card.disconnectedCallback();
  card.connectedCallback();
  await settle();
  assert.equal(hass.activeSubs().length, 1);
  assert.equal(hass.subs.length, 2);
  assert.equal(observers.length, 2);
  assert.equal(card._state.loading, false);
  card.disconnectedCallback();
  assert.equal(hass.activeSubs().length, 0);
});

test("switching the card to the editor view releases the shared store", async () => {
  const hass = makeHass({ ws: { "cronotermostato/state": payload } });
  const shared = createSharedStore();
  const card = makeCard(shared, hass);
  card.connectedCallback();
  await settle();
  card.setConfig({ view: "editor" });
  card.willUpdate(new Map([["_config", {}]]));
  assert.equal(shared.refs, 0);
  assert.equal(hass.activeSubs().length, 0);
  card.disconnectedCallback();
  assert.equal(shared.refs, 0);
});

test("the children get stable values: same rows, hass, filter-less props across unrelated hass updates", async () => {
  const hass = makeHass({ states: { "climate.a": { state: "heat", attributes: { friendly_name: "A" } } }, ws: { "cronotermostato/state": payload } });
  const shared = createSharedStore();
  const card = makeCard(shared, hass);
  card.connectedCallback();
  await settle();
  const first = card._view();
  card.hass = { ...hass, states: { ...hass.states, "sensor.x": { state: "9" } } };
  const second = card._view();
  assert.equal(second.rows, first.rows);
  assert.equal(second.hass, first.hass);
  assert.equal(card._getState, card._getState);
  card.disconnectedCallback();
});

test("getCardSize uses the measured height when connected, the estimate otherwise", async () => {
  const hass = makeHass({ ws: { "cronotermostato/state": payload } });
  const card = makeCard(createSharedStore(), hass);
  const estimate = card.getCardSize();
  assert.ok(Number.isInteger(estimate) && estimate >= 1);
  Object.defineProperty(card, "offsetHeight", { value: 325, configurable: true });
  assert.equal(card.getCardSize(), 7);
  Object.defineProperty(card, "offsetHeight", { value: 0, configurable: true });
  assert.equal(card.getCardSize(), estimate);
});

// ---- visual editor of the card ---------------------------------------------------------------------------------

const { CronoCardEditor } = await import(`${FE}/components/crono-card-editor.js`);
const itStrings = (await import(`${FE}/i18n/it.js`)).default;
const enStrings = (await import(`${FE}/i18n/en.js`)).default;

test("the hint of the rooms says that rooms without a program do not appear in the card (it and en)", () => {
  assert.match(itStrings["card.rooms_hint"], /non seguono nessun programma non compaiono/);
  assert.match(enStrings["card.rooms_hint"], /do not follow any program do not appear/);
});

test("the card editor retries the program list once when the first read fails (on the next hass), not in a loop", async () => {
  let fail = true;
  const hass = makeHass({ ws: { "cronotermostato/state": () => { if (fail) throw { code: "network", message: "x" }; return payload; } } });
  const editor = new CronoCardEditor();
  editor.setConfig({ view: "rooms" });
  const changed = new Map([["hass", undefined]]);
  editor.hass = hass;
  editor.willUpdate(changed);
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), 1);
  assert.equal(editor._programs, null, "failed: a text field is shown");
  fail = false;
  editor.willUpdate(changed); // hass changed: one more attempt
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), 2);
  assert.deepEqual(editor._programs, [{ id: "p1", name: "Casa" }]);
  editor.willUpdate(changed); // loaded: nothing more
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), 2);
});

test("the card editor gives up after the retry fails too, and never reads twice at once", async () => {
  const hass = makeHass({ ws: { "cronotermostato/state": () => { throw { code: "network", message: "x" }; } } });
  const editor = new CronoCardEditor();
  editor.hass = hass;
  const changed = new Map([["hass", undefined]]);
  editor.willUpdate(changed);
  editor.willUpdate(changed); // still reading: no second request
  assert.equal(hass.wsCount("cronotermostato/state"), 1);
  await settle();
  editor.willUpdate(changed); // the retry
  await settle();
  for (let i = 0; i < 5; i++) editor.willUpdate(changed);
  await settle();
  assert.equal(hass.wsCount("cronotermostato/state"), 2);
  assert.equal(editor._programs, null);
});

// ---- compact variant -------------------------------------------------------------------------------------------------

test("crono-rooms passes compact to every room card; the room card has the compact property and CSS only", async () => {
  const { CronoRooms } = await import(`${FE}/components/crono-rooms.js`);
  const { CronoRoomCard } = await import(`${FE}/components/crono-room-card.js`);
  const hass = makeHass({ states: { "climate.a": { state: "heat", attributes: { friendly_name: "A" } } } });
  const rooms = new CronoRooms();
  rooms.hass = hass;
  rooms.compact = true;
  rooms.state = { rooms: payload.rooms, programs: payload.programs, loading: false };
  const flat = (r, out = []) => (Array.isArray(r) ? r.forEach((x) => flat(x, out)) : r && typeof r === "object" && "strings" in r ? (out.push(r.strings.join("|")), r.values.forEach((v) => flat(v, out))) : null, out);
  assert.match(flat(rooms.render()).join("\n"), /\?compact=/);
  assert.equal(CronoRoomCard.properties.compact.type, Boolean);
  assert.equal(new CronoRoomCard().compact, false);
  const css = CronoRoomCard.styles.map((s) => s.cssText ?? "").join("\n");
  assert.match(css, /:host\(\[compact\]\) \.next\s*{\s*display: none/);
  assert.match(css, /:host\(\[compact\]\) \.acts\s*{[^}]*grid-template-columns: repeat\(2/);
});

test("rows given by the parent are used as they are (no second roomRows)", async () => {
  const { CronoRooms } = await import(`${FE}/components/crono-rooms.js`);
  const rooms = new CronoRooms();
  const rows = [{ id: "x" }];
  rooms.rows = rows;
  rooms.hass = makeHass();
  assert.equal(rooms._rows(), rows);
});
