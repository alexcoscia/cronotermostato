import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { formatNumber, localeOf } from "../../custom_components/cronotermostato/frontend/lib/i18n.js";
import it from "../../custom_components/cronotermostato/frontend/i18n/it.js";
import en from "../../custom_components/cronotermostato/frontend/i18n/en.js";

const FE = "../../custom_components/cronotermostato/frontend";

function flatten(result, out = { strings: [], values: [] }) {
  if (result === null || result === undefined || typeof result === "boolean") return out;
  if (Array.isArray(result)) { result.forEach((r) => flatten(r, out)); return out; }
  if (typeof result === "object" && "strings" in result) {
    out.strings.push(...result.strings);
    result.values.forEach((v) => flatten(v, out));
    return out;
  }
  if (typeof result === "function") return out;
  out.values.push(result);
  return out;
}
const markup = (result) => flatten(result).strings.join("");
const bandOf = (extra = {}) => ({ key: "a", start: "08:00", end: "12:00", mode: "heat", temperature: 21.5, preset: "eco", auto: false, ...extra });

async function row(props = {}) {
  const { CronoBandRow } = await import(`${FE}/components/crono-band-row.js`);
  const r = new CronoBandRow();
  r.hass = { language: "it" };
  r.band = bandOf();
  Object.assign(r, props);
  return r;
}

// ---- 1. errors: linked to their fields; the summary is announced as a count ----------------------

test("field errors: ids of the lines are in aria-describedby of the field, with aria-invalid", async () => {
  const r = await row({ errors: [{ code: "bad_time", field: "start" }, { code: "overlap", field: "start" }, { code: "bad_temperature", field: "temperature" }] });
  const flat = flatten(r.render());
  const ids = r._id;
  assert.ok(flat.values.includes(`${ids}-timehint ${ids}-start-0 ${ids}-start-1`), "start: hint then both errors");
  assert.ok(flat.values.includes(`${ids}-temperature-0`));
  // each error line carries the id that the field points to
  assert.ok(flat.values.includes(`${ids}-start-1`));
  assert.ok(flat.values.filter((v) => v === "true").length >= 2, "aria-invalid true on the two fields");
});

test("the time fields point to the hint (band.time_hint), which is hidden text", async () => {
  const r = await row();
  const flat = flatten(r.render());
  assert.ok(flat.values.includes(`${r._id}-timehint`));
  assert.ok(flat.values.includes(it["band.time_hint"]));
});

test("the summary of errors is announced as a count by one status that is always in the page", async () => {
  const { CronoEditor } = await import(`${FE}/components/crono-editor.js`);
  const src = readFileSync(new URL(`${FE}/components/crono-editor.js`, import.meta.url), "utf8");
  assert.match(src, /class="sr" role="status" aria-live="polite" aria-atomic="true">\$\{blocked/);
  // the visible box is not a second live region (no double announcement)
  const box = /<div class="msg error" id="week-errors"[^>]*>/.exec(src)[0];
  assert.doesNotMatch(box, /aria-live|role="alert"|role="status"/);
  assert.ok(CronoEditor);
});

// ---- 3. no orphan i18n keys -----------------------------------------------------------------------

test("every key of the band, editor, day and week groups is used by the code (room.*, status.* wait for later steps)", () => {
  const dir = new URL(`${FE}/`, import.meta.url).pathname;
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".js") && !d.includes("i18n") && e.name !== "lit.js" ? [`${d}/${e.name}`] : []));
  const code = walk(dir).map((f) => readFileSync(f, "utf8")).join("\n");
  const dynamic = [/^validation\./, /^mode\./, /^issue\./, /^error\./, /^status\./, /^room\./, /^holiday\./, /^dialog\./];
  const orphans = Object.keys(en).filter((key) => /^(band|editor|day|week|copy)\./.test(key)).filter((key) => {
    if (dynamic.some((re) => re.test(key))) return false;
    const base = key.replace(/_(one|other)$/, "");
    return !code.includes(`"${base}"`) && !code.includes(`\`${base}\``);
  });
  // keys for the holiday part and the rooms come with the next steps
  const later = orphans.filter((k) => !/^band\.(holiday|country|holiday_note)/.test(k) && !/^editor\.soon/.test(k));
  assert.deepEqual(later, []);
});

