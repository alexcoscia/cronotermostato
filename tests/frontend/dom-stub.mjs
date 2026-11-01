// Just enough of a browser for the Lit bundle to load in node (no rendering):
// the tests look at the templates (strings and bound values), not at a DOM.
globalThis.window ??= globalThis;
globalThis.HTMLElement ??= class HTMLElement {};
globalThis.document ??= { createTreeWalker: () => ({}), createElement: () => ({}), createComment: () => ({}) };
const registry = new Map();
globalThis.customElements ??= { get: (name) => registry.get(name), define: (name, ctor) => registry.set(name, ctor) };
