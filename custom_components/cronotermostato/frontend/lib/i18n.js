// Translations: the language comes from `hass.locale.language` or
// `hass.language`, then English, then the key itself. Strings are plain text
// (never HTML); `{name}` placeholders are replaced with text only.

import it from "../i18n/it.js";
import en from "../i18n/en.js";

const TABLES = { it, en };
const FALLBACK = "en";

/** Two-letter language of a hass ("it-IT" -> "it"), "en" when unknown. */
export function languageOf(hass) {
  const raw = hass?.locale?.language ?? hass?.language;
  return typeof raw === "string" && raw ? raw.toLowerCase().split(/[-_]/)[0] : FALLBACK;
}

/** The locale of HA for numbers and dates (`hass.locale.language`, then `hass.language`), "en" when unknown or not valid. Never the one of the browser. */
export function localeOf(hass) {
  const raw = hass?.locale?.language ?? hass?.language;
  if (typeof raw !== "string" || !raw) return FALLBACK;
  try {
    return Intl.getCanonicalLocales(raw)[0];
  } catch {
    return FALLBACK;
  }
}

/** A number in the language of HA. */
export function formatNumber(hass, value, options = {}) {
  return Number(value).toLocaleString(localeOf(hass), options);
}

const lookup = (language, key) => {
  const table = Object.hasOwn(TABLES, language) ? TABLES[language] : null;
  return table && Object.hasOwn(table, key) ? table[key] : undefined;
};

export function t(hass, key, params = {}) {
  const text = lookup(languageOf(hass), key) ?? lookup(FALLBACK, key) ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params ?? {}, name) ? String(params[name]) : match));
}

/** `t` bound to a hass object (read at every call, so a language change is followed). */
export function createT(hass) {
  return (key, params) => t(hass, key, params);
}

/** Plural form: uses `${key}_one` / `${key}_other` and the parameter `count`. */
export function tn(hass, key, count, params = {}) {
  const form = new Intl.PluralRules(Object.hasOwn(TABLES, languageOf(hass)) ? languageOf(hass) : FALLBACK).select(count) === "one" ? "one" : "other";
  return t(hass, `${key}_${form}`, { ...params, count });
}
