import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Contrast of the colour pairs defined in styles.js, computed for real (WCAG 2.x
// relative luminance) in three situations:
//  - "fallback": no Home Assistant theme variables, light (the fallbacks in styles.js);
//  - "ha-light" / "ha-dark": the default light and dark themes of Home Assistant;
//  - "custom-dark": a dark theme that only defines the dark CSS variables and does NOT declare a
//    dark mode (`hass.themes.darkMode` false or missing). "custom-dark" is the case behind "I cannot
//    read the settings with my dark theme": the set of colours is chosen by lib/theme.js from the
//    colours of the theme (text lighter than surface), not from `darkMode`.
// There is no "dark with fallbacks": `dark` is only set when the theme colours are dark, so the HA
// variables are always there.
//
// Text needs 4.5:1. Borders and graphic objects need 3:1 where that is possible
// without losing the amber / blue / grey of the modes. Where a pair cannot reach
// it, the state is also said with an icon and a text, never with colour alone, and
// the exception is listed in COLOUR_ONLY_BUT_REDUNDANT with the reason.

import "./dom-stub.mjs";
import { darkFromColors, parseColor } from "../../custom_components/cronotermostato/frontend/lib/theme.js";

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
  "custom-dark": {
    "primary-text-color": "#e0e1dd",
    "secondary-text-color": "#b0b8c4",
    "primary-background-color": "#0d1b2a",
    "secondary-background-color": "#22304a",
    "card-background-color": "#1b263b",
    "divider-color": "#415a77",
    "primary-color": "#ffb703",
    "text-primary-color": "#000000",
  },
  "custom-light": {
    "primary-text-color": "#3e2723",
    "secondary-text-color": "#6d4c41",
    "primary-background-color": "#fff3e0",
    "secondary-background-color": "#ffe0b2",
    "card-background-color": "#fffaf0",
    "divider-color": "#d7ccc8",
    "primary-color": "#6a1b9a",
    "text-primary-color": "#ffffff",
  },
};

/** What lib/theme.js decides for the variables of a theme: the same code the components run. */
function isDark(ha) {
  const saved = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => ({ "--crono-text": ha["primary-text-color"], "--crono-surface": ha["card-background-color"] })[name] ?? "",
  });
  try {
    return darkFromColors({});
  } finally {
    globalThis.getComputedStyle = saved;
  }
}

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
  if (!/^(#|rgb)/.test(value) && !/^var\(/.test(value)) {
    const c = parseColor(value); // hsl, oklch...: parsed the way the browser would
    if (c) return `rgb(${c.join(",")})`;
  }
  const v = /^var\(\s*--crono-([\w-]+)\s*\)$/.exec(value);
  if (v) return resolveValue(decls[v[1]], ha, decls);
  const m = /^var\(\s*--([\w-]+)\s*,\s*(.+)\)$/.exec(value);
  if (m) return ha && Object.hasOwn(ha, m[1]) ? ha[m[1]] : m[2].trim();
  return value;
}

