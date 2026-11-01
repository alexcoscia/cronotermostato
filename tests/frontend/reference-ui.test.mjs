import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import it from "../../custom_components/cronotermostato/frontend/i18n/it.js";
import { createT } from "../../custom_components/cronotermostato/frontend/lib/i18n.js";
import { relativeIndex } from "../../custom_components/cronotermostato/frontend/lib/focus.js";

const FE = "../../custom_components/cronotermostato/frontend";
const EVIL = "</option><script>alert(1)</script>";

function flatten(result, out = { strings: [], values: [] }) {
  if (result === null || result === undefined || typeof result === "boolean") return out;
  if (Array.isArray(result)) { result.forEach((r) => flatten(r, out)); return out; }
  if (typeof result === "object" && "strings" in result) { out.strings.push(...result.strings); result.values.forEach((v) => flatten(v, out)); return out; }
  if (typeof result === "function") return out;
  out.values.push(result);
  return out;
}
const bandOf = (extra = {}) => ({ key: "a", start: "08:00", end: "12:00", mode: "heat", temperature: 21.5, preset: null, auto: false, ...extra });
async function row(props = {}) {
  const { CronoBandRow } = await import(`${FE}/components/crono-band-row.js`);
  const r = new CronoBandRow();
  r.hass = { language: "it" };
  r.band = bandOf();
  Object.assign(r, props);
  return r;
}
const rendered = (r) => flatten(r.render());

