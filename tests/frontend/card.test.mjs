import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeHass } from "./fake-hass.mjs";
import { createT } from "../../custom_components/cronotermostato/frontend/lib/i18n.js";
import { roomRows } from "../../custom_components/cronotermostato/frontend/lib/rooms.js";
import it from "../../custom_components/cronotermostato/frontend/i18n/it.js";
import en from "../../custom_components/cronotermostato/frontend/i18n/en.js";

const FE = "../../custom_components/cronotermostato/frontend";
const URL_FE = new URL(`${FE}/`, import.meta.url);

// Same flattening as the rooms tests: the static strings and the bound values of a template.
const flatten = (result, out = { strings: [], values: [] }) => {
  if (result === null || result === undefined || typeof result === "boolean") return out;
  if (Array.isArray(result)) {
    result.forEach((r) => flatten(r, out));
    return out;
  }
  if (typeof result === "object" && "strings" in result) {
    out.strings.push(...result.strings);
    result.values.forEach((v) => flatten(v, out));
    return out;
  }
  if (typeof result === "function") return out;
  out.values.push(result);
  return out;
};
const markup = (result) => flatten(result).strings.join("");
const bound = (result) => flatten(result).values;

const STATES = {
  "climate.soggiorno": { state: "heat", attributes: { friendly_name: "Soggiorno" } },
  "climate.camera": { state: "off", attributes: { friendly_name: "Camera" } },
  "climate.bagno": { state: "heat", attributes: { friendly_name: "Bagno" } },
  "climate.libera": { state: "off", attributes: { friendly_name: "Libera" } },
};
const PROGRAMS = [
  { program_id: "p1", name: "Casa" },
  { program_id: "p2", name: "Estate" },
];
const ROOMS = [
  { climate_entity_id: "climate.soggiorno", program_id: "p1", status: "ok" },
  { climate_entity_id: "climate.camera", program_id: "p2", status: "ok" },
  { climate_entity_id: "climate.bagno", program_id: "p1", status: "paused", paused: true },
];

// ---- 1. configuration -----------------------------------------------------------------------------

test("an empty configuration is valid and shows the compact rooms view", async () => {
  const { normalizeConfig, DEFAULT_VIEW } = await import(`${FE}/lib/card-config.js`);
  assert.equal(DEFAULT_VIEW, "rooms");
  assert.deepEqual(normalizeConfig({}), { view: "rooms", title: "", program_id: null, rooms: null });
  assert.deepEqual(normalizeConfig({ type: "custom:cronotermostato-card", grid_options: { rows: 3 } }), { view: "rooms", title: "", program_id: null, rooms: null });
});

test("a valid configuration is normalized (trimmed, no duplicates, empty list = all)", async () => {
  const { normalizeConfig } = await import(`${FE}/lib/card-config.js`);
  assert.deepEqual(
    normalizeConfig({ view: "editor", title: "  Riscaldamento ", program_id: "p1", rooms: ["climate.a", "climate.b", "climate.a"] }),
    { view: "editor", title: "Riscaldamento", program_id: "p1", rooms: ["climate.a", "climate.b"] },
  );
  assert.equal(normalizeConfig({ rooms: [] }).rooms, null);
  assert.equal(normalizeConfig({ program_id: "" }).program_id, null);
});

test("an invalid configuration raises a clear error", async () => {
  const { normalizeConfig } = await import(`${FE}/lib/card-config.js`);
  const bad = [
    [undefined, /configuration/i],
    [null, /configuration/i],
    [[], /configuration/i],
    ["rooms", /configuration/i],
    [{ view: "grid" }, /Unknown view "grid"/],
    [{ view: 3 }, /view/],
    [{ title: 5 }, /title/],
    [{ program_id: 7 }, /program_id/],
    [{ rooms: "climate.a" }, /rooms/],
    [{ rooms: [1] }, /rooms/],
    [{ rooms: ["sensor.x"] }, /sensor\.x/],
    [{ rooms: ["climate.a", "climate."] }, /climate\./],
    [{ rooms: ["climate.A b"] }, /rooms/],
  ];
  for (const [config, pattern] of bad) assert.throws(() => normalizeConfig(config), (err) => err instanceof Error && pattern.test(err.message), JSON.stringify(config));
});

// ---- 2. the card element ----------------------------------------------------------------------------

