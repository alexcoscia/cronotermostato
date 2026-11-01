import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// frontend/lit.js is a third-party bundle: its body must match the checksum in its header.
const text = readFileSync(new URL("../../custom_components/cronotermostato/frontend/lit.js", import.meta.url), "utf8");
const lines = text.split("\n");

test("lit.js body matches the checksum written in its header", () => {
  const headerEnd = lines.indexOf(" */");
  assert.ok(headerEnd > 0, "header not found");
  const header = lines.slice(0, headerEnd + 1).join("\n");
  const declared = /SHA-256 of the body: ([0-9a-f]{64})/.exec(header)?.[1];
  assert.ok(declared, "checksum missing in the header");
  // The header names the line where the body starts: `tail -n +N lit.js | sha256sum`.
  const start = Number(/tail -n \+(\d+) lit\.js \| sha256sum/.exec(header)?.[1]);
  assert.equal(start, headerEnd + 2, "the line number in the header is stale");
  const body = lines.slice(start - 1).join("\n");
  assert.equal(createHash("sha256").update(body).digest("hex"), declared);
});

test("lit.js header records the version and the integrity of the packages", () => {
  for (const pkg of ["lit@3.3.3", "lit-html@3.3.3", "lit-element@4.2.2", "@lit/reactive-element@2.1.2"]) {
    assert.match(text.slice(0, text.indexOf(" */")), new RegExp(`${pkg.replace(/[/@.]/g, "\\$&")}\\s+sha512-[A-Za-z0-9+/=]{20,}`), pkg);
  }
});

test("lit.js is self-contained: no imports from outside", () => {
  assert.doesNotMatch(lines.slice(22).join("\n"), /\bfrom\s*["']https?:/);
});
