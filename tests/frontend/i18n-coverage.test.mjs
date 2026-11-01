import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import it from "../../custom_components/cronotermostato/frontend/i18n/it.js";
import en from "../../custom_components/cronotermostato/frontend/i18n/en.js";
import { KNOWN_STATUSES } from "../../custom_components/cronotermostato/frontend/lib/rooms.js";

// Every text key the code can ask for exists in Italian and in English, with the same
// placeholders, and no key is left over. The keys built at run time (`status.${x}`,
// `validation.${code}`...) are enumerated here from their source (the Python server and the
// JavaScript validation), not typed by hand twice: when a server code is added, this fails
// until both languages have the text.

const COMPONENT = new URL("../../custom_components/cronotermostato/", import.meta.url).pathname;
const FRONTEND = join(COMPONENT, "frontend");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "i18n" ? [] : walk(path);
    return name.endsWith(".js") && name !== "lit.js" ? [path] : [];
  });
}
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sources = walk(FRONTEND).map((path) => [relative(FRONTEND, path), strip(readFileSync(path, "utf8"))]);
const code = sources.map(([, text]) => text).join("\n");
const python = (file) => readFileSync(join(COMPONENT, file), "utf8");
const pythonFiles = (dir = COMPONENT) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "frontend" || name === "__pycache__" ? [] : pythonFiles(path);
    return name.endsWith(".py") ? [path] : [];
  });

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const groups = new Set(Object.keys(en).map((key) => key.split(".")[0]));
const has = (key) => key in it && key in en;

// ---- the codes that come from the sources ----------------------------------------------------------

/** RoomStatus of controller.py. */
function roomStatuses() {
  const block = /RoomStatus\s*=\s*Literal\[([\s\S]*?)\]/.exec(python("controller.py"))[1];
  return [...block.matchAll(/"(\w+)"/g)].map((m) => m[1]);
}

/** The code of every ProgramError raised by the server (second argument or code=), plus the default. */
function programErrorCodes() {
  const codes = new Set(["invalid"]);
  for (const file of pythonFiles()) {
    const text = readFileSync(file, "utf8");
    for (let at = text.indexOf("ProgramError("); at >= 0; at = text.indexOf("ProgramError(", at + 1)) {
      let depth = 0;
      let end = at + "ProgramError".length;
      for (; end < text.length; end++) {
        if (text[end] === "(") depth++;
        else if (text[end] === ")" && --depth === 0) break;
      }
      const found = /(?:,\s*|code\s*=\s*)"([a-z_]+)"\s*,?\s*$/.exec(text.slice(at + "ProgramError(".length, end));
      if (found) codes.add(found[1]);
    }
  }
  return [...codes].sort();
}

