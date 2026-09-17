// The detector decides what counts as the user telling us the classifier was wrong. It is pure,
// so every signal and every deliberate exclusion is pinned here without a database.
//
// The exclusions matter more than the inclusions. A dataset that auto-grows is only worth having
// if a wrong label cannot get into it, and the two most tempting signals — finishing a todo you
// just added, and declining a note merge — are both ordinary use, not corrections.
//
// See docs/superpowers/specs/2026-09-17-correction-capture-design.md.

const test = require('node:test');
const assert = require('node:assert');

const {
  CAPTURE_ACTIONS, detectFromAction, detectFromClarification,
} = require('../src/agent/corrections');

const capture = (over = {}) => ({
  action: 'add_todo', itemType: 'todo', msg: 'remind me to call the bank', ...over,
});

// ── Signals that are logged ──────────────────────────────────────────────────

test('undo_last marks the preceding capture as a misroute', () => {
  const found = detectFromAction({ action: 'undo_last', lastCapture: capture() });
  assert.deepStrictEqual(found, {
    message: 'remind me to call the bank',
    rejected: ['add_todo'],
    signal: 'undo_last',
  });
});

test('deleting a note right after adding one is a correction', () => {
  const found = detectFromAction({
    action: 'delete_note',
    lastCapture: capture({ action: 'add_note', itemType: 'note', msg: 'note: pooler is on 6543' }),
  });
  assert.deepStrictEqual(found, {
    message: 'note: pooler is on 6543',
    rejected: ['add_note'],
    signal: 'delete_after_create',
  });
});

test('deleting an event right after adding one is a correction', () => {
  const found = detectFromAction({
    action: 'delete_event',
    lastCapture: capture({ action: 'add_event', itemType: 'event', msg: 'standup at 9' }),
  });
  assert.strictEqual(found.signal, 'delete_after_create');
  assert.deepStrictEqual(found.rejected, ['add_event']);
});

test('declining a destructive-action confirmation is a misroute', () => {
  const found = detectFromClarification({
    type: 'destructive_action', action: 'complete_todo',
    msg: 'the dispatch refactor', answeredNo: true,
  });
  assert.deepStrictEqual(found, {
    message: 'the dispatch refactor',
    rejected: ['complete_todo'],
    signal: 'confirmation_declined',
  });
});

// ── Deliberate exclusions ────────────────────────────────────────────────────

test('completing a just-added todo is NOT a correction', () => {
  // Adding "call the bank" and marking it done nine minutes later is ordinary use. This is the
  // most frequent plausible signal and the noisiest; including it would swamp the dataset.
  assert.strictEqual(
    detectFromAction({ action: 'complete_todo', lastCapture: capture() }), null);
});

test('updating a just-added todo is NOT a correction', () => {
  // The routing was right and only the extracted text was wrong. That is a content bug, not a
  // classifier misroute, and it does not belong in a routing dataset.
  assert.strictEqual(
    detectFromAction({ action: 'update_todo', lastCapture: capture() }), null);
});

test('declining a note merge is NOT a correction', () => {
  // Both clarifications live under the same pending_clarification: key and are both answered
  // "no". This one means "save it separately" — a storage preference, not a statement that
  // add_note was the wrong action.
  assert.strictEqual(detectFromClarification({
    type: 'note_merge', action: 'add_note', msg: 'some note', answeredNo: true,
  }), null);
});

test('accepting a destructive-action confirmation is NOT a correction', () => {
  assert.strictEqual(detectFromClarification({
    type: 'destructive_action', action: 'complete_todo', msg: 'x', answeredNo: false,
  }), null);
});

// ── Guards ───────────────────────────────────────────────────────────────────

test('nothing is detected without a breadcrumb', () => {
  // The breadcrumb TTL is the correction window. Once it expires there is no claim to make.
  assert.strictEqual(detectFromAction({ action: 'undo_last', lastCapture: null }), null);
});

test('a delete is not a correction when the last capture was a different type', () => {
  assert.strictEqual(detectFromAction({
    action: 'delete_note', lastCapture: capture({ action: 'add_event', itemType: 'event' }),
  }), null);
});

test('a breadcrumb from a non-capture action is ignored', () => {
  assert.strictEqual(detectFromAction({
    action: 'undo_last', lastCapture: capture({ action: 'list_todos' }),
  }), null);
});

test('the capture list is exactly the four actions that create an item', () => {
  assert.deepStrictEqual([...CAPTURE_ACTIONS].sort(),
    ['add_event', 'add_note', 'add_todo', 'set_reminder']);
});