test("the removed keys are gone from both languages", () => {
  for (const key of ["editor.not_saved_yet", "band.pick", "band.off_note"]) {
    assert.ok(!(key in it) && !(key in en), key);
  }
  assert.ok("band.added" in it && "band.added_named" in en);
});

// ---- 5. read only ---------------------------------------------------------------------------------

test("read only: the band row renders text, no field, no select and no button (no tab stop)", async () => {
  const r = await row({ readOnly: true });
  const html = markup(r.render());
  assert.doesNotMatch(html, /<input|<select|<button|<textarea|tabindex="0"/);
  const values = flatten(r.render()).values;
  assert.ok(values.some((v) => typeof v === "string" && v.includes("21,5")), "temperature as text in the language of HA");
  assert.ok(values.includes("eco"));
});

test("editable: the band row has its fields", async () => {
  const html = markup((await row()).render());
  assert.match(html, /<input/);
  assert.match(html, /<select/);
});

test("read only: the editor hides Save and Discard", async () => {
  const src = readFileSync(new URL(`${FE}/components/crono-editor.js`, import.meta.url), "utf8");
  const bar = src.slice(src.indexOf('<span class="btns">'));
  assert.match(bar, /readOnly\s*\n?\s*\?\s*nothing/);
});

// ---- 6. segments of the bar -----------------------------------------------------------------------

test("bar segments are not tab stops, keep their label, and a touch selects the matching row", async () => {
  const { CronoDay } = await import(`${FE}/components/crono-day.js`);
  const day = new CronoDay();
  day.hass = { language: "it" };
  day.rows = [bandOf({ key: "a" }), bandOf({ key: "b", start: "12:00", end: "24:00" })];
  const flat = flatten(day.render());
  const html = flat.strings.join("");
  assert.match(html, /<button\s+type="button"\s+tabindex="-1"/);
  assert.ok(flat.values.some((v) => typeof v === "string" && v.startsWith("08:00–12:00, Riscaldamento")), "full aria-label");
  const calls = [];
  day.focusBand = (key, opts) => calls.push([key, opts]);
  day._pick(day.rows[1]);
  assert.equal(day._selected, "b");
  assert.deepEqual(calls, [["b", undefined]], "the row is chosen, not the keyboard opened (no `added`)");
});

// ---- 7. language of HA for numbers ---------------------------------------------------------------

test("numbers follow the language of HA, not the browser", () => {
  assert.equal(formatNumber({ language: "it" }, 20.5), "20,5");
  assert.equal(formatNumber({ language: "en" }, 20.5), "20.5");
  assert.equal(formatNumber({ locale: { language: "de" }, language: "en" }, 1234.5), "1.234,5");
  assert.equal(formatNumber(undefined, 20.5), "20.5");
  assert.equal(localeOf({ language: "not a locale!!" }), "en");
});

test("no number or date formatting in the frontend leaves the locale to the browser", () => {
  const dir = new URL(`${FE}/`, import.meta.url).pathname;
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".js") && e.name !== "lit.js" ? [`${d}/${e.name}`] : []));
  for (const file of walk(dir)) {
    const text = readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    assert.doesNotMatch(text, /toLocale\w*\(\s*(undefined|\))/, file);
    assert.doesNotMatch(text, /Intl\.\w+\(\s*(undefined|\))/, file);
    assert.doesNotMatch(text, /toLocale\w*String\(\s*\)/, file);
  }
});

// ---- 9. a band just added -------------------------------------------------------------------------

test("a band just added is highlighted, tagged and announced", async () => {
  const { CronoDay } = await import(`${FE}/components/crono-day.js`);
  const day = new CronoDay();
  day.hass = { language: "it" };
  day.rows = [bandOf({ key: "a" })];
  day.renderRoot = { querySelectorAll: () => [] };
  Object.defineProperty(day, "updateComplete", { value: Promise.resolve(true) }); // the stub does not render
  const p = day.focusBand("a", { added: true });
  assert.equal(day._flash, "a");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(day._notice, "Fascia aggiunta: 08:00-12:00");
  await p;
  day.disconnectedCallback();
  const r = await row({ highlight: true });
  assert.ok(flatten(r.render()).values.includes(it["band.added"]));
  assert.ok(!flatten((await row()).render()).values.includes(it["band.added"]));
});
