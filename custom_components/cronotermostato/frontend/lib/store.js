// Reactive state of the editor: {programs, rooms, country, subdiv, options,
// loading, error, notLoaded}. No DOM.
//
// * `changed` events of the server are debounced (250 ms, at most 2 s from the
//   first of a burst) into one `state` read.
// * `not_loaded` (state or subscription) sets `notLoaded` and retries with a
//   growing delay; on success it subscribes again. The server sends `changed`
//   after an entry reload, but only to a subscription that exists: so after
//   any failure the client checks the state itself and resubscribes.
// * A reconnection of the socket rereads the state (events may have been missed).
// * `stop()` leaves no listener, timer or subscription, and late answers are ignored.

import { loadState, subscribe, toEditorError } from "./api.js";

export const DEBOUNCE_MS = 250;
export const MAX_WAIT_MS = 2000; // a continuous burst of events still reads at least this often
export const RETRY_MS = [5000, 15000, 30000];

const RETRY_CODES = new Set(["not_loaded", "network"]);

const initialState = () => ({
  programs: [],
  rooms: [],
  country: null,
  subdiv: null,
  options: { admin_only: true },
  loading: true,
  error: null,
  notLoaded: false,
});

const byNameThenId = (a, b) => String(a.name).localeCompare(String(b.name)) || String(a.program_id).localeCompare(String(b.program_id));

export function createStore({ debounceMs = DEBOUNCE_MS, maxWaitMs = MAX_WAIT_MS, retryMs = RETRY_MS } = {}) {
  let state = initialState();
  let hass = null;
  let active = false;
  let generation = 0; // changes on every start/stop: answers of an older run are ignored
  let readSeq = 0;
  let inFlight = false;
  let rerun = false;
  let debounceTimer = null;
  let maxTimer = null;
  let readOk = false; // the last read worked
  let subOk = false; // the subscription is established
  let retryTimer = null;
  let retryIndex = 0;
  let cancelSubscription = null;
  const listeners = new Set();

  const set = (patch) => {
    state = { ...state, ...patch };
    [...listeners].forEach((fn) => fn(state));
  };

  const clearTimers = () => {
    clearTimeout(debounceTimer);
    clearTimeout(retryTimer);
    clearTimeout(maxTimer);
    debounceTimer = retryTimer = maxTimer = null;
  };

  // The retry delays restart only when both the read and the subscription work.
  const maybeResetRetry = () => {
    if (readOk && subOk) retryIndex = 0;
  };

  function scheduleRetry() {
    if (retryTimer !== null || !active) return;
    const delay = retryMs[Math.min(retryIndex, retryMs.length - 1)];
    retryIndex += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      refresh();
    }, delay);
  }

  function ensureSubscription() {
    if (!active || cancelSubscription) return;
    const run = generation;
    const cancel = subscribe(hass, onChanged, {
      onError: (err) => {
        if (run !== generation || cancelSubscription !== cancel) return;
        cancel(); // idempotent; also removes anything the subscription left
        cancelSubscription = null;
        subOk = false;
        handleError(err);
      },
      onSubscribed: () => {
        if (run !== generation || cancelSubscription !== cancel) return;
        subOk = true;
        maybeResetRetry();
      },
      onReconnect: onChanged,
    });
    cancelSubscription = cancel;
  }

  function handleError(err) {
    if (err.code === "not_loaded") set({ loading: false, error: null, notLoaded: true });
    else set({ loading: false, error: err, notLoaded: false });
    if (RETRY_CODES.has(err.code)) scheduleRetry();
  }

  async function read() {
    if (!active) return;
    if (inFlight) {
      rerun = true;
      return;
    }
    inFlight = true;
    const run = generation;
    const seq = ++readSeq;
    try {
      const loaded = await loadState(hass);
      if (run !== generation || seq !== readSeq) return;
      readOk = true;
      maybeResetRetry();
      set({
        programs: [...loaded.programs].sort(byNameThenId),
        rooms: loaded.rooms,
        country: loaded.country,
        subdiv: loaded.subdiv,
        options: loaded.options,
        loading: false,
        error: null,
        notLoaded: false,
      });
      ensureSubscription();
    } catch (err) {
      if (run !== generation || seq !== readSeq) return;
      readOk = false;
      handleError(toEditorError(err));
      ensureSubscription();
    } finally {
      if (run === generation) {
        inFlight = false;
        if (rerun) {
          rerun = false;
          read();
        }
      }
    }
  }

  /** Read now (no debounce). */
  function refresh() {
    clearTimeout(retryTimer);
    retryTimer = null;
    return read();
  }

  function onChanged() {
    if (!active) return;
    const fire = () => {
      clearTimeout(debounceTimer);
      clearTimeout(maxTimer);
      debounceTimer = maxTimer = null;
      read();
    };
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fire, debounceMs);
    if (maxTimer === null) maxTimer = setTimeout(fire, maxWaitMs);
  }

  return {
    getState: () => state,
    /** Listen to state changes; returns the function that removes the listener. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Use the newest `hass` for the next calls (HA replaces the object at every state change). */
    setHass(next) {
      hass = next;
    },
    start(initialHass) {
      hass = initialHass;
      if (active) return;
      active = true;
      generation += 1;
      retryIndex = 0;
      readOk = subOk = false;
      inFlight = false;
      rerun = false;
      set({ loading: true });
      read();
    },
    stop() {
      if (!active) return;
      active = false;
      generation += 1;
      inFlight = false;
      rerun = false;
      clearTimers();
      cancelSubscription?.();
      cancelSubscription = null;
      readOk = subOk = false;
    },
    refresh,
  };
}