async function makeCard(config = {}, hass) {
  const { CronotermostatoCard } = await import(`${FE}/components/crono-card.js`);
  const card = new CronotermostatoCard();
  card.setConfig(config);
  if (hass !== undefined) card.hass = hass;
  return card;
}

test("setConfig throws on an invalid configuration and keeps the old one", async () => {
  const card = await makeCard({ view: "editor" });
  assert.throws(() => card.setConfig({ view: "nope" }), /Unknown view/);
  assert.throws(() => card.setConfig({ rooms: ["light.x"] }), /climate/);
  assert.equal(card._config.view, "editor");
});

test("hass is a property the card accepts", async () => {
  const card = await makeCard({});
  const hass = makeHass({ states: STATES });
  card.hass = hass;
  assert.equal(card.hass, hass);
});

test("getStubConfig is a valid configuration without rooms of its own", async () => {
  const { CronotermostatoCard } = await import(`${FE}/components/crono-card.js`);
  const { normalizeConfig } = await import(`${FE}/lib/card-config.js`);
  const stub = CronotermostatoCard.getStubConfig();
  assert.equal(stub.view, "rooms");
  assert.doesNotThrow(() => normalizeConfig(stub));
  assert.ok(!("rooms" in stub));
});

test("getGridOptions and getCardSize", async () => {
  const card = await makeCard({});
  assert.deepEqual(card.getGridOptions(), { columns: 12, rows: "auto", min_columns: 6 });
  const size = (c) => c.getCardSize();
  assert.ok(Number.isInteger(size(card)) && size(card) >= 1);
  const editor = await makeCard({ view: "editor" });
  assert.ok(size(editor) > size(card));
  const full = await makeCard({}, makeHass({ states: STATES }));
  full._state = { rooms: ROOMS, programs: PROGRAMS, loading: false };
  assert.ok(size(full) > size(card));
  const titled = await makeCard({ title: "Casa" });
  assert.equal(size(titled), size(card) + 1);
});

test("getConfigElement creates the card editor element", async () => {
  const { CronotermostatoCard } = await import(`${FE}/components/crono-card.js`);
  const made = [];
  const previous = document.createElement;
  document.createElement = (name) => (made.push(name), { name });
  try {
    const element = await CronotermostatoCard.getConfigElement();
    assert.equal(element.name, "cronotermostato-card-editor");
    assert.deepEqual(made, ["cronotermostato-card-editor"]);
  } finally {
    document.createElement = previous;
  }
  assert.ok(customElements.get("cronotermostato-card"));
  assert.ok(customElements.get("cronotermostato-card-editor"));
});

// ---- 3. filter of the rooms ----------------------------------------------------------------------------

test("cardRows: only assigned rooms, then the filters on rooms and program", async () => {
  const { cardRows, normalizeConfig } = await import(`${FE}/lib/card-config.js`);
  const rows = roomRows({ hass: { states: STATES }, rooms: ROOMS, programs: PROGRAMS, programId: null });
  const ids = (config) => cardRows(rows, normalizeConfig(config)).map((r) => r.id);
  assert.deepEqual(ids({}).sort(), ["climate.bagno", "climate.camera", "climate.soggiorno"]); // "libera" has no program
  assert.deepEqual(ids({ program_id: "p1" }).sort(), ["climate.bagno", "climate.soggiorno"]);
  assert.deepEqual(ids({ rooms: ["climate.camera", "climate.libera"] }), ["climate.camera"]);
  assert.deepEqual(ids({ rooms: ["climate.soggiorno", "climate.camera"], program_id: "p1" }), ["climate.soggiorno"]);
  assert.deepEqual(ids({ program_id: "nope" }), []);
});

test("the rooms view without hass says it is loading; not_loaded says the integration is not loaded", async () => {
  const card = await makeCard({});
  const waiting = markup(card.render());
  assert.match(waiting, /role="status"/);
  assert.ok(bound(card.render()).includes(createT(undefined)("common.loading")));

  const hass = makeHass({ states: STATES, language: "it" });
  const loaded = await makeCard({}, hass);
  loaded._state = { rooms: [], programs: [], loading: false, error: null, notLoaded: true };
  const out = loaded.render();
  assert.ok(bound(out).includes(it["state.not_loaded"]));
  assert.doesNotMatch(markup(out), /<crono-rooms/);
});

