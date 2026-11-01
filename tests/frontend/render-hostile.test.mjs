import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { makeHass } from "./fake-hass.mjs";
import { createT } from "../../custom_components/cronotermostato/frontend/lib/i18n.js";
import { emptyProgram } from "../../custom_components/cronotermostato/frontend/lib/model.js";
import { programErrors } from "../../custom_components/cronotermostato/frontend/lib/day-editing.js";
import { KNOWN_STATUSES, assignPlan } from "../../custom_components/cronotermostato/frontend/lib/rooms.js";
import { live, repeat, styleMap } from "../../custom_components/cronotermostato/frontend/lit.js";

// One corpus of hostile names, rendered through the main components in every place a name,
// an area or a preset can appear (list, headings, title, aria-label, dialogs, errors, card
// editor, rooms, presets). Rule: the text is only ever a bound value, never part of the
// static template, and no dynamic value goes into href/src/style/on* attributes.

const FE = "../../custom_components/cronotermostato/frontend";
const FE_DIR = new URL(`${FE}/`, import.meta.url).pathname;

const HOSTILE = [
  "",
  "   ",
  "</title><script>alert(1)</script>",
  "${7*7}",
  '"><script>alert(2)</script>',
  "it's `tick` \"quote\"",
  "<img src=x onerror=alert(3)>",
  '" onmouseover="alert(4)" x="',
  "javascript:alert(5)",
  "‮evil‬ name",
  "zero​width‍joiner⁠",
  "A".repeat(1000),
  "🔥 Salotto 🛋️",
];
// fragments that must never be found in a static template string
const DANGEROUS = ["<script", "</title>", "onerror", "onmouseover", "javascript:", "7*7", "alert(", "‮", "​", "`tick`", "evil name", "AAAA"];

function flatten(result, out = { strings: [], values: [] }) {
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
}

const SAFE_DIRECTIVES = new Set([live("x"), repeat([], (x) => x, () => ""), styleMap({})].map((d) => d._$litDirective$));