/** All the --crono-* colours of a situation, as [r, g, b, a]. */
function palette(name) {
  const ha = HA[name] ?? null;
  const decls = ha && isDark(ha) ? { ...LIGHT_DECLS, ...DARK_DECLS } : LIGHT_DECLS;
  const out = {};
  for (const key of Object.keys(decls)) {
    if (!/^(text|muted|bg|surface2?|line|accent|focus|error|error-bg|warn|warn-bg|ok|ok-bg|heat|heat-bg|heat-line|cool|cool-bg|cool-line|off|off-bg|off-line|field-line|(?:heat|cool|off)-v[1-3](?:-bg|-line)?)$/.test(key)) continue;
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
  // The fills of the modes are saturated (not washes): the only text drawn on them is the colour of the
  // mode itself (bar segments, chips of the card), checked here; error / warn / ordinary text never
  // sits on a mode fill (the rows have the surface as background).
  for (const m of MODES) pairs.push([m, `${m}-bg`]);
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

const SITUATIONS = ["fallback", "ha-light", "ha-dark", "custom-dark", "custom-light"];
for (const name of SITUATIONS) {
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

// The fill of a mode is a full colour, but the mode is still NOT said by colour alone: every element
// that uses it also has the icon of the mode, its name in text, the temperature, and the border of
// the mode colour (checked above at 3:1). The same goes for "calculated": a dashed border, the word
// "calcolata" / "calculated", the stripes on the side or at the foot of the element.
test("the fills of the modes are redundant with icon and text", () => {
  const day = readFileSync(new URL("../../custom_components/cronotermostato/frontend/components/crono-day.js", import.meta.url), "utf8");
  const row = readFileSync(new URL("../../custom_components/cronotermostato/frontend/components/crono-band-row.js", import.meta.url), "utf8");
  assert.match(row, /iconMode\(band\.mode\)/); // icon of the mode in the row
  assert.match(row, /t\(`mode\.\$\{band\.mode\}`\)/); // and its name
  assert.match(day, /iconMode\(row\.mode\)/); // icon in the segment
  assert.match(day, /aria-label=\$\{label\}/); // and the full text for assistive technology
});

// Variants of colour of the bar, the strip of the week and the chip of a row: each mode has 4 fills
// (variant 0 = the plain colour of the mode, 1..3 = --crono-<mode>-v<n>-bg / -v<n> / -v<n>-line). The
// variants must (a) keep text at 4.5:1 and the border at 3:1 against the surface, (b) differ from each
// other by a clearly visible CIEDE2000 (>= 15), and (c) never be mistaken for another mode: the fills
// of different modes are >= 15 apart too (no ΔE 7 exception any more); heat is amber / orange / red / purple, cool
// is azure / deep blue / sky blue / aqua, off is grey (low chroma); every fill stands out from the surface (dE >= 9).
const DAY_SRC = readFileSync(new URL("../../custom_components/cronotermostato/frontend/components/crono-day.js", import.meta.url), "utf8");
const WEEK_SRC = readFileSync(new URL("../../custom_components/cronotermostato/frontend/components/crono-week-tabs.js", import.meta.url), "utf8");
const ROW_SRC = readFileSync(new URL("../../custom_components/cronotermostato/frontend/components/crono-band-row.js", import.meta.url), "utf8");

const toLab = ([r, g, b]) => {
  const lin = (v) => channel(v);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hue = (y, x) => (x === 0 && y === 0 ? 0 : ((Math.atan2(y, x) * deg) + 360) % 360);
  const h1 = hue(b1, ap1);
  const h2 = hue(b2, ap2);
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh * rad) / 2);
  const Lb = (L1 + L2) / 2;
  const Cpb = (Cp1 + Cp2) / 2;
  let hb = h1 + h2;
  if (Cp1 * Cp2 !== 0) hb = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cpb;
  const Sh = 1 + 0.015 * Cpb * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}
const hueOf = ([, a, b]) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
const chromaOf = ([, a, b]) => Math.hypot(a, b);

/** The 4 variants of a mode in a situation: {bg, fg, line} as [r, g, b, a]. */
const variants = (p, m) => [
  { bg: p[`${m}-bg`], fg: p[m], line: p[`${m}-line`] },
  ...[1, 2, 3].map((n) => ({ bg: p[`${m}-v${n}-bg`], fg: p[`${m}-v${n}`], line: p[`${m}-v${n}-line`] })),
];

test("the sources use the variants: the day bar, the week strip and the chip of the row", async () => {
  const { TINT_COUNT } = await import("../../custom_components/cronotermostato/frontend/lib/day-editing.js");
  assert.equal(TINT_COUNT, 4);
  for (const m of MODES) for (const n of [1, 2, 3]) assert.match(SRC, new RegExp(`\\.b-${m}\\.v${n} \\{`));
  assert.match(DAY_SRC, /v\$\{tint\}/);
  assert.match(WEEK_SRC, /bandTints\(day\.rows\)/);
  assert.match(WEEK_SRC, /v\$\{tint\}/);
  assert.match(ROW_SRC, /_chipClass/);
  assert.match(DAY_SRC, /\.tint=\$\{tints/); // the row gets the variant of its segment
  assert.doesNotMatch(DAY_SRC, /color-mix/); // the old, invisible 8/15/22% wash is gone
});

for (const name of SITUATIONS) {
  test(`variants of every mode: text 4.5:1, border 3:1, fills >= 15 apart in CIEDE2000, no mix-up between modes (${name})`, () => {
    const p = palette(name);
    const all = [];
    for (const m of MODES) {
      const v = variants(p, m);
      v.forEach(({ bg, fg, line }, i) => {
        assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${m} v${i} text on fill is ${contrast(fg, bg).toFixed(2)}`);
        assert.ok(contrast(line, p.surface) >= 3, `${name}: ${m} v${i} border on surface is ${contrast(line, p.surface).toFixed(2)}`);
        assert.ok(contrast(line, p.surface2) >= 3, `${name}: ${m} v${i} border on bar is ${contrast(line, p.surface2).toFixed(2)}`);
        all.push({ m, i, lab: toLab(bg) });
      });
      for (let i = 0; i < v.length; i++) {
        for (let j = i + 1; j < v.length; j++) {
          const d = deltaE2000(toLab(v[i].bg), toLab(v[j].bg));
          assert.ok(d >= 15, `${name}: ${m} v${i}/v${j} differ by only dE ${d.toFixed(1)}`);
        }
      }
    }
    // families by hue (CIELAB hue angle) / chroma, each variant in its own colour name
    const FAMILY = {
      heat: [[55, 95, "amber"], [40, 65, "orange"], [20, 45, "red"], [300, 340, "purple"]],
      cool: [[255, 290, "azure"], [285, 305, "deep blue"], [215, 245, "sky blue"], [175, 205, "aqua"]],
    };
    for (const x of all) {
      const h = hueOf(x.lab);
      if (x.m === "off") assert.ok(chromaOf(x.lab) < 12, `${name}: off v${x.i} is not grey (chroma ${chromaOf(x.lab).toFixed(1)})`);
      else {
        const [lo, hi, label] = FAMILY[x.m][x.i];
        assert.ok(h >= lo && h <= hi, `${name}: ${x.m} v${x.i} should be ${label} (hue ${lo}-${hi}), is ${h.toFixed(0)}`);
        assert.ok(chromaOf(x.lab) >= 15, `${name}: ${x.m} v${x.i} is too grey (${chromaOf(x.lab).toFixed(1)}), it would pass for "off"`);
      }
      // a full fill, not a wash: it stands out from the surface it sits on
      for (const s of ["surface", "surface2"]) assert.ok(deltaE2000(x.lab, toLab(p[s])) >= 9, `${name}: ${x.m} v${x.i} is too close to ${s} (dE ${deltaE2000(x.lab, toLab(p[s])).toFixed(1)})`);
    }
    for (const x of all) for (const y of all) {
      if (x === y) continue;
      const d = deltaE2000(x.lab, y.lab);
      assert.ok(d >= 15, `${name}: ${x.m} v${x.i} and ${y.m} v${y.i} are only dE ${d.toFixed(1)} apart`);
    }
  });
}

// Primary button: white text on the accent of the theme darkened with color-mix (and, without
// color-mix, on a fixed dark teal). Both are read from styles.js and checked against the accents
// of the default HA themes, other realistic accents and a very dark one.
const PRIMARY = block(SRC, "  .btn.primary {");
const PRIMARY_MIX = /@supports[^{]*\{\s*\.btn\.primary\s*\{\s*background:\s*color-mix\(in srgb,\s*var\(--crono-accent\)\s*(\d+)%,\s*black\)/.exec(SRC);
const hexRgb = (h) => parseColour(h).slice(0, 3);

test("the primary button keeps white text on a fill that is dark enough for any accent", () => {
  assert.match(PRIMARY, /color:\s*#ffffff/);
  assert.ok(PRIMARY_MIX, "color-mix rule not found in styles.js");
  const share = Number(PRIMARY_MIX[1]) / 100;
  const white = [255, 255, 255, 1];
  const fallbackFill = parseColour(/background:\s*(#[0-9a-f]{6})/i.exec(PRIMARY)[1]);
  assert.ok(contrast(white, fallbackFill) >= 4.5, `fallback fill is ${contrast(white, fallbackFill).toFixed(2)}`);
  for (const accent of ["#03a9f4", "#ff9800", "#009688", "#ffeb3b", "#1a237e", "#000000"]) {
    const mixed = [...hexRgb(accent).map((v) => v * share), 1];
    assert.ok(contrast(white, mixed) >= 4.5, `${accent} -> ${contrast(white, mixed).toFixed(2)}`);
  }
});

test("the accent of HA is not used as a fill under light text", () => {
  assert.doesNotMatch(PRIMARY, /var\(--crono-accent/);
  assert.doesNotMatch(SRC, /color:\s*var\(--crono-accent-fg\)/);
});

// The accent and the focus ring still come from the theme (--crono-accent is text on program names,
// the focus ring on a white card with HA's default blue is 2.7:1): we do not override a colour the
// user chose in the theme; with our fallback both pass.
test("theme-owned focus ring: passes with our fallback", () => {
  const f = palette("fallback");
  assert.ok(contrast(f.focus, f.surface) >= 3);
});

test("the hatch is not drawn behind text: .is-auto has no background image", () => {
  const rule = /\.is-auto\s*\{[^}]*\}/.exec(SRC)?.[0] ?? "";
  assert.ok(rule.length > 0);
  assert.doesNotMatch(rule, /background-image|gradient/);
  const row = readFileSync(new URL("../../custom_components/cronotermostato/frontend/components/crono-band-row.js", import.meta.url), "utf8");
  assert.doesNotMatch(row, /\.row\s*\{[^}]*gradient/);
});

// Theme: outside styles.js a colour literal may only appear as the fallback of a Home Assistant
// variable, `var(--x, #fff)`; styles.js holds the tokens (and our own mode/status colours).
test("no colour literal outside styles.js unless it is the fallback of a CSS variable", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const dir = new URL("../../custom_components/cronotermostato/frontend/", import.meta.url).pathname;
  const files = (d) => readdirSync(d).flatMap((n) => (statSync(`${d}${n}`).isDirectory() ? files(`${d}${n}/`) : n.endsWith(".js") ? [`${d}${n}`] : []));
  const stripFallbacks = (text) => {
    let out = text;
    for (let i = 0; i < 6; i++) out = out.replace(/var\(\s*--[\w-]+\s*,(?:[^()]|\([^()]*\))*\)/g, "VAR");
    return out;
  };
  const found = [];
  for (const path of files(dir)) {
    if (/\/(styles|lit)\.js$/.test(path) || path.includes("/i18n/")) continue;
    const text = readFileSync(path, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    for (const m of stripFallbacks(text).matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)) found.push(`${path.slice(dir.length)}: ${m[0]}`);
  }
  assert.deepEqual(found, []);
});

// Accessibility: every transition/animation has its prefers-reduced-motion switch-off in the same file.
test("motion is switched off by prefers-reduced-motion wherever there is any", async () => {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../../custom_components/cronotermostato/frontend/components/", import.meta.url).pathname;
  const withMotion = readdirSync(dir).filter((n) => /\b(transition|animation)\s*:/.test(readFileSync(dir + n, "utf8")));
  assert.ok(withMotion.length >= 2, withMotion.join());
  for (const n of withMotion) assert.match(readFileSync(dir + n, "utf8"), /@media \(prefers-reduced-motion: reduce\)/, n);
});

// Phone: each component either sizes itself by its container (a container query, mobile first) or
// has a layout that is fluid on its own; the second kind is listed with the reason, so a new
// component cannot slip in without a decision. (The checks at 320 and 360 px were done in a browser.)
const FLUID = {
  "crono-dialog.js": "width: min(480px, 100vw - 32px), content scrolls",
  "crono-manual-dialog.js": "lives inside crono-dialog; single column form",
  "crono-holiday.js": "flex-wrap line of text and one link, min-height 44px",
  "crono-rooms.js": "a list; every crono-room-card has its own container query",
  "crono-card.js": "the rooms view is fluid",
  "crono-card-editor.js": "single column form inside the HA card editor dialog",
};
test("every component is responsive: a container/media query or a listed fluid layout", async () => {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../../custom_components/cronotermostato/frontend/components/", import.meta.url).pathname;
  for (const n of readdirSync(dir)) {
    const text = readFileSync(dir + n, "utf8");
    const responsive = /container-type:\s*inline-size/.test(text) && /@container|@media \((?:max|min)-width/.test(text);
    assert.ok(responsive || n in FLUID, `${n} has neither a container query nor an entry in FLUID`);
    if (n in FLUID) assert.ok(!responsive, `${n} is listed as fluid but has container queries: drop it from FLUID`);
  }
  assert.doesNotMatch(readFileSync(dir + "../cronotermostato.js", "utf8"), /100vw(?!\s*-\s*32px)/);
});

// The decision "is the theme dark" is taken on the colours, not on `darkMode`.
test("lib/theme.js: dark is decided from the colours of the theme", () => {
  assert.equal(isDark(HA["ha-light"]), false);
  assert.equal(isDark(HA["ha-dark"]), true);
  assert.equal(isDark(HA["custom-dark"]), true); // darkMode false/missing in HA, dark colours
  assert.equal(isDark(HA["custom-light"]), false);
});

test("a dark theme without darkMode would be unreadable with the light set of colours (the bug)", () => {
  const ha = HA["custom-dark"];
  const light = {};
  for (const key of Object.keys(LIGHT_DECLS)) if (/^(text|surface|heat|heat-bg|cool|cool-bg|off|off-bg|error|error-bg|warn|warn-bg)$/.test(key)) light[key] = parseColour(resolveValue(LIGHT_DECLS[key], ha, LIGHT_DECLS));
  const failing = [["text", "heat-bg"], ["text", "cool-bg"], ["text", "off-bg"], ["text", "warn-bg"], ["error", "surface"]].filter(([a, b]) => contrast(light[a], light[b]) < 4.5);
  assert.ok(failing.length >= 4, `light set under a dark theme should fail, failing: ${failing.join(" ")}`);
});

test("parseColor reads hex, rgb and (through the canvas, when there is one) other formats", () => {
  assert.deepEqual(parseColor("#1b263b"), [27, 38, 59]);
  assert.deepEqual(parseColor("#fff"), [255, 255, 255]);
  assert.deepEqual(parseColor("rgba(225, 225, 225, 0.12)"), [225, 225, 225]);
  assert.equal(parseColor(""), null);
  assert.equal(parseColor("var(--x)"), null); // no canvas in node: unreadable, not a guess
});

test("when the colours cannot be read the declared darkMode decides (and nothing throws)", () => {
  assert.equal(darkFromColors({}), null); // no getComputedStyle in node
  const saved = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  try {
    assert.equal(darkFromColors({}), null);
  } finally {
    globalThis.getComputedStyle = saved;
  }
});

test("the components use lib/theme.js and never decide the theme from darkMode alone", async () => {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../../custom_components/cronotermostato/frontend/components/", import.meta.url).pathname;
  for (const n of readdirSync(dir)) {
    const text = readFileSync(dir + n, "utf8");
    assert.doesNotMatch(text, /toggleAttribute\(\s*"dark"/, `${n} sets dark by hand`);
  }
  for (const n of ["crono-editor.js", "crono-card.js", "crono-card-editor.js"]) {
    const text = readFileSync(dir + n, "utf8");
    assert.match(text, /syncTheme\(this, this\.hass\)/, n);
    assert.match(text, /watchTheme\(this, this\.hass, changed\.get\("hass"\)\)/, n);
  }
});

// Native controls and the browser defaults that do not follow our colours by themselves.
test("native controls follow the set in use: color-scheme, option and placeholder colours", () => {
  assert.equal(LIGHT_DECLS["field-line"], "#6f7a88");
  assert.match(SRC, /color-scheme:\s*light/);
  assert.match(block(SRC, ":host([dark])"), /color-scheme:\s*dark/);
  assert.match(SRC, /::placeholder\s*\{[^}]*color:\s*var\(--crono-muted\)/);
  assert.match(SRC, /option\s*\{[^}]*background:\s*var\(--crono-surface\)[^}]*color:\s*var\(--crono-text\)/);
  const dialog = readFileSync(new URL("../../custom_components/cronotermostato/frontend/components/crono-dialog.js", import.meta.url), "utf8");
  assert.match(dialog, /dialog\s*\{[^}]*background:\s*var\(--crono-surface\)[^}]*color:\s*var\(--crono-text\)/); // the UA gives <dialog> Canvas/CanvasText
});
