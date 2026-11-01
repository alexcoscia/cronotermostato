// Is the theme dark? Home Assistant says it with `hass.themes.darkMode`, but a custom theme may
// define only dark colour variables without declaring a dark mode (darkMode false or missing).
// Our own colours for the modes and the statuses come in a light and a dark set, so deciding from
// `darkMode` alone would put light-theme colours (light amber, pink) under the light text of such a
// theme. So the decision is taken on the colours actually in use: the theme is dark when its text
// is lighter than its card surface. `darkMode` is only the answer when the colours cannot be read.

const luminance = ([r, g, b]) => {
  const c = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};

let canvasContext;

/** [r, g, b] of any CSS colour the browser understands (hex, rgb, hsl, oklch, named...), or null. */
export function parseColor(text) {
  const value = String(text ?? "").trim();
  if (value === "") return null;
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (m) {
    const hex = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  try {
    canvasContext ??= globalThis.document?.createElement?.("canvas")?.getContext?.("2d", { willReadFrequently: true }) ?? null;
    if (!canvasContext) return null;
    canvasContext.clearRect(0, 0, 1, 1);
    canvasContext.fillStyle = "transparent"; // an invalid `value` below leaves this one: alpha 0, so null
    canvasContext.fillStyle = value;
    canvasContext.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = canvasContext.getImageData(0, 0, 1, 1).data;
    return a === 0 ? null : [r, g, b];
  } catch {
    return null;
  }
}

/** true / false from the resolved --crono-text and --crono-surface of `host`; null when unreadable. */
export function darkFromColors(host) {
  try {
    if (typeof globalThis.getComputedStyle !== "function") return null;
    const style = globalThis.getComputedStyle(host);
    const text = parseColor(style.getPropertyValue("--crono-text"));
    const surface = parseColor(style.getPropertyValue("--crono-surface"));
    if (!text || !surface) return null;
    return luminance(text) > luminance(surface);
  } catch {
    return null;
  }
}

/**
 * Set the `dark` attribute of a component that defines the tokens. Before the first render the
 * colours are not computed yet, so `darkMode` is used (`syncTheme(host, hass)` in willUpdate);
 * after the render the colours decide (`syncTheme(host, hass, true)` in updated).
 */
export function syncTheme(host, hass, measure = false) {
  const declared = hass?.themes?.darkMode === true;
  const measured = measure && host.isConnected === true ? darkFromColors(host) : null;
  host.toggleAttribute?.("dark", measured ?? declared);
}

/**
 * After a change of `hass`: measure now and once more on the next frame, because Home Assistant
 * applies the variables of a theme to the page around the time it changes `hass.themes`.
 */
export function watchTheme(host, hass, previousHass) {
  syncTheme(host, hass, true);
  if (previousHass?.themes !== hass?.themes && typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => syncTheme(host, host.hass, true));
  }
}
