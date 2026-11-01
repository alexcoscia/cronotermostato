import "./dom-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { syncAction, revisionsToIgnore } from "../../custom_components/cronotermostato/frontend/lib/day-editing.js";

const FE = "../../custom_components/cronotermostato/frontend";

test("syncAction: the revision we have is in sync and clears the ignored ones", () => {
  assert.deepEqual(syncAction({ revision: 3, original: 3, ignored: new Set([2]), dirty: true }), { action: "synced", ignored: new Set() });
});

test("syncAction: an ignored revision is skipped, another one is a conflict when dirty and a reload otherwise", () => {
  assert.equal(syncAction({ revision: 2, original: 3, ignored: new Set([2]), dirty: true }).action, "ignore");
  assert.equal(syncAction({ revision: 4, original: 3, ignored: new Set([2]), dirty: true }).action, "conflict");
  assert.equal(syncAction({ revision: 4, original: 3, ignored: new Set([2]), dirty: false }).action, "reload");
});

test("revisionsToIgnore: after a save, the revision we started from and the ones seen in the conflict", () => {
  const set = revisionsToIgnore({ ignored: new Set([1]), savedFrom: 2, conflicts: new Set([5, null]) });
  assert.deepEqual([...set].sort(), [1, 2, 5]);
});

test("after Overwrite, a late read of the OTHER editor's revision does not bring back its content", async () => {
  const { CronoEditor } = await import(`${FE}/components/crono-editor.js`);
  const { makeHass, flush } = await import("./fake-hass.mjs");
  const mine = { program_id: "p", name: "P", revision: "r1", week: [[], [], [], [], [], [], []], holiday: [] };
  const hass = makeHass({
    language: "it",
    ws: {
      "cronotermostato/save_program": (msg) => ({ revision: "r3" }),
    },
  });
  const editor = new CronoEditor();
  editor.hass = hass;
  editor._store.refresh = async () => {};
  editor._loadDraft(mine);
  // we edit: the draft differs from the original
  editor._draft = { ...editor._draft, week: editor._draft.week.map((d, i) => (i === 0 ? [{ key: "k", start: "08:00", end: "10:00", mode: "heat", temperature: 20, preset: null, auto: false }] : d)) };
  // the other editor saved r2: a read brings it, we are dirty -> conflict
  editor._syncDraft({ ...mine, revision: "r2", week: [[{ start: "01:00", end: "02:00", mode: "off" }], [], [], [], [], [], []] });
  assert.equal(editor._conflict, true);
  // Overwrite succeeds with r3
  await editor._save(true);
  assert.equal(editor._conflict, false);
  assert.equal(editor._original.revision, "r3");
  // a slow read still carries r2 (the other editor's content): it must be ignored
  const mineDraft = editor._draft;
  editor._syncDraft({ ...mine, revision: "r2", week: [[{ start: "01:00", end: "02:00", mode: "off" }], [], [], [], [], [], []] });
  assert.equal(editor._draft, mineDraft, "the draft was not replaced");
  assert.equal(editor._conflict, false);
  // and so does one with the revision we started from
  editor._syncDraft({ ...mine, revision: "r1" });
  assert.equal(editor._draft, mineDraft);
  // the read of our own save ends it
  editor._syncDraft({ ...mine, revision: "r3" });
  assert.equal(editor._ignored.size, 0);
  await flush();
});
