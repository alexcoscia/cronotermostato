import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Contrast of the colour pairs defined in styles.js, computed for real (WCAG 2.x
// relative luminance) in three situations:
//  - "fallback": no Home Assistant theme variables, light (the fallbacks in styles.js);
//  - "ha-light" / "ha-dark": the default light and dark themes of Home Assistant.
// There is no "dark with fallbacks": the editor only sets `dark` when HA says its
// theme is dark, so the HA variables are always there.
//
// Text needs 4.5:1. Borders and graphic objects need 3:1 where that is possible
// without losing the amber / blue / grey of the modes. Where a pair cannot reach
// it, the state is also said with an icon and a text, never with colour alone, and
// the exception is listed in COLOUR_ONLY_BUT_REDUNDANT with the reason.

const SRC = readFileSync(new URL("../../custom_components/cronotermostato/frontend/styles.js", import.meta.url), "utf8");

// Default theme of Home Assistant (frontend, src/resources/theme). The dark one keeps the
// primary colour of the light one, which is why the accent pairs are listed as theme-owned.
const HA = {
  "ha-light": {
    "primary-text-color": "#212121",
    "secondary-text-color": "#727272",
    "primary-background-color": "#fafafa",
    "secondary-background-color": "#e5e5e5",
    "card-background-color": "#ffffff",
    "divider-color": "rgba(0, 0, 0, 0.12)",
    "primary-color": "#03a9f4",
    "text-primary-color": "#ffffff",
  },
  "ha-dark": {
    "primary-text-color": "#e1e1e1",
    "secondary-text-color": "#9b9b9b",
    "primary-background-color": "#111111",
    "secondary-background-color": "#202020",
    "card-background-color": "#1c1c1c",
    "divider-color": "rgba(225, 225, 225, 0.12)",
    "primary-color": "#03a9f4",
    "text-primary-color": "#ffffff",
  },
};

function block(source, opener) {
  const start = source.indexOf(opener);
  assert.ok(start >= 0, opener);
  return source.slice(start, source.indexOf("}", start));
}

function declarations(text) {
  const out = {};
  for (const m of text.matchAll(/--crono-([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const LIGHT_DECLS = declarations(block(SRC, "export const tokens"));
const DARK_DECLS = declarations(block(SRC, ":host([dark])"));

function parseColour(text) {
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (m) {
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1);
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(text);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  throw new Error(`not a colour: ${text}`);
}

function resolveValue(value, ha, decls) {
  const v = /^var\(\s*--crono-([\w-]+)\s*\)$/.exec(value);
  if (v) return resolveValue(decls[v[1]], ha, decls);
  const m = /^var\(\s*--([\w-]+)\s*,\s*(.+)\)$/.exec(value);
  if (m) return ha && Object.hasOwn(ha, m[1]) ? ha[m[1]] : m[2].trim();
  return value;
}

/** All the --crono-* colours of a situation, as [r, g, b, a]. */
function palette(name) {
  const ha = HA[name] ?? null;
  const decls = name === "ha-dark" ? { ...LIGHT_DECLS, ...DARK_DECLS } : LIGHT_DECLS;
  const out = {};
  for (const key of Object.keys(decls)) {
    if (!/^(text|muted|bg|surface2?|line|accent|accent-fg|focus|error|error-bg|warn|warn-bg|ok|ok-bg|heat|heat-bg|heat-line|cool|cool-bg|cool-line|off|off-bg|off-line|field-line)$/.test(key)) continue;
    out[key] = parseColour(resolveValue(decls[key], ha, decls));
  }
  return out;
}

const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
const channel = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export function contrast(fg, bg) {
  const solidBg = bg.slice(0, 3);
  const a = luminance(over(fg, bg.length === 4 && bg[3] < 1 ? [...solidBg, 1] : bg));
  const b = luminance(solidBg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("the contrast function knows the reference values", () => {
  assert.equal(contrast([0, 0, 0, 1], [255, 255, 255, 1]).toFixed(2), "21.00");
  assert.equal(contrast([255, 255, 255, 1], [255, 255, 255, 1]).toFixed(2), "1.00");
  assert.equal(contrast([119, 119, 119, 1], [255, 255, 255, 1]).toFixed(2), "4.48"); // #777 on white
});

const MODES = ["heat", "cool", "off"];

// Text on its background: every pair needs 4.5:1.
function textPairs(p) {
  const pairs = [
    ["text", "surface"],
    ["text", "surface2"],
    ["muted", "surface"],
    ["error", "surface"],
    ["warn", "surface"],
    ["ok", "surface"],
    ["error", "error-bg"],
    ["warn", "warn-bg"],
    ["ok", "ok-bg"],
    ["text", "error-bg"],
    ["text", "warn-bg"],
    ["error-bg", "error"], // icon in the red badge of a day tab
  ];
  for (const m of MODES) {
    pairs.push([m, `${m}-bg`]); // text drawn in the colour of the mode (bar segments)
    pairs.push(["text", `${m}-bg`]); // fields, hints and labels of a band row
    pairs.push(["error", `${m}-bg`]); // error line inside a row
    pairs.push(["warn", `${m}-bg`]); // warning line inside a row
    pairs.push([m, "surface"]); // placeholder titles and tags on a card
  }
  return pairs;
}

// Borders and graphic objects: 3:1 where possible.
function graphicPairs() {
  const pairs = [
    ["error", "surface"],
    ["field-line", "surface"], // border of inputs, selects and stepper buttons
  ];
  for (const m of MODES) {
    pairs.push([`${m}-line`, "surface"]); // border of a row / segment on a card
    pairs.push([`${m}-line`, "surface2"]); // border of a segment on the bar
    pairs.push([m, `${m}-bg`]); // icon, side stripe and stripes inside a tinted element
  }
  return pairs;
}

for (const name of ["fallback", "ha-light", "ha-dark"]) {
  test(`text pairs reach 4.5:1 (${name})`, () => {
    const p = palette(name);
    for (const [fg, bg] of textPairs(p)) {
      assert.ok(contrast(p[fg], p[bg]) >= 4.5, `${name}: ${fg} on ${bg} is ${contrast(p[fg], p[bg]).toFixed(2)}`);
    }
  });

  test(`borders and graphic objects reach 3:1 (${name})`, () => {
    const p = palette(name);
    for (const [fg, bg] of graphicPairs(p)) {
      assert.ok(contrast(p[fg], p[bg]) >= 3, `${name}: ${fg} on ${bg} is ${contrast(p[fg], p[bg]).toFixed(2)}`);
    }
  });
}

// The tint of a mode against the surface it sits on is, by design, a light wash (1.1-1.4:1):
// the mode is NOT said by that wash alone. Every element that uses it also has the icon of the
// mode, its name in text, the temperature, and the border of the mode colour (checked above at 3:1).
// The same goes for "calculated": a dashed border, the word "calcolata" / "calculated", the
// stripes on the side or at the foot of the element (checked above as mode colour on its tint).
test("the tints of the modes are redundant with icon and text (documented, not a contrast target)", () => {
  const p = palette("ha-light");
  for (const m of MODES) assert.ok(contrast(p[`${m}-bg`], p.surface2) < 3, `${m}-bg is a wash by design`);
  const day = readFileSync(new URL("../../custom_components/cronotermostato/frontend/components/crono-day.js", import.meta.url), "utf8");
  const row = readFileSync(new URL("../../custom_components/cronotermostato/frontend/components/crono-band-row.js", import.meta.url), "utf8");
  assert.match(row, /iconMode\(band\.mode\)/); // icon of the mode in the row
  assert.match(row, /t\(`mode\.\$\{band\.mode\}`\)/); // and its name
  assert.match(day, /iconMode\(row\.mode\)/); // icon in the segment
  assert.match(day, /aria-label=\$\{this\._segmentLabel/); // and the full text for assistive technology
});

// Theme-owned colours: --crono-accent / --crono-focus come from the theme of HA. HA's own default
// primary colour (#03a9f4) is light: white text on it is 2.7:1 and the focus ring on a white card
// 2.7:1. We do not override a colour the user chose in the theme; with our fallback (used when the
// theme gives nothing) both pass. Recorded here so a change is noticed.
test("theme-owned accent: passes with our fallback, known to fall short with the HA default blue", () => {
  const f = palette("fallback");
  assert.ok(contrast(f["accent-fg"], f.accent) >= 4.5);
  assert.ok(contrast(f.focus, f.surface) >= 3);
  const l = palette("ha-light");
  assert.ok(contrast(l["accent-fg"], l.accent) < 4.5, "if this starts to pass, drop the note above");
});

test("the hatch is not drawn behind text: .is-auto has no background image", () => {
  const rule = /\.is-auto\s*\{[^}]*\}/.exec(SRC)?.[0] ?? "";
  assert.ok(rule.length > 0);
  assert.doesNotMatch(rule, /background-image|gradient/);
  const row = readFileSync(new URL("../../custom_components/cronotermostato/frontend/components/crono-band-row.js", import.meta.url), "utf8");
  assert.doesNotMatch(row, /\.row\s*\{[^}]*gradient/);
});