test("the rooms view with no assigned room invites to assign rooms; with filters it says nothing matches", async () => {
  const hass = makeHass({ states: STATES, language: "en" });
  const card = await makeCard({}, hass);
  card._state = { rooms: [], programs: PROGRAMS, loading: false, error: null, notLoaded: false };
  assert.ok(bound(card.render()).includes(en["card.no_rooms"]));
  const filtered = await makeCard({ program_id: "p2", rooms: ["climate.soggiorno"] }, hass);
  filtered._state = { rooms: ROOMS, programs: PROGRAMS, loading: false, error: null, notLoaded: false };
  assert.ok(bound(filtered.render()).includes(en["card.no_match"]));
});

test("the rooms view uses the rooms component, read only, with the filter; names stay bound values", async () => {
  const hass = makeHass({ states: { ...STATES, "climate.camera": { state: "off", attributes: { friendly_name: "<img src=x onerror=alert(1)>" } } }, language: "it" });
  const card = await makeCard({ title: "</h2><script>x</script>", program_id: "p2" }, hass);
  card._state = { rooms: ROOMS, programs: PROGRAMS, loading: false, error: null, notLoaded: false };
  const out = card.render();
  const text = markup(out);
  assert.match(text, /<crono-rooms/);
  assert.doesNotMatch(text, /<script|onerror|<img/);
  assert.ok(bound(out).includes("</h2><script>x</script>"));
  assert.match(text, /compact/);
  assert.doesNotMatch(text, /crono-editor/);
});

test("the editor view embeds crono-editor with hass, narrow and the program", async () => {
  const hass = makeHass({ states: STATES });
  const card = await makeCard({ view: "editor", program_id: "p2" }, hass);
  const out = card.render();
  assert.match(markup(out), /<crono-editor/);
  assert.doesNotMatch(markup(out), /<crono-rooms/);
  assert.ok(bound(out).includes(hass));
  assert.ok(bound(out).includes("p2"));
});

test("an error of the server is shown with a retry button", async () => {
  const hass = makeHass({ states: STATES, language: "en" });
  const card = await makeCard({}, hass);
  card._state = { rooms: [], programs: [], loading: false, error: { code: "network", message: "x" }, notLoaded: false };
  const text = markup(card.render());
  assert.match(text, /role="alert"/);
  assert.ok(bound(card.render()).includes(en["common.retry"]));
});

// ---- 4. announcement in the card picker ---------------------------------------------------------------------

test("the module announces the card once, also when loaded twice and with other cards already there", async () => {
  window.customCards = [{ type: "other-card", name: "Other" }];
  const a = await import(`${FE}/cronotermostato.js?first`);
  await import(`${FE}/cronotermostato.js?second`);
  assert.ok(a);
  const ours = window.customCards.filter((c) => c.type === "cronotermostato-card");
  assert.equal(ours.length, 1);
  assert.equal(window.customCards.length, 2);
  assert.deepEqual(window.customCards[0], { type: "other-card", name: "Other" });
  const entry = ours[0];
  assert.equal(entry.name, "Cronotermostato");
  assert.equal(entry.preview, false);
  assert.ok(entry.description.length > 10);
  assert.match(entry.documentationURL, /^https:\/\/github\.com\/alexcoscia\/cronotermostato/);
  assert.ok(customElements.get("cronotermostato-panel"));
});

test("the announcement works when customCards does not exist yet", async () => {
  const { announceCard } = await import(`${FE}/components/crono-card.js`);
  delete window.customCards;
  announceCard();
  announceCard();
  assert.equal(window.customCards.filter((c) => c.type === "cronotermostato-card").length, 1);
});

// ---- 5. editor of the card: config-changed ----------------------------------------------------------------------

async function makeCardEditor(config, hass) {
  const { CronoCardEditor } = await import(`${FE}/components/crono-card-editor.js`);
  const editor = new CronoCardEditor();
  const events = [];
  editor.dispatchEvent = (event) => (events.push(event), true);
  editor.setConfig(config);
  if (hass) editor.hass = hass;
  return { editor, events };
}

test("the card editor sends config-changed with the whole config, bubbling and composed", async () => {
  const { editor, events } = await makeCardEditor({ type: "custom:cronotermostato-card", view: "rooms" }, makeHass({ states: STATES }));
  editor._valueChanged("title", "Casa");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "config-changed");
  assert.equal(events[0].bubbles, true);
  assert.equal(events[0].composed, true);
  assert.deepEqual(events[0].detail.config, { type: "custom:cronotermostato-card", view: "rooms", title: "Casa" });
});

