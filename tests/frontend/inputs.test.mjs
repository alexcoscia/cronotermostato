// Regression: fields that commit on `change` must not use Lit's `live()`.
//
// `live()` rewrites the DOM value with the model value on EVERY render. The
// model only changes when the user leaves the field, so any re-render while
// typing (in Home Assistant `hass` changes all the time) wiped the half-typed
// text back to the model value, e.g. "00:00". Seen on a real Home Assistant.
// A plain `.value=${x}` binding only writes when `x` changes.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "..", "custom_components", "cronotermostato", "frontend", "components");

test("no component binds an input value with live()", () => {
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const src = readFileSync(join(dir, name), "utf8");
    assert.doesNotMatch(src, /\blive\s*\(/, `${name} uses live(): typing would be overwritten by re-renders`);
    assert.doesNotMatch(src, /import\s*\{[^}]*\blive\b[^}]*\}\s*from/, `${name} imports live`);
  }
});
