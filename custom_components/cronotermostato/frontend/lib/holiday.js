// Small pure helpers of the holiday part: how the country is named, which days
// the "Copy to" dialog offers, and when a click on a link stays inside HA.
// No DOM. Text that comes from the server is only ever passed on as a string.

import { HOLIDAY } from "./day-editing.js";

/** Page of the integration in HA, where the country and subdivision are changed. */
export const integrationPath = "/config/integrations/integration/cronotermostato";

const WEEK = [0, 1, 2, 3, 4, 5, 6];

const regionName = (code, language) => {
  if (code === "ZZ") return code; // Intl calls it "Unknown Region"
  for (const lang of [language, "en"]) {
    try {
      const name = new Intl.DisplayNames([lang], { type: "region", fallback: "none" }).of(code);
      if (typeof name === "string" && name.trim() !== "" && name !== code) return name;
    } catch {
      // a language or a code that Intl does not accept: try the next one
    }
  }
  return code;
};

/**
 * How to show the holiday location: {country, subdiv, text}. The name of the
 * country is the one of the language of HA (the `countries` command of the server
 * only lists codes), the code itself when it has no name. null when no country is
 * configured. `text` is plain text, e.g. "Italia (RM)".
 */
export function locationLabel(country, subdiv, language = "en") {
  if (typeof country !== "string" || country.trim() === "") return null;
  const code = country.trim();
  const sub = typeof subdiv === "string" && subdiv.trim() !== "" ? subdiv.trim() : null;
  const name = /^[A-Za-z]{2}$/.test(code) ? regionName(code.toUpperCase(), language) : code;
  return { country: name, subdiv: sub, text: sub ? `${name} (${sub})` : name };
}

/** Days that can receive a copy of `from` (0..6 or HOLIDAY): everything but the source, the holiday last. */
export function copyTargetIds(from) {
  return [...WEEK, HOLIDAY].filter((d) => d !== from);
}

/** The quick choices of the dialog. The holiday part is never picked by them: it is a choice of its own. */
export function quickTargets(kind, from) {
  const pick = (days) => days.filter((d) => d !== from);
  if (kind === "weekdays") return pick(WEEK.slice(0, 5));
  if (kind === "weekend") return pick([5, 6]);
  if (kind === "all") return pick(WEEK);
  return [];
}

/** True for a plain left click (no modifier key, nothing else handled it) that may navigate inside HA, and only when no edit would be lost. */
export function shouldHandleClick(event, dirty) {
  if (dirty) return false;
  return event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
