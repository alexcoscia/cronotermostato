import test from "node:test";
import assert from "node:assert/strict";
import it from "../../custom_components/cronotermostato/frontend/i18n/it.js";
import en from "../../custom_components/cronotermostato/frontend/i18n/en.js";
import { t, createT, languageOf, tn } from "../../custom_components/cronotermostato/frontend/lib/i18n.js";

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("it and en have the same keys and the same placeholders", () => {
  assert.deepEqual(Object.keys(it).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof it[key], "string", key);
    assert.equal(typeof en[key], "string", key);
    assert.deepEqual(placeholders(it[key]), placeholders(en[key]), key);
    assert.notEqual(it[key].trim(), "", key);
    assert.notEqual(en[key].trim(), "", key);
  }
});

test("no HTML in any string", () => {
  for (const table of [it, en]) for (const [key, text] of Object.entries(table)) assert.ok(!/[<>]/.test(text), key);
});

test("all the room statuses, validation codes and error codes have a text", () => {
  for (const s of ["ok", "paused", "unassigned", "unavailable", "unsupported_mode", "unsupported_preset", "out_of_range", "missing", "error", "not_running"]) {
    assert.ok(`status.${s}` in it, s);
  }
  for (const c of ["bad_time", "end_before_start", "overlap", "bad_mode", "missing_setting", "off_with_setting", "bad_temperature", "bad_preset", "bad_band", "bad_program", "not_found", "program_in_use", "not_assigned", "invalid", "bad_override"]) {
    assert.ok(`validation.${c}` in it, c);
  }
  for (const c of ["conflict", "not_found", "invalid_format", "unauthorized", "not_loaded", "network"]) {
    assert.ok(`error.${c}` in it, c);
  }
});

test("language comes from locale.language, then language, with region stripped", () => {
  assert.equal(languageOf({ locale: { language: "it-IT" }, language: "en" }), "it");
  assert.equal(languageOf({ language: "IT" }), "it");
  assert.equal(languageOf({}), "en");
  assert.equal(languageOf(undefined), "en");
});

test("t translates, falls back to English, then to the key", () => {
  assert.equal(t({ language: "it" }, "common.save"), it["common.save"]);
  assert.equal(t({ language: "en" }, "common.save"), en["common.save"]);
  assert.equal(t({ language: "de" }, "common.save"), en["common.save"]);
  assert.equal(t({ language: "it" }, "no.such.key"), "no.such.key");
  assert.equal(t({ language: "it" }, "__proto__"), "__proto__");
  assert.equal(t({ language: "it" }, "constructor"), "constructor");
});

test("parameters replace placeholders as plain text", () => {
  const hass = { language: "en" };
  const key = Object.keys(en).find((k) => placeholders(en[k]).length === 1);
  const [name] = placeholders(en[key]);
  const text = t(hass, key, { [name]: "<img src=x onerror=alert(1)> $& ${7*7}" });
  assert.ok(text.includes("<img src=x onerror=alert(1)> $& ${7*7}"));
  assert.equal(t(hass, key, {}).includes(`{${name}}`), true);
  assert.equal(t(hass, key, { [name]: 0 }).includes("0"), true);
});

test("createT binds the hass and follows a language change of the same object", () => {
  const hass = { language: "it" };
  const tt = createT(hass);
  assert.equal(tt("common.save"), it["common.save"]);
  hass.language = "en";
  assert.equal(tt("common.save"), en["common.save"]);
});

test("tn picks the plural form", () => {
  const hass = { language: "it" };
  assert.equal(tn(hass, "program.rooms", 1), it["program.rooms_one"].replace("{count}", "1"));
  assert.equal(tn(hass, "program.rooms", 3), it["program.rooms_other"].replace("{count}", "3"));
  assert.equal(tn({ language: "en" }, "program.rooms", 0), en["program.rooms_other"].replace("{count}", "0"));
});

test("program.in_use has plural forms and a count", () => {
  assert.ok(!("program.in_use" in it) && !("program.in_use" in en));
  assert.equal(tn({ language: "it" }, "program.in_use", 1).includes("1 stanza"), true);
  assert.equal(tn({ language: "it" }, "program.in_use", 3).includes("3 stanze"), true);
  assert.equal(tn({ language: "en" }, "program.in_use", 1).includes("1 room"), true);
  assert.equal(tn({ language: "en" }, "program.in_use", 2).includes("2 rooms"), true);
});
