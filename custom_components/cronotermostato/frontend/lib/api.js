// Calls to the WebSocket API and the services of the integration. No DOM.
// Every failure becomes an EditorError {code, message, detailCode}:
//   code: conflict | not_found | invalid_format | unauthorized | not_loaded | network
//   detailCode: the `detail_code` of the server answer (the stable ProgramError
//   code: overlap, bad_time, program_in_use...) or null.
// The server remains the authority; the editor only asks and shows.

import { stripAuto, serializeBand } from "./model.js";

const DOMAIN = "cronotermostato";
const SERVER_CODES = new Set(["conflict", "not_found", "invalid_format", "unauthorized", "not_loaded"]);

export class EditorError extends Error {
  constructor(code, message, detailCode = null) {
    super(message || code);
    this.name = "EditorError";
    this.code = code;
    this.detailCode = detailCode;
  }
}

/** Any rejection of `callWS`/`callService`/`subscribeMessage` as an EditorError. */
export function toEditorError(err) {
  if (err instanceof EditorError) return err;
  if (err !== null && typeof err === "object" && typeof err.code === "string") {
    const code = SERVER_CODES.has(err.code) ? err.code : "invalid_format";
    const detail = typeof err.detail_code === "string" ? err.detail_code : null;
    return new EditorError(code, typeof err.message === "string" ? err.message : err.code, detail);
  }
  // No string code: the connection (numeric codes of the socket, Error objects).
  const message = err instanceof Error ? err.message : typeof err?.message === "string" ? err.message : "Connection error";
  return new EditorError("network", message);
}

async function ws(hass, message) {
  try {
    return await hass.callWS(message);
  } catch (err) {
    throw toEditorError(err);
  }
}

async function service(hass, name, data) {
  try {
    await hass.callService(DOMAIN, name, data);
  } catch (err) {
    throw toEditorError(err);
  }
}

const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== null));

/** The state: {programs, rooms, country, subdiv, options}. Programs and rooms are as the server sends them. */
export async function loadState(hass) {
  const result = (await ws(hass, { type: `${DOMAIN}/state` })) ?? {};
  return {
    programs: Array.isArray(result.programs) ? result.programs : [],
    rooms: Array.isArray(result.rooms) ? result.rooms : [],
    country: result.country ?? null,
    subdiv: result.subdiv ?? null,
    options: { admin_only: true, ...(result.options ?? {}) },
  };
}

/** Normalized bands of one day (with the automatic ones). Drafts are serialized first. */
export async function previewDay(hass, bands) {
  const sent = stripAuto(Array.isArray(bands) ? bands : []).map((b) =>
    b !== null && typeof b === "object" && !Array.isArray(b) ? serializeBand(b) : b,
  );
  const result = await ws(hass, { type: `${DOMAIN}/preview_day`, bands: sent });
  return Array.isArray(result?.bands) ? result.bands : [];
}

export async function loadCountries(hass) {
  return (await ws(hass, { type: `${DOMAIN}/countries` })) ?? {};
}

/** Create (no programId) or update. Automatic bands are dropped here too. Returns {programId, revision}. */
export async function saveProgram(hass, { programId, name, week, holiday, expectedRevision }) {
  const result = await ws(hass, {
    type: `${DOMAIN}/save_program`,
    ...compact({ program_id: programId }),
    name,
    week: stripAuto(week),
    holiday: stripAuto(holiday),
    ...compact({ expected_revision: expectedRevision }),
  });
  return { programId: result.program_id, revision: result.revision };
}

export async function deleteProgram(hass, programId, expectedRevision) {
  await ws(hass, { type: `${DOMAIN}/delete_program`, program_id: programId, ...compact({ expected_revision: expectedRevision }) });
}

export async function assign(hass, programId, climateEntityId) {
  await ws(hass, { type: `${DOMAIN}/assign`, program_id: programId, climate_entity_id: climateEntityId });
}

export async function unassign(hass, climateEntityId) {
  await ws(hass, { type: `${DOMAIN}/unassign`, climate_entity_id: climateEntityId });
}

export const pauseRoom = (hass, climateEntityId) => service(hass, "pause", { climate_entity_id: climateEntityId });
export const resumeRoom = (hass, climateEntityId) => service(hass, "resume", { climate_entity_id: climateEntityId });
export const resumeAuto = (hass, climateEntityId) => service(hass, "resume_auto", { climate_entity_id: climateEntityId });

/** Force a setting until the end of the current band. `off` never carries temperature or preset. */
export function setManual(hass, climateEntityId, { mode, temperature, preset }) {
  const data = { climate_entity_id: climateEntityId, mode };
  if (mode !== "off") {
    if (temperature !== undefined && temperature !== null && temperature !== "") data.temperature = temperature;
    if (typeof preset === "string" && preset.trim() !== "") data.preset = preset;
  }
  return service(hass, "set_manual", data);
}

/**
 * Listen to `changed` events. Returns a function that cancels (idempotent,
 * safe before the subscription is established). Options:
 *   onError(EditorError): the subscription could not be made (e.g. not_loaded);
 *   onReconnect(): the socket reconnected, so events may have been missed.
 */
export function subscribe(hass, onChange, { onError, onReconnect } = {}) {
  let cancelled = false;
  let unsub = null;
  const connection = hass.connection;
  const onReady = () => {
    if (!cancelled) onReconnect?.();
  };
  connection.addEventListener?.("ready", onReady);
  Promise.resolve()
    .then(() =>
      connection.subscribeMessage(
        (event) => {
          if (!cancelled && event?.type === "changed") onChange();
        },
        { type: `${DOMAIN}/subscribe` },
      ),
    )
    .then(
      (fn) => {
        if (cancelled) fn();
        else unsub = fn;
      },
      (err) => {
        if (!cancelled) onError?.(toEditorError(err));
      },
    );
  return () => {
    if (cancelled) return;
    cancelled = true;
    connection.removeEventListener?.("ready", onReady);
    if (unsub) {
      const fn = unsub;
      unsub = null;
      fn();
    }
  };
}
