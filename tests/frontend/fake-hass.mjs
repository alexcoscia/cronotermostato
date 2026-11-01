// A fake `hass` for the data-layer tests: records calls, lets a test answer
// WebSocket commands, emit subscription events and fail things.
export function makeHass({ states = {}, language, locale, ws = {} } = {}) {
  const hass = {
    states,
    language,
    locale,
    wsCalls: [],
    serviceCalls: [],
    subs: [], // {msg, cb, active, unsubCalls}
    wsHandlers: { ...ws }, // type -> (msg) => result | throws
    serviceHandler: null,
    subscribeError: null,
    readyListeners: new Set(),
  };
  hass.callWS = async (msg) => {
    hass.wsCalls.push(msg);
    if (!(msg.type in hass.wsHandlers)) throw { code: "unknown_command", message: `no handler for ${msg.type}` };
    const handler = hass.wsHandlers[msg.type];
    return typeof handler === "function" ? handler(msg) : handler;
  };
  hass.callService = async (domain, service, data) => {
    hass.serviceCalls.push({ domain, service, data });
    if (hass.serviceHandler) return hass.serviceHandler(domain, service, data);
    return undefined;
  };
  hass.connection = {
    subscribeMessage: async (cb, msg) => {
      if (hass.subscribeError) throw hass.subscribeError;
      const sub = { msg, cb, active: true, unsubCalls: 0 };
      hass.subs.push(sub);
      return () => {
        sub.unsubCalls += 1;
        sub.active = false;
      };
    },
    addEventListener: (name, fn) => name === "ready" && hass.readyListeners.add(fn),
    removeEventListener: (name, fn) => name === "ready" && hass.readyListeners.delete(fn),
  };
  hass.activeSubs = () => hass.subs.filter((s) => s.active);
  hass.emit = (event = { type: "changed" }) => hass.activeSubs().forEach((s) => s.cb(event));
  hass.wsCount = (type) => hass.wsCalls.filter((m) => m.type === type).length;
  return hass;
}

export const flush = () => new Promise((resolve) => setImmediate(resolve));
