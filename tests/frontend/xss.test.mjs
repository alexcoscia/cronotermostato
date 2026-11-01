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

// [pattern, label, a line that must match, a harmless line that must not]
const FORBIDDEN = [
  [/unsafeHTML|unsafeSVG|unsafeStatic|unsafe-html/, "unsafe Lit directives", "html`${unsafeHTML(name)}`", "html`${name}`"],
  [/\binnerHTML\b/, "innerHTML", "el.innerHTML = x", "el.textContent = x"],
  [/\bouterHTML\b/, "outerHTML", "el.outerHTML = x", "el.tagName"],
  [/insertAdjacentHTML/, "insertAdjacentHTML", "el.insertAdjacentHTML('beforeend', x)", "el.append(x)"],
  [/document\s*\.\s*write(ln)?\s*\(/, "document.write", "document.write(x)", "document.title = x"],
  [/\bsrcdoc\b/, "srcdoc", "frame.srcdoc = x", "frame.src = 'about:blank'"],
  [/\bDOMParser\b/, "DOMParser", "new DOMParser().parseFromString(x, 'text/html')", "new URLSearchParams(x)"],
  [/createContextualFragment/, "createContextualFragment", "range.createContextualFragment(x)", "range.selectNode(x)"],
  [/setAttribute\s*\(\s*(["'`])\s*on/i, 'setAttribute("on…")', 'el.setAttribute("onclick", x)', 'el.setAttribute("aria-label", x)'],
  [/\beval\s*\(/, "eval", "eval(x)", "evaluate(x)"],
  [/new\s+Function\b|\bFunction\s*\(/, "new Function", "new Function('return 1')", "const fn = () => 1"],
  [/setTimeout\s*\(\s*["'`]|setInterval\s*\(\s*["'`]/, "string timers", "setTimeout('go()', 10)", "setTimeout(go, 10)"],
  // the one allowed link is the documentation of this project, shown in the card picker (never fetched)
  [/https?:\/\/(?!www\.w3\.org|github\.com\/alexcoscia\/cronotermostato[#"'`/])/, "an absolute URL (no CDN, no network from the frontend)", "fetch('https://example.com/x')", "xmlns='http://www.w3.org/2000/svg'"],
  [/\bimport\s*\(\s*["'`]https?:/, "import from the network", "import('https://cdn.example/x.js')", "import('./x.js')"],
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

test("the scanner itself catches every forbidden construct and lets harmless code through", () => {
  for (const [pattern, label, bad, good] of FORBIDDEN) {
    assert.match(bad, pattern, `${label}: must match "${bad}"`);
    assert.doesNotMatch(good, pattern, `${label}: must not match "${good}"`);
  }
  const labels = FORBIDDEN.map(([, label]) => label);
  for (const needed of ["srcdoc", "DOMParser", "createContextualFragment", 'setAttribute("on…")', "outerHTML", "document.write", "innerHTML"]) {
    assert.ok(labels.includes(needed), needed);
  }
});
