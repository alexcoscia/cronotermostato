import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Static scan of the editor code: nothing that turns text into markup or code.
// frontend/lit.js is excluded on purpose: it is a third-party bundle that uses
// innerHTML inside, and it is protected by the checksum test (lit.test.mjs).
const ROOT = new URL("../../custom_components/cronotermostato/frontend/", import.meta.url).pathname;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(js|mjs|html)$/.test(name) ? [path] : [];
  });
}

const FORBIDDEN = [
  [/unsafeHTML|unsafeSVG|unsafeStatic|unsafe-html/, "unsafe Lit directives"],
  [/\.innerHTML|\binnerHTML\b|\.outerHTML|\bouterHTML\b/, "innerHTML/outerHTML"],
  [/insertAdjacentHTML/, "insertAdjacentHTML"],
  [/document\.write/, "document.write"],
  [/\beval\s*\(/, "eval"],
  [/new\s+Function\b|\bFunction\s*\(/, "new Function"],
  [/setTimeout\s*\(\s*["'`]|setInterval\s*\(\s*["'`]/, "string timers"],
  [/https?:\/\/(?!www\.w3\.org)/, "an absolute URL (no CDN, no network from the frontend)"],
  [/\bimport\s*\(\s*["'`]https?:/, "import from the network"],
];

const sources = files(ROOT).filter((path) => relative(ROOT, path) !== "lit.js");

test("the scan finds the editor files (and skips only lit.js)", () => {
  const names = sources.map((p) => relative(ROOT, p));
  for (const expected of ["cronotermostato.js", "styles.js", "components/crono-editor.js", "components/crono-program-list.js", "components/crono-dialog.js", "lib/program-list.js"]) {
    assert.ok(names.includes(expected), expected);
  }
  assert.ok(!names.includes("lit.js"));
});

for (const [pattern, label] of FORBIDDEN) {
  test(`frontend code has no ${label}`, () => {
    for (const path of sources) {
      const text = readFileSync(path, "utf8").split("\n").filter((line) => !/^\s*(\/\/|\*)/.test(line)).join("\n");
      assert.doesNotMatch(text, pattern, `${relative(ROOT, path)}: ${label}`);
    }
  });
}

test("the scanner itself catches a forbidden construct", () => {
  assert.match("el.innerHTML = x", FORBIDDEN[1][0]);
  assert.match("html`${unsafeHTML(name)}`", FORBIDDEN[0][0]);
  assert.match("new Function('return 1')", FORBIDDEN[5][0]);
});