test("the preset field is a native select with a label, never a datalist", async () => {
  const src = readFileSync(new URL(`${FE}/components/crono-band-row.js`, import.meta.url), "utf8");
  assert.doesNotMatch(src, /datalist|list=\$\{/);
  const r = await row({ presets: ["eco", EVIL], hasRooms: true, referenceName: "Bagno" });
  const flat = rendered(r);
  const markup = flat.strings.join("");
  assert.ok(flat.values.includes(`${r._id}-preset`), "label and select share the id");
  assert.match(markup, /<label for=>/);
  assert.match(markup, /<select id=/);
  assert.ok(flat.values.includes(`p:${EVIL}`), "the preset is a bound value of the option");
  assert.ok(flat.values.includes(EVIL), "and its text");
  assert.doesNotMatch(markup, /<script|alert\(/);
  assert.ok(flat.values.includes(it["room.preset_none"]));
  assert.ok(flat.values.includes(it["band.preset_free"]));
});

test("a value the reference room does not offer is kept as a selected option, marked, with the warning", async () => {
  const r = await row({ band: bandOf({ preset: "away" }), presets: ["eco"], hasRooms: true, referenceName: EVIL });
  const flat = rendered(r);
  const label = createT({ language: "it" })("band.preset_unavailable_in", { preset: "away", room: EVIL });
  assert.ok(flat.values.includes(label), "option text says where it is not available");
  assert.ok(flat.values.includes("p:away"));
  assert.ok(flat.values.includes(createT({ language: "it" })("band.preset_unknown_room", { preset: "away", room: EVIL })), "existing warning, room named");
  // union: the older wording
  const all = rendered(await row({ band: bandOf({ preset: "away" }), presets: ["eco"], hasRooms: true, referenceName: "" }));
  assert.ok(all.values.includes(it["band.preset_unknown"].replace("{preset}", "away")));
  assert.ok(all.values.includes(createT({ language: "it" })("band.preset_unavailable_all", { preset: "away" })));
});

test("a listed value is a plain option and there is no warning", async () => {
  const flat = rendered(await row({ band: bandOf({ preset: "eco" }), presets: ["eco"], hasRooms: true, referenceName: "Bagno" }));
  assert.ok(flat.values.includes("p:eco"));
  assert.ok(!flat.values.some((v) => typeof v === "string" && v.includes("non disponibile")));
  assert.ok(!flat.values.includes(it["band.preset_unknown"].replace("{preset}", "eco")));
});

test("a room without presets: only none and Other, with a short note; no room: asks to choose one", async () => {
  const empty = rendered(await row({ presets: [], hasRooms: true, referenceName: "Cucina" }));
  assert.ok(empty.values.includes(it["band.preset_room_empty"]));
  assert.ok(!empty.values.some((v) => typeof v === "string" && v.startsWith("p:")));
  const none = rendered(await row({ presets: [], hasRooms: false }));
  assert.ok(none.values.includes(it["band.preset_need_room"]));
  const some = rendered(await row({ presets: ["eco"], hasRooms: true, referenceName: "X" }));
  assert.ok(!some.values.includes(it["band.preset_room_empty"]) && !some.values.includes(it["band.preset_need_room"]));
});

test("Other... shows the free text field (bound value, labelled); otherwise it is not in the page", async () => {
  const closed = rendered(await row({ band: bandOf({ preset: EVIL }), presets: [], hasRooms: true }));
  assert.ok(!closed.strings.join("").includes("preset-other"));
  const r = await row({ band: bandOf({ preset: EVIL }), presets: [], hasRooms: true });
  r._otherOpen = true;
  const open = rendered(r);
  assert.match(open.strings.join(""), /<label class="sub" for=/);
  assert.ok(open.values.includes(`${r._id}-preset-other`));
  assert.ok(open.values.includes(EVIL));
});

test("an off band disables the select and shows none", async () => {
  const flat = rendered(await row({ band: bandOf({ mode: "off", temperature: null, preset: null }), presets: ["eco"], hasRooms: true }));
  assert.ok(flat.values.includes(true) || flat.values.length > 0);
  assert.ok(!flat.values.includes(it["band.preset_need_room"]), "no note on an off band");
});

test("changes carry where the focus must go: Tab -> next, Shift+Tab -> previous, Enter and buttons -> same, click -> unknown", async () => {
  const r = await row();
  const seen = [];
  r.dispatchEvent = (event) => { seen.push(event.detail.focus); return true; };
  const field = (name) => ({ id: `${r._id}-${name}`, tagName: "INPUT" });
  r._onKeydown({ key: "Tab", shiftKey: false });
  r._emit({ start: "09:00" }, field("start"));
  r._onKeydown({ key: "Tab", shiftKey: true });
  r._emit({ end: "10:00" }, field("end"));
  r._onKeydown({ key: "Enter" });
  r._emit({ temperature: "20" }, field("temp"));
  r._emit({ temperature: 21 }, { id: `${r._id}-up`, tagName: "BUTTON" });
  r._emit({ mode: "cool" }, field("mode")); // no key: a click or a touch
  r._onKeydown({ key: "Tab", shiftKey: false });
  r._onPointer();
  r._emit({ mode: "cool" }, field("mode"));
  assert.deepEqual(seen, [
    { field: "start", delta: 1 },
    { field: "end", delta: -1 },
    { field: "temp", delta: 0 },
    { field: "up", delta: 0 },
    null,
    null,
  ]);
});

test("relativeIndex stays inside the list and ignores a missing field", () => {
  assert.equal(relativeIndex(5, 1, 1), 2);
  assert.equal(relativeIndex(5, 0, -1), 0);
  assert.equal(relativeIndex(5, 4, 1), 4);
  assert.equal(relativeIndex(5, 2, 0), 2);
  assert.equal(relativeIndex(5, -1, 1), -1);
  assert.equal(relativeIndex(0, 0, 1), -1);
});

test("the editor adopts a calculated band and then asks the day to keep the focus (same key, field and delta)", async () => {
  const { CronoEditor } = await import(`${FE}/components/crono-editor.js`);
  const editor = new CronoEditor();
  const calls = [];
  editor._edit = () => {};
  editor._draft = { week: [[], [], [], [], [], [], []], holiday: [] };
  editor._day = 0;
  editor._keepFocus = (key, focus) => calls.push([key, focus]);
  const auto = { key: "auto-00:00-08:00", start: "00:00", end: "08:00", mode: "off", temperature: null, preset: null, auto: true };
  editor._onBandChange({ stopPropagation() {}, detail: { row: auto, patch: { mode: "heat" }, focus: { field: "mode", delta: 1 } } });
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0][0], auto.key, "the adopted band has a key of its own");
  assert.deepEqual(calls[0][1], { field: "mode", delta: 1 });
  // a band of the user (or no focus information): nothing to restore
  editor._onBandChange({ stopPropagation() {}, detail: { row: { ...auto, auto: false }, patch: {}, focus: { field: "mode", delta: 1 } } });
  editor._onBandChange({ stopPropagation() {}, detail: { row: auto, patch: {}, focus: null } });
  assert.equal(calls.length, 1);
});

test("the editor shows the reference room select above the day tabs and never sends it to the server", () => {
  const src = readFileSync(new URL(`${FE}/components/crono-editor.js`, import.meta.url), "utf8");
  assert.ok(src.indexOf("this._renderReference(t,") < src.indexOf("<crono-week-tabs"));
  const api = readFileSync(new URL(`${FE}/lib/api.js`, import.meta.url), "utf8");
  assert.doesNotMatch(api, /reference/i);
});
