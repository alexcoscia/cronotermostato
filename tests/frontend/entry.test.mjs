import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

// The entry point is loaded by Home Assistant as a module, possibly twice (panel module and
// card resource, versioned URLs) and next to other custom cards: it must define things once and
// never throw because of what is (or is not) on `window`.
const ENTRY = "../../custom_components/cronotermostato/frontend/cronotermostato.js";

test("loading the module twice defines each element once and announces the card once", async () => {
  window.customCards = undefined;
  await import(`${ENTRY}?load=1`);
  await import(`${ENTRY}?load=2`);
  for (const name of ["cronotermostato-panel", "cronotermostato-card", "cronotermostato-card-editor", "crono-editor"]) {
    assert.ok(customElements.get(name), name);
  }
  assert.equal(window.customCards.filter((c) => c.type === "cronotermostato-card").length, 1);
});

test("a missing, empty or foreign window.customCards never makes the load fail", async () => {
  const { announceCard } = await import("../../custom_components/cronotermostato/frontend/components/crono-card.js");
  for (const before of [undefined, null, "nope", {}, 7, [], [null, { type: "other" }]]) {
    window.customCards = before;
    assert.doesNotThrow(() => announceCard(), String(before));
    assert.equal(window.customCards.filter((c) => c?.type === "cronotermostato-card").length, 1);
    assert.doesNotThrow(() => announceCard());
    assert.equal(window.customCards.filter((c) => c?.type === "cronotermostato-card").length, 1);
  }
});

test("the panel is a plain element that Home Assistant can create and set up before it is connected", async () => {
  await import(`${ENTRY}?load=3`);
  const Panel = customElements.get("cronotermostato-panel");
  const panel = new Panel();
  panel.hass = undefined;
  panel.narrow = true;
  assert.doesNotThrow(() => panel.render());
  panel.hass = { language: "en" };
  panel.narrow = false;
  assert.doesNotThrow(() => panel.render());
});