/** The template of `label` has no hostile text, no dynamic URL/style/handler attribute, only safe directives. */
function assertSafe(result, label) {
  const flat = flatten(result);
  const markup = flat.strings.join("");
  for (const bad of DANGEROUS) assert.ok(!markup.includes(bad), `${label}: static template contains ${JSON.stringify(bad)}`);
  // no bound value in an attribute that can run code or load something (href is the constant of the holiday link)
  // each static chunk that ends right before a binding must not end in such an attribute
  for (const chunk of flat.strings) {
    const m = /\s(href|src|srcdoc|action|formaction|xlink:href|on[a-z]+)\s*=\s*["']?$/i.exec(chunk);
    if (m && !(m[1] === "href" && /target=|class="lnk"/.test(chunk))) assert.fail(`${label}: dynamic ${m[1]} attribute`);
  }
  for (const v of flat.values) {
    if (typeof v?._$litDirective$ === "function") assert.ok(SAFE_DIRECTIVES.has(v._$litDirective$), `${label}: only safe directives`);
  }
  return flat;
}

/** For a non-blank hostile text: if the component shows it, it is a bound plain string, intact. */
function strings(flat) {
  return flat.values.filter((v) => typeof v === "string");
}

const week = () => Array.from({ length: 7 }, () => []);
const band = (start, end, mode = "heat", temperature = 21, preset = null) => ({ start, end, mode, temperature, preset, auto: false });

function world(name) {
  const programs = [
    { program_id: "p1", name, revision: "1", week: [[band("06:00", "08:00", "cool", 40, name)], [band("06:00", "08:00", "heat", 30, null)], [], [], [], [], []], holiday: [], week_full: week(), holiday_full: [] },
    { program_id: "p2", name: "Casa", revision: "1", week: week(), holiday: [], week_full: week(), holiday_full: [] },
  ];
  const states = {};
  const rooms = [];
  const entities = {};
  const areas = { a1: { name } };
  KNOWN_STATUSES.forEach((status, i) => {
    const id = `climate.r${i}`;
    states[id] = { state: "heat", attributes: { friendly_name: name, hvac_modes: ["heat", "off"], preset_modes: [name, "eco"], min_temp: 15, max_temp: 25, target_temp_step: 0.5 } };
    entities[id] = { area_id: "a1" };
    rooms.push({ climate_entity_id: id, program_id: i % 3 === 0 ? "p2" : "p1", status, paused: status === "paused", name, slot: { start: "2026-11-01T06:00:00+01:00", end: "2026-11-01T17:00:00+01:00", mode: "heat", temperature: 21, preset: name, auto: false }, next_slot: null, manual: i % 2 === 0, override_until: i % 2 === 0 ? "2026-11-01T12:00:00+01:00" : null });
  });
  rooms.push({ climate_entity_id: "climate.r0", program_id: "p1", status: name, paused: false });
  return { programs, rooms, states, entities, areas };
}

const hassFor = (w, language) => makeHass({ states: w.states, language, ws: {} });

const LANGS = ["it", "en"];

async function components() {
  const load = (file) => import(`${FE}/components/${file}`);
  return {
    list: (await load("crono-program-list.js")).CronoProgramList,
    rooms: (await load("crono-rooms.js")).CronoRooms,
    roomCard: (await load("crono-room-card.js")).CronoRoomCard,
    manual: (await load("crono-manual-dialog.js")).CronoManualDialog,
    editor: (await load("crono-editor.js")).CronoEditor,
    card: (await load("crono-card.js")).CronotermostatoCard,
    cardEditor: (await load("crono-card-editor.js")).CronoCardEditor,
    holiday: (await load("crono-holiday.js")).CronoHoliday,
    dialog: (await load("crono-dialog.js")).CronoDialog,
    day: (await load("crono-day.js")).CronoDay,
    tabs: (await load("crono-week-tabs.js")).CronoWeekTabs,
    row: (await load("crono-band-row.js")).CronoBandRow,
  };
}

for (const name of HOSTILE) {
  const label = JSON.stringify(name.length > 40 ? `${name.slice(0, 20)}...(${name.length})` : name);
  for (const language of LANGS) {
    test(`hostile text ${label} (${language}): program list, rooms, room cards and manual dialog bind it as text`, async () => {
      const C = await components();
      const w = world(name);
      const hass = hassFor(w, language);
      hass.entities = w.entities;
      hass.areas = w.areas;
      const state = { programs: w.programs, rooms: w.rooms, loading: false, error: null, notLoaded: false, options: {} };

      const list = new C.list();
      list.hass = hass;
      list.state = state;
      list.selectedId = "p1";
      const flatList = assertSafe(list.render(), "program list");
      if (name.trim() !== "") assert.ok(strings(flatList).some((v) => v.includes(name)), "program name shown as a bound value");
      for (const kind of ["new", "rename", "duplicate", "delete", "in_use"]) {
        list._dialog = { kind, program: w.programs[0], value: name, error: name, nameError: name, warning: name, block: { count: 2, roomIds: [name] } };
        assertSafe(list._renderDialog(createT(hass)), `list dialog ${kind}`);
      }

      const rooms = new C.rooms();
      rooms.hass = hass;
      rooms.state = state;
      rooms.program = w.programs[0];
      rooms.canEdit = true;
      assertSafe(rooms.render(), "rooms");
      const rows = rooms._rows();
      assert.ok(rows.length > 0);
      rooms._errors = Object.fromEntries(rows.map((r) => [r.id, name]));
      rooms._notice = name;
      assertSafe(rooms.render(), "rooms with errors");
      rooms._ask = { kind: "unassign", row: rows[0], plan: {} };
      assertSafe(rooms.render(), "rooms unassign dialog");
      rooms._ask = { kind: "assign", row: { ...rows[0], otherProgramId: "p2", otherProgramName: name }, plan: assignPlan({ ...rows[0], otherProgramId: "p2", otherProgramName: name }, w.programs[0]) };
      assertSafe(rooms.render(), "rooms assign dialog");

      for (const row of rows) {
        const card = new C.roomCard();
        card.hass = hass;
        card.row = row;
        card.canEdit = true;
        card.error = name;
        const flat = assertSafe(card.render(), `room card ${row.status}`);
        if (name.trim() !== "" && row.name === name) assert.ok(strings(flat).some((v) => v.includes(name)), "room name is a bound value");
        const dialog = new C.manual();
        dialog.hass = hass;
        dialog.room = row;
        dialog.open = true;
        dialog.error = name;
        dialog.willUpdate(new Map([["room", undefined]]));
        assertSafe(dialog.render(), `manual dialog ${row.status}`);
      }
    });

    test(`hostile text ${label} (${language}): editor, day, week, band row, holiday, dialog, card and its editor`, async () => {
      const C = await components();
      const w = world(name);
      const hass = hassFor(w, language);
      hass.entities = w.entities;
      hass.areas = w.areas;
      const t = createT(hass);
      const state = { programs: w.programs, rooms: w.rooms, loading: false, error: null, notLoaded: false, options: {} };

      const editor = new C.editor();
      editor.hass = hass;
      editor._state = state;
      editor._selection = { id: "p1", seen: true, pending: false };
      editor._status = "ok";
      editor._loadDraft(w.programs[0]);
      const detail = assertSafe(editor.render(), "editor");
      if (name.trim() !== "") assert.ok(strings(detail).some((v) => v.includes(name)), "heading/title/aria-label carry the name as a value");
      const draft = { ...emptyProgram(name), id: "p1" };
      draft.week[0] = [{ ...band("06:00", "08:00", "heat", 30, name), key: "a" }, { ...band("07:00", "09:00", "heat", 20, null), key: "b" }];
      const { summary } = programErrors(draft);
      assertSafe(editor._renderErrors(t, draft, summary, language), "editor errors");
      const climate = [{ id: "climate.x", name, available: true, hvacModes: ["heat"], presetModes: ["eco"], minTemp: 5, maxTemp: 25, step: 0.5 }];
      assertSafe(editor._renderRoomWarnings(t, draft, climate, language), "room warnings");
      editor._conflict = true;
      editor._saveError = { code: "invalid_format", message: name, detailCode: "bad_time" };
      editor._copy = { from: 0, targets: [1] };
      editor._switch = { id: "p2", pending: false };
      assertSafe(editor._renderDialogs(t), "editor dialogs");
      assertSafe(editor._renderWeek(t, w.programs[0], w.rooms), "editor week");

      const rows = [{ key: "a", start: "08:00", end: "12:00", mode: "heat", temperature: 21, preset: name, auto: false }];
      const day = new C.day();
      day.hass = hass;
      day.label = name;
      day.rows = rows;
      day.presets = [name];
      day.hasRooms = true;
      assertSafe(day.render(), "day");
      const tabs = new C.tabs();
      tabs.hass = hass;
      tabs.days = [{ id: 0, label: name, full: name, rows, count: 1, errorCount: 1 }];
      assertSafe(tabs.render(), "week tabs");
      const row = new C.row();
      row.hass = hass;
      row.band = rows[0];
      row.presets = [name];
      row.hasRooms = true;
      row.errors = [{ code: "bad_time", field: "start" }, { code: "unsupported_preset", field: "preset" }];
      assertSafe(row.render(), "band row");
      row.referenceName = name; // a single reference room: its (hostile) name is in the label and in the warning
      row.presets = ["eco"];
      assertSafe(row.render(), "band row, preset not available in the reference room");
      row._otherOpen = true;
      assertSafe(row.render(), "band row, free preset field");
      assertSafe(editor._renderReference(t, { allClimate: climate, assigned: new Set(["climate.x"]), reference: "climate.x" }), "reference room select");
      assertSafe(editor._renderReference(t, { allClimate: climate, assigned: new Set(), reference: null }), "reference room select, nothing chosen");

      const holiday = new C.holiday();
      holiday.hass = hass;
      holiday.country = name;
      holiday.subdiv = name;
      holiday.dirty = true;
      assertSafe(holiday.render(), "holiday");

      const dialog = new C.dialog();
      dialog.hass = hass;
      dialog.heading = name;
      dialog.open = true;
      assertSafe(dialog.render(), "dialog");

      const card = new C.card();
      card.setConfig({ view: "rooms", title: name, program_id: "p1" });
      card.hass = hass;
      card._state = state;
      assertSafe(card.render(), "card rooms view");
      const cardEditorView = new C.card();
      cardEditorView.setConfig({ view: "editor", title: name });
      cardEditorView.hass = hass;
      cardEditorView._state = state;
      assertSafe(cardEditorView.render(), "card editor view");

      const cardEditor = new C.cardEditor();
      cardEditor.hass = hass;
      cardEditor.setConfig({ view: "rooms", title: name, program_id: name, rooms: [name, "climate.r0"] });
      cardEditor._programs = w.programs.map((p) => ({ id: p.program_id, name: p.name }));
      assertSafe(cardEditor.render(), "card editor");
      cardEditor._programs = null;
      assertSafe(cardEditor.render(), "card editor, programs unreadable");
    });
  }
}

// ---- Static: no dynamic URL / style / handler attribute anywhere, no shadow-less component ------

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const path = join(dir, n);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return n.endsWith(".js") && n !== "lit.js" ? [path] : [];
  });
}

