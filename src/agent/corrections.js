// Deterministic detection of classifier misroutes. Pure logic only — no DB, no network, no LLM —
// so it is unit testable without a database, matching this repo's convention (itemTracking.js,
// schema.scoping.test.js).
//
// See docs/superpowers/specs/2026-09-17-correction-capture-design.md. The exclusions below are
// load-bearing: this feeds a dataset that grows without review, so a signal that is merely
// *plausible* is worse than no signal at all.

// The four actions that create an item a later turn could retract.
const CAPTURE_ACTIONS = ['add_todo', 'add_note', 'add_event', 'set_reminder'];

// Which delete action retracts which kind of item.
const DELETE_ACTIONS = { delete_note: 'note', delete_event: 'event' };

// `lastCapture` is the breadcrumb written when a capture action ran: {action, itemType, msg}.
// Its TTL in the state table is the correction window, so an expired breadcrumb arrives as null
// and nothing can be claimed.
function detectFromAction({ action, lastCapture }) {
  if (!lastCapture || !CAPTURE_ACTIONS.includes(lastCapture.action)) return null;

  if (action === 'undo_last') {
    return { message: lastCapture.msg, rejected: [lastCapture.action], signal: 'undo_last' };
  }

  // complete_todo is deliberately absent: finishing a todo shortly after adding it is ordinary
  // use. update_todo is absent because the routing was right and only the text was wrong.
  const retracts = DELETE_ACTIONS[action];
  if (retracts && retracts === lastCapture.itemType) {
    return {
      message: lastCapture.msg,
      rejected: [lastCapture.action],
      signal: 'delete_after_create',
    };
  }

  return null;
}

// Two different clarifications share the pending_clarification: state key and are both answered
// yes/no (brain.js:826-870). Only the destructive_action one is a routing signal: declining it
// means the classifier proposed the wrong action. Declining a note merge means "save it
// separately", which is a storage preference.
function detectFromClarification({ type, action, msg, answeredNo }) {
  if (!answeredNo || type !== 'destructive_action' || !action) return null;
  return { message: msg, rejected: [action], signal: 'confirmation_declined' };
}

module.exports = { CAPTURE_ACTIONS, detectFromAction, detectFromClarification };