/** Error codes of the WebSocket commands: ERR_* constants and what send_error/error_message get. */
function webSocketErrorCodes() {
  const text = python("websocket_api.py");
  const homeAssistant = { ERR_INVALID_FORMAT: "invalid_format", ERR_NOT_FOUND: "not_found", ERR_UNAUTHORIZED: "unauthorized" };
  const own = Object.fromEntries([...text.matchAll(/^(ERR_[A-Z_]+)\s*=\s*"(\w+)"/gm)].map((m) => [m[1], m[2]]));
  const known = { ...homeAssistant, ...own };
  const used = new Set([...text.matchAll(/(?:send_error|error_message)\(\s*msg\["id"\],\s*(ERR_[A-Z_]+)/g)].map((m) => m[1]));
  return [...used].map((name) => {
    assert.ok(known[name], `unknown constant ${name}`);
    return known[name];
  });
}

/** Codes the JavaScript validation can return (validate.js, the manual form of rooms.js and the stuctural ones). */
function clientCodes() {
  const out = new Set();
  for (const file of ["lib/validate.js", "lib/rooms.js", "lib/day-editing.js", "lib/model.js"]) {
    const text = strip(readFileSync(join(FRONTEND, file), "utf8"));
    for (const m of text.matchAll(/error\(\s*"([a-z_]+)"/g)) out.add(m[1]);
    for (const m of text.matchAll(/\{\s*code:\s*"([a-z_]+)"/g)) out.add(m[1]);
  }
  return [...out].sort();
}

const MODES = ["heat", "cool", "off"];

test("the enumerations really come from the sources (guard against a silent empty list)", () => {
  assert.deepEqual(roomStatuses().slice(0, 3), ["ok", "paused", "unassigned"]);
  assert.ok(programErrorCodes().length >= 12, programErrorCodes().join());
  for (const c of ["bad_time", "end_before_start", "overlap", "bad_mode", "bad_preset", "bad_temperature", "missing_setting", "off_with_setting", "bad_band", "bad_program", "not_found", "program_in_use", "not_assigned", "bad_override", "invalid"]) {
    assert.ok(programErrorCodes().includes(c), `server code ${c}`);
  }
  assert.deepEqual(webSocketErrorCodes().sort(), ["conflict", "invalid_format", "not_found", "not_loaded", "unauthorized"]);
  for (const c of ["bad_time", "end_before_start", "overlap", "bad_mode", "missing_setting", "off_with_setting", "bad_temperature", "bad_preset", "bad_band", "bad_program", "unsupported_mode", "unsupported_preset", "out_of_range"]) {
    assert.ok(clientCodes().includes(c), `client code ${c}`);
  }
});

// ---- the expected keys, by family ---------------------------------------------------------------------

/** Every key the code builds from a variable, with where the values come from. */
function dynamicKeys() {
  const keys = new Map();
  const add = (key, why) => keys.set(key, why);
  // status.${s}: the server's RoomStatus, the one the client adds (not_running), the fallback text
  for (const s of [...roomStatuses(), "not_running"]) add(`status.${s}`, "RoomStatus / client status");
  for (const s of KNOWN_STATUSES) add(`status.${s}`, "KNOWN_STATUSES of rooms.js");
  add("status.unknown", "status of an unknown kind");
  // mode.${m}
  for (const m of MODES) add(`mode.${m}`, "modes of a band");
  // validation.${code}: every server ProgramError code, every client code that is not an `issue.*`
  for (const c of programErrorCodes()) add(`validation.${c}`, "ProgramError.code (server)");
  for (const c of clientCodes()) if (!["unsupported_mode", "unsupported_preset", "out_of_range"].includes(c)) add(`validation.${c}`, "validate.js / forms (client)");
  // issue.${code}: the problems a room can report for a band
  const order = /ISSUE_ORDER\s*=\s*\[([^\]]*)\]/.exec(code)[1];
  for (const m of order.matchAll(/"(\w+)"/g)) add(`issue.${m[1]}`, "ISSUE_ORDER of rooms.js");
  for (const c of ["unsupported_mode", "unsupported_preset", "out_of_range"]) add(`issue.${c}`, "manual form and room issues");
  // error.${code}: the WebSocket codes and the one of the client
  for (const c of [...webSocketErrorCodes(), "network"]) add(`error.${c}`, "WebSocket error / client");
  // program.${kind}_title: the kinds of the dialog of the list
  const kinds = new Set(["new", "rename", "duplicate", "delete", "in_use"]);
  for (const m of code.matchAll(/this\._open\(\s*"(\w+)"/g)) kinds.add(m[1]);
  for (const k of kinds) add(`program.${k}_title`, "dialog kind of crono-program-list");
  // t(actions.note)
  for (const m of code.matchAll(/note:\s*row\.status === "missing" \? "([\w.]+)" : "([\w.]+)"/g)) {
    add(m[1], "room action note");
    add(m[2], "room action note");
  }
  return keys;
}

/** Plural bases asked with tn(): `${base}_one` and `${base}_other` must both exist. */
function pluralBases() {
  return new Set([...code.matchAll(/\btn\(\s*(?:this\.hass|hass),\s*"([\w.]+)"/g)].map((m) => m[1]).concat([...code.matchAll(/\bplural\(\s*"([\w.]+)"/g)].map((m) => m[1])));
}

/** Literal keys: any string in the code that looks like a text key of a known group. */
function literalKeys() {
  const out = new Set();
  for (const m of code.matchAll(/["'`]([a-z]+\.[a-z_]+(?:\.[a-z_]+)*)["'`]/g)) {
    const key = m[1];
    if (groups.has(key.split(".")[0])) out.add(key);
  }
  return out;
}

test("every key used by the code, literal or built, exists in Italian and in English", () => {
  const missing = [];
  for (const key of literalKeys()) if (!has(key) && !(has(`${key}_one`) && has(`${key}_other`))) missing.push(`literal ${key}`);
  for (const [key, why] of dynamicKeys()) if (!has(key)) missing.push(`${key} (${why})`);
  for (const base of pluralBases()) for (const form of ["one", "other"]) if (!has(`${base}_${form}`)) missing.push(`${base}_${form}`);
  assert.deepEqual(missing, []);
});

test("the dynamic key patterns in the code are all known to this test (a new one needs a source here)", () => {
  const patterns = new Set([...code.matchAll(/`([a-z]+\.[^`$]*)\$\{[^}]*\}([^`]*)`/g)].map((m) => `${m[1]}*${m[2]}`));
  const known = new Set(["status.*", "mode.*", "validation.*", "issue.*", "error.*", "program.*_title", "room.*"]);
  // ids and CSS class names are also built with ${}: only the patterns whose group is a text group matter
  const textual = [...patterns].filter((p) => groups.has(p.split(".")[0]));
  assert.deepEqual(textual.filter((p) => !known.has(p)), []);
});

test("nothing is orphaned: every key of the tables is a literal, a built key, or a plural form of one", () => {
  const expected = new Set([...literalKeys(), ...dynamicKeys().keys()]);
  const bases = pluralBases();
  const orphans = Object.keys(en).filter((key) => {
    if (expected.has(key)) return false;
    const base = key.replace(/_(one|other)$/, "");
    return !(bases.has(base) || expected.has(base));
  });
  assert.deepEqual(orphans, []);
});

test("both tables have the same keys, the same placeholders, and plural forms in pairs", () => {
  assert.deepEqual(Object.keys(it).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) assert.deepEqual(placeholders(it[key]), placeholders(en[key]), key);
  for (const table of [it, en]) {
    for (const key of Object.keys(table)) {
      const m = /^(.*)_(one|other)$/.exec(key);
      if (!m) continue;
      assert.ok(`${m[1]}_one` in table && `${m[1]}_other` in table, `${m[1]} has both plural forms`);
    }
  }
});

test("no text is empty or only a key, in both languages", () => {
  for (const table of [it, en]) for (const [key, text] of Object.entries(table)) assert.ok(text.trim() !== "" && text !== key, key);
});