test("the only bound href is the constant path to the integration; src/srcdoc/formaction/on* are never bound", () => {
  for (const path of sourceFiles(FE_DIR)) {
    const text = readFileSync(path, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    const where = relative(FE_DIR, path);
    for (const m of text.matchAll(/\b(href|src|srcdoc|action|formaction|xlink:href)\s*=\s*\$\{([^}]*)\}/g)) {
      assert.equal(`${m[1]}=${m[2].trim()}`, "href=integrationPath", `${where}: ${m[0]}`);
    }
    assert.doesNotMatch(text, /\s\.(href|src|srcdoc|innerHTML|outerHTML)\s*=\s*\$\{/, `${where}: property binding to a URL or markup`);
    assert.doesNotMatch(text, /\sstyle=\$\{(?!styleMap\()/, `${where}: a style attribute bound to a plain string`);
    assert.doesNotMatch(text, /\s\.?on[a-z]+=\$\{/, `${where}: inline on* handler`);
  }
  const holiday = readFileSync(join(FE_DIR, "lib/holiday.js"), "utf8");
  assert.match(holiday, /export const integrationPath = "\/config\/integrations\/integration\/cronotermostato";/);
});

test("every component keeps its shadow root (ids are per instance, so two cards and the panel do not clash)", () => {
  for (const path of sourceFiles(FE_DIR)) {
    const text = readFileSync(path, "utf8");
    assert.doesNotMatch(text, /createRenderRoot|attachShadow/, relative(FE_DIR, path));
  }
});

test("the aria/for references of a template point at ids of the same template (same shadow root)", () => {
  for (const path of sourceFiles(join(FE_DIR, "components"))) {
    const text = readFileSync(path, "utf8");
    const ids = new Set([...text.matchAll(/\bid=(?:"([\w-]+)"|\$\{([A-Z_]+)\})/g)].map((m) => m[1] ?? m[2]));
    const consts = Object.fromEntries([...text.matchAll(/const ([A-Z_]+) = "([\w-]+)"/g)].map((m) => [m[1], m[2]]));
    const known = new Set([...ids].map((i) => consts[i] ?? i));
    for (const m of text.matchAll(/(?:aria-(?:describedby|labelledby|controls)|\bfor|\bform)="([\w-]+(?: [\w-]+)*)"/g)) {
      for (const id of m[1].split(" ")) {
        // ids built at run time (`${ids}-start`) are per row and unique per row component, not listed here
        assert.ok(known.has(id) || [...known].some((k) => id === k), `${relative(FE_DIR, path)}: ${id} is not an id of the same component`);
      }
    }
  }
});

test("the checks catch what they are meant to catch", () => {
  const fake = (strings, ...values) => ({ strings, values });
  assert.throws(() => assertSafe(fake`<a href=${"javascript:x"}>x</a>`, "t"), /dynamic href/);
  assert.throws(() => assertSafe(fake`<p>${"x"}</p><b onclick=${"x"}>`, "t"), /dynamic onclick/);
  assert.throws(() => assertSafe(fake`<p>${"x"}</p><script>alert(1)</script>`, "t"), /static template contains/);
  assert.doesNotThrow(() => assertSafe(fake`<h2 title=${"</title><script>"}>${"</title><script>"}</h2>`, "t"));
  const rooms = new Set(KNOWN_STATUSES);
  assert.ok(rooms.has("ok") && rooms.size >= 10, "the world covers every room status");
});