test("the card editor drops empty options and keeps what it does not know", async () => {
  const { editor, events } = await makeCardEditor({ type: "custom:cronotermostato-card", view: "rooms", title: "Casa", program_id: "p1", rooms: ["climate.a"], grid_options: { rows: 2 } });
  editor._valueChanged("title", "  ");
  editor._valueChanged("program_id", "");
  editor._roomToggled("climate.a", false);
  const last = events.at(-1).detail.config;
  assert.deepEqual(last, { type: "custom:cronotermostato-card", view: "rooms", grid_options: { rows: 2 } });
});

test("the card editor toggles rooms in a stable order and changes the view", async () => {
  const { editor, events } = await makeCardEditor({ type: "x", view: "rooms" }, makeHass({ states: STATES }));
  editor._roomToggled("climate.soggiorno", true);
  editor._roomToggled("climate.camera", true);
  assert.deepEqual(events.at(-1).detail.config.rooms, ["climate.camera", "climate.soggiorno"]);
  editor._valueChanged("view", "editor");
  assert.equal(events.at(-1).detail.config.view, "editor");
  assert.deepEqual(events.at(-1).detail.config.rooms, ["climate.camera", "climate.soggiorno"]);
});

test("the card editor shows a bad config without throwing, and uses native controls only", async () => {
  const { editor } = await makeCardEditor({ view: "grid", rooms: "x", title: 4 }, makeHass({ states: STATES, language: "it" }));
  const out = editor.render();
  const text = markup(out);
  assert.doesNotMatch(text, /<ha-/);
  assert.match(text, /<select/);
  assert.match(text, /<label/);
  assert.match(text, /type="checkbox"/);
  const src = readFileSync(new URL("components/crono-card-editor.js", URL_FE), "utf8");
  assert.doesNotMatch(src, /<ha-|ha-form|ha-entity/);
});

test("card editor names stay bound values", async () => {
  const hass = makeHass({ states: { "climate.x": { state: "off", attributes: { friendly_name: "<script>alert(1)</script>" } } } });
  const { editor } = await makeCardEditor({ view: "rooms", rooms: ["climate.x"] }, hass);
  const out = editor.render();
  assert.doesNotMatch(markup(out), /<script/);
  assert.ok(bound(out).includes("<script>alert(1)</script>"));
});

// ---- 6. strings ----------------------------------------------------------------------------------------------------

test("every card.* key is used by the code, in both languages with the same placeholders", () => {
  const code = ["components/crono-card.js", "components/crono-card-editor.js"].map((f) => readFileSync(new URL(f, URL_FE), "utf8")).join("\n");
  const keys = Object.keys(en).filter((k) => k.startsWith("card."));
  assert.ok(keys.length > 5);
  for (const key of keys) {
    assert.ok(key in it, key);
    assert.ok(code.includes(`"${key}"`) || code.includes(`\`${key}\``), `orphan ${key}`);
    assert.deepEqual(it[key].match(/\{\w+\}/g)?.sort() ?? [], en[key].match(/\{\w+\}/g)?.sort() ?? [], key);
  }
  for (const key of ["card.no_rooms", "card.no_match", "card.view_rooms", "card.view_editor"]) assert.ok(key in en, key);
});

test("the compact rooms component: no heading or hint, no switch, the card filter applies", async () => {
  const { CronoRooms } = await import(`${FE}/components/crono-rooms.js`);
  const hass = makeHass({ states: STATES, language: "it" });
  const c = new CronoRooms();
  c.hass = hass;
  c.compact = true;
  c.canEdit = false;
  c.state = { rooms: ROOMS, programs: PROGRAMS, loading: false };
  c.filter = (rows) => rows.filter((r) => r.id === "climate.camera");
  assert.deepEqual(c._rows().map((r) => r.id), ["climate.camera"]);
  const text = markup(c.render());
  assert.doesNotMatch(text, /room-title|<h3/);
  assert.doesNotMatch(text, /role="switch"/);
  const full = new CronoRooms();
  full.hass = hass;
  full.state = c.state;
  assert.match(markup(full.render()), /<h3/);
});
