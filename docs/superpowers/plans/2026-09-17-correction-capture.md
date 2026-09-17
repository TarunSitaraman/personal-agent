# Correction Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically capture classifier misroutes as negative eval cases, so `eval/captured.json` grows with real failures instead of only when `--capture` is run by hand.

**Architecture:** A breadcrumb written on every capture action (`memory.saveState`, 10-minute TTL) plus two pure detector functions that recognise an unambiguous correction in the following turn. Detections are written to a new `classifier_corrections` table in Postgres, because Vercel's filesystem is read-only. A local export command turns those rows into `{rejected: [...], accept: null}` cases that the eval asserts immediately as "must not classify as X".

**Tech Stack:** Node 20+, CommonJS, `pg`, built-in `node --test` runner. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-correction-capture-design.md`

## Global Constraints

- **No new npm dependencies.** Tests use the built-in `node --test` runner — the absence of a test framework is deliberate (CLAUDE.md → Conventions).
- **No AI attribution in commits.** No `Co-Authored-By`, no session trailers, no tool mentions. Conventional-commit format only (CLAUDE.md → Conventions).
- **Every query touching a user-owned table must filter on `user_id`** — enforced by `test/schema.scoping.test.js`.
- **Every query must pass at least as many params as its highest `$N`** — enforced by `test/schema.params.test.js`.
- **No added LLM calls on the message path.** Detection is deterministic only.
- **`eval/captured.json` stays gitignored** (`.gitignore:31`). It holds real WhatsApp text.
- Run `npm test` before every commit.

---

### Task 1: Negative-case scoring

The leaf of the dependency graph — pure functions, no DB, no network. Everything else builds on the record shape this task establishes.

**Files:**
- Modify: `src/eval/scoring.js`
- Test: `test/eval.scoring.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `scoreCase(actual: string[], accept: string[][] | null, rejected?: string[]) -> boolean`. The third parameter is new and optional, so existing two-argument calls keep working unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `test/eval.scoring.test.js`:

```js
// A correction case knows what was WRONG, not what was right. It asserts the classifier does
// not reproduce the rejected action — a real regression test that needs no labeling.
test('a rejected-only case passes when the rejected action is absent', () => {
  assert.strictEqual(scoreCase(['set_reminder'], null, ['add_todo']), true);
});

test('a rejected-only case fails when the rejected action comes back', () => {
  assert.strictEqual(scoreCase(['add_todo'], null, ['add_todo']), false);
});

test('a rejected-only case fails if the rejected action appears alongside others', () => {
  assert.strictEqual(scoreCase(['add_todo', 'set_reminder'], null, ['add_todo']), false);
});

test('accept takes precedence once the case has been upgraded with a label', () => {
  // Reviewing a correction can fill in `accept`. From then on it is an ordinary positive case
  // and `rejected` is ignored, so a hand-supplied label always wins over the inferred negative.
  assert.strictEqual(scoreCase(['add_todo'], [['add_todo']], ['add_todo']), true);
});

test('a case with neither accept nor rejected does not silently pass', () => {
  // A malformed case must not look like a green test. run_eval filters these out, but scoring
  // must not be the thing that hides them.
  assert.strictEqual(scoreCase(['add_todo'], null, []), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/eval.scoring.test.js`
Expected: FAIL. The first three fail because `scoreCase` ignores its third argument and calls `accept.some(...)` on `null`, throwing `TypeError: Cannot read properties of null (reading 'some')`.

- [ ] **Step 3: Implement the scoring rule**

In `src/eval/scoring.js`, replace the `scoreCase` function with:

```js
// `accept` is a list of acceptable action sets, e.g. [["list_todos"], ["none"]].
// `rejected` is a list of action names the classifier must NOT produce. It comes from a captured
// correction, where the user's own undo/delete told us the routing was wrong but not what was
// right. `accept` wins when both are present: a hand-supplied label beats an inferred negative.
function scoreCase(actual, accept, rejected) {
  if (Array.isArray(accept) && accept.length) {
    const got = key(actual);
    return accept.some(alt => key(alt) === got);
  }
  if (Array.isArray(rejected) && rejected.length) {
    return !rejected.some(name => actual.includes(name));
  }
  return false;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/eval.scoring.test.js`
Expected: PASS, including the pre-existing scoring tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/eval/scoring.js test/eval.scoring.test.js
git commit -m "feat: score eval cases that assert a rejected action"
```

---

### Task 2: The correction detector

Pure logic, no DB access, so it is unit testable without Postgres — the same shape as `src/agent/itemTracking.js`, which is this repo's precedent for testable diff logic.

**Files:**
- Create: `src/agent/corrections.js`
- Test: `test/corrections.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CAPTURE_ACTIONS: string[]`
  - `detectFromAction({ action, lastCapture }) -> {message, rejected, signal} | null`
  - `detectFromClarification({ type, action, msg, answeredNo }) -> {message, rejected, signal} | null`

  A `lastCapture` breadcrumb is `{action: string, itemType: 'todo'|'note'|'event', msg: string}`.

- [ ] **Step 1: Write the failing tests**

Create `test/corrections.test.js`:

```js
// The detector decides what counts as the user telling us the classifier was wrong. It is pure,
// so every signal and every deliberate exclusion is pinned here without a database.
//
// The exclusions matter more than the inclusions. A dataset that auto-grows is only worth having
// if a wrong label cannot get into it, and the two most tempting signals — finishing a todo you
// just added, and declining a note merge — are both ordinary use, not corrections.

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/corrections.test.js`
Expected: FAIL with `Cannot find module '../src/agent/corrections'`.

- [ ] **Step 3: Implement the detector**

Create `src/agent/corrections.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/corrections.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/agent/corrections.js test/corrections.test.js
git commit -m "feat: deterministic detector for classifier misroutes"
```

---

### Task 3: Schema and persistence

**Files:**
- Modify: `src/migrate_db.js` (insert a step before the `OWNED` loop at line 185; add to the `OWNED` array)
- Modify: `src/agent/memory.js` (three functions plus exports)
- Modify: `test/schema.scoping.test.js` (add the table to `OWNED`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `memory.recordCorrection({ message, rejected, signal }) -> Promise<void>`
  - `memory.getUnexportedCorrections() -> Promise<Array<{id, message, rejected_action, signal}>>`
  - `memory.markCorrectionsExported(ids: string[]) -> Promise<void>`

**Ordering note:** the `OWNED` loop at `migrate_db.js:189` runs `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS user_id` over every owned table, and step 13 later sets those columns `NOT NULL`. A table added to `OWNED` but created afterwards makes that loop throw `relation "classifier_corrections" does not exist`. So the table is created *before* the loop, with a nullable `user_id` that the loop backfills and step 13 tightens — exactly how every other owned table is handled.

- [ ] **Step 1: Write the failing test**

`test/schema.scoping.test.js` already asserts that its `OWNED` list equals the one in `migrate_db.js`. Add the new table to the test's list only, so the assertion fails until the migration is updated too.

In `test/schema.scoping.test.js`, change the `OWNED` array to:

```js
const OWNED = [
  'todos', 'notes', 'events', 'learnings', 'knowledge', 'goals',
  'conversations', 'state', 'skills', 'user_insights',
  'pending_messages', 'entity_links', 'reminders', 'classifier_corrections',
];
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/schema.scoping.test.js`
Expected: FAIL on "the owned-table list matches what the migration actually stamps" — the two arrays differ.

- [ ] **Step 3: Create the table in the migration**

In `src/migrate_db.js`, immediately **before** the line `const OWNED = ['todos', 'notes', ...` (line 185), insert:

```js
    // 11b. Captured classifier misroutes. Created here, before the OWNED loop below, because that
    // loop ALTERs every owned table to add user_id — a table added to OWNED but created later
    // makes it throw. user_id is nullable here and tightened to NOT NULL by step 13, which is how
    // every other owned table gets its column.
    // See docs/superpowers/specs/2026-09-17-correction-capture-design.md.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classifier_corrections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message TEXT NOT NULL,
        rejected_action TEXT[] NOT NULL,
        signal TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        exported_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_corrections_unexported
        ON classifier_corrections (created_at) WHERE exported_at IS NULL;
    `);
    console.log('✔ classifier_corrections table and index created/verified');

```

Then add `'classifier_corrections'` to the `OWNED` array on the following lines so it reads:

```js
     const OWNED = ['todos', 'notes', 'events', 'learnings', 'knowledge', 'goals',
                   'conversations', 'state', 'skills', 'user_insights',
                   'pending_messages', 'entity_links', 'reminders',
                   'classifier_corrections'];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/schema.scoping.test.js`
Expected: PASS.

- [ ] **Step 5: Add the memory functions**

In `src/agent/memory.js`, add these three functions next to the other correction-free CRUD helpers (anywhere after `getState`; keep them adjacent to each other):

```js
// Captured classifier misroutes. Written in production because Vercel's filesystem is read-only,
// and exported into eval/captured.json locally by src/eval/import_corrections.js.
async function recordCorrection({ message, rejected, signal }) {
  await pool.query(
    `INSERT INTO classifier_corrections (message, rejected_action, signal, user_id)
     VALUES ($1, $2, $3, $4)`,
    [message, rejected, signal, currentUserId()]
  );
}

async function getUnexportedCorrections() {
  const { rows } = await pool.query(
    `SELECT id, message, rejected_action, signal FROM classifier_corrections
     WHERE exported_at IS NULL AND user_id = $1
     ORDER BY created_at ASC`,
    [currentUserId()]
  );
  return rows;
}

async function markCorrectionsExported(ids) {
  if (!ids || !ids.length) return;
  await pool.query(
    `UPDATE classifier_corrections SET exported_at = NOW()
     WHERE id = ANY($1::uuid[]) AND user_id = $2`,
    [ids, currentUserId()]
  );
}
```

Add them to the `module.exports` object at the bottom of the file:

```js
  recordCorrection, getUnexportedCorrections, markCorrectionsExported,
```

- [ ] **Step 6: Run the schema guards**

Run: `node --test test/schema.scoping.test.js test/schema.params.test.js`
Expected: PASS. Both guards now cover the three new queries — each filters on `user_id` and each passes exactly as many params as its highest `$N`.

- [ ] **Step 7: Run the migration against the database**

Run: `node src/migrate_db.js`
Expected: `✔ classifier_corrections table and index created/verified` appears, followed by `Migrations completed successfully!`. The migration is idempotent — run it twice and confirm the second run is clean.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/migrate_db.js src/agent/memory.js test/schema.scoping.test.js
git commit -m "feat: classifier_corrections table and persistence"
```

---

### Task 4: Wire detection into the message path

**Files:**
- Modify: `src/agent/brain.js` — inside `executeAction` (line 1328), the clarification branch near line 859, and the clarification `saveState` calls at lines 1062 and 1119

**Why detection lives inside `executeAction`:** there are eight `executeAction` call sites (lines 801, 864, 1080, 1084, 1136, 1147, 1316). `undo_last` is not in `RETRIEVAL_ACTIONS`, so it runs down the classifier path at line 1136 — instrumenting the Path A dispatch at 1080-1084 would miss it entirely. One hook inside the function covers every path and cannot drift as call sites are added.

**Interfaces:**
- Consumes: `detectFromAction`, `detectFromClarification`, `CAPTURE_ACTIONS` from Task 2; `memory.recordCorrection` from Task 3; the existing `memory.saveState(key, value, ttlMinutes)` and `memory.getState(key)`.
- Produces: the `last_capture` breadcrumb, shape `{action, itemType, msg}`, under state key `last_capture`.

**Failure policy:** every call added here is fire-and-forget with a `.catch()`. A correction that fails to record must never break the reply the user is waiting for — this is instrumentation, and instrumentation that can take down the message path is worse than no instrumentation.

- [ ] **Step 1: Write the failing test**

Create `test/corrections.wiring.test.js`:

```js
// The detector is unit-tested in corrections.test.js. This pins the wiring: that a capture leaves
// a breadcrumb the next turn can read, and that recording a correction can never break the reply.

const test = require('node:test');
const assert = require('node:assert');

const memory = require('../src/agent/memory');
const { executeAction } = require('../src/agent/brain');

test.afterEach(() => test.mock.restoreAll());

test('a capture action leaves a breadcrumb for the next turn', async () => {
  const saved = [];
  test.mock.method(memory, 'addTodo', async () => {});
  test.mock.method(memory, 'saveState', async (key, value, ttl) => { saved.push({ key, value, ttl }); });

  await executeAction('add_todo', { content: 'buy milk' }, null);

  const crumb = saved.find(s => s.key === 'last_capture');
  assert.ok(crumb, 'add_todo must leave a last_capture breadcrumb');
  assert.strictEqual(crumb.value.action, 'add_todo');
  assert.strictEqual(crumb.value.itemType, 'todo');
  assert.strictEqual(crumb.value.msg, 'buy milk');
  assert.strictEqual(crumb.ttl, 10, 'the TTL is the correction window');
});

test('a retrieval action leaves no breadcrumb', async () => {
  const saved = [];
  test.mock.method(memory, 'getPendingTodos', async () => []);
  test.mock.method(memory, 'saveState', async (key, value) => { saved.push({ key, value }); });

  await executeAction('list_todos', {}, null);

  assert.strictEqual(saved.find(s => s.key === 'last_capture'), undefined);
});

test('a breadcrumb failure does not break the reply', async () => {
  test.mock.method(memory, 'addTodo', async () => {});
  test.mock.method(memory, 'saveState', async () => { throw new Error('state table down'); });

  const reply = await executeAction('add_todo', { content: 'buy milk' }, null);

  assert.match(reply, /buy milk/, 'the user still gets their confirmation');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/corrections.wiring.test.js`
Expected: FAIL — `add_todo must leave a last_capture breadcrumb`, because nothing writes one yet.

- [ ] **Step 3: Add the breadcrumb to executeAction**

In `src/agent/brain.js`, add near the top of the file with the other requires:

```js
const { detectFromAction, detectFromClarification } = require('./corrections');
```

Then inside `executeAction`, immediately before the `switch (action)` statement, add:

```js
  // Breadcrumb for correction capture: if the next turn retracts what this action just created,
  // that is evidence the classifier misrouted. The 10-minute TTL on the state row is the
  // correction window — see docs/superpowers/specs/2026-09-17-correction-capture-design.md.
  // Fire-and-forget: instrumentation must never break the reply the user is waiting for.
  const CRUMB_ITEM_TYPE = {
    add_todo: 'todo', set_reminder: 'todo', add_note: 'note', add_event: 'event',
  };
  if (CRUMB_ITEM_TYPE[action]) {
    const msg = data?.content || data?.title || '';
    if (msg) {
      memory.saveState('last_capture', { action, itemType: CRUMB_ITEM_TYPE[action], msg }, 10)
        .catch(err => console.error('[Corrections] breadcrumb failed:', err.message));
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/corrections.wiring.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Record corrections from the action path**

In `src/agent/brain.js`, inside `executeAction`, immediately **before** the breadcrumb block added in Step 3 (so the previous turn's crumb is read before this turn overwrites it), add:

```js
  // Correction capture: did this turn retract what the previous one created? Only three actions
  // can be a retraction, so the breadcrumb is read for those and nothing else — an ordinary
  // message costs no extra query. This lives inside executeAction rather than at a call site
  // because there are eight of them and undo_last runs down the classifier path, not Path A.
  const CORRECTION_TRIGGERS = ['undo_last', 'delete_note', 'delete_event'];
  if (CORRECTION_TRIGGERS.includes(action)) {
    const crumb = await memory.getState('last_capture').catch(() => null);
    const correction = detectFromAction({ action, lastCapture: crumb });
    if (correction) {
      memory.recordCorrection(correction)
        .catch(err => console.error('[Corrections] record failed:', err.message));
    }
  }
```

Add a test to `test/corrections.wiring.test.js` pinning that this fires on the path `undo_last` actually takes:

```js
test('undo_last records a correction against the previous capture', async () => {
  const recorded = [];
  test.mock.method(memory, 'getState', async key =>
    key === 'last_capture' ? { action: 'add_todo', itemType: 'todo', msg: 'buy milk' } : null);
  test.mock.method(memory, 'getLastCreatedItem', async () => null);
  test.mock.method(memory, 'recordCorrection', async c => { recorded.push(c); });

  await executeAction('undo_last', {}, null);

  assert.strictEqual(recorded.length, 1);
  assert.deepStrictEqual(recorded[0].rejected, ['add_todo']);
  assert.strictEqual(recorded[0].signal, 'undo_last');
});

test('an ordinary action reads no breadcrumb', async () => {
  // The read is gated to the three retraction actions, so the common path costs no extra query.
  const reads = [];
  test.mock.method(memory, 'getPendingTodos', async () => []);
  test.mock.method(memory, 'getState', async key => { reads.push(key); return null; });

  await executeAction('list_todos', {}, null);

  assert.strictEqual(reads.includes('last_capture'), false);
});
```

- [ ] **Step 6: Carry the user's message into the clarification state**

The destructive-action signal needs the message that triggered the confirmation, which the saved state does not currently hold. In `src/agent/brain.js`, at **both** `saveState('pending_clarification:...')` calls for `destructive_action` (lines 1062 and 1119), add `msg: userMessage` to the saved object, so each reads:

```js
      await memory.saveState(`pending_clarification:${replyTo}`, {
        type: 'destructive_action',
        msg: userMessage,
        data: { action: synthAction, data: synthData, defaultReply: parsed.reply }
      });
```

(At line 1119 the variable names are `primaryAction` / `primaryData` rather than `synthAction` / `synthData` — keep whichever names that branch already uses and add only the `msg` line.)

- [ ] **Step 7: Record corrections from the clarification path**

In the `destructive_action` branch near line 859, inside the `isNo` case — where the user has declined the proposed action — add before the existing reply is returned:

```js
        const declined = detectFromClarification({
          type: clarification.type,
          action: clarification.data?.action,
          msg: clarification.msg,
          answeredNo: true,
        });
        if (declined) {
          memory.recordCorrection(declined)
            .catch(err => console.error('[Corrections] record failed:', err.message));
        }
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: all tests pass. If `brain.executeAction.test.js` fails because `saveState` is now called and unmocked, mock it in the affected tests the same way Task 4's wiring test does — do not weaken the breadcrumb.

- [ ] **Step 9: Verify end-to-end against the database**

Create a throwaway script at the repo root (delete it afterwards — it must not be committed):

```js
require('dotenv').config();
const memory = require('./src/agent/memory');
const { withOwner } = require('./src/agent/context');
const { executeAction } = require('./src/agent/brain');

(async () => {
  await withOwner(async () => {
    await executeAction('add_todo', { content: 'ZZTEMP correction probe' }, null);
    await new Promise(r => setTimeout(r, 300));
    await executeAction('undo_last', {}, null);
    await new Promise(r => setTimeout(r, 300));
    const rows = await memory.getUnexportedCorrections();
    console.log('captured:', JSON.stringify(rows.filter(r => r.message.includes('ZZTEMP'))));
  });
  process.exit(0);
})();
```

Run it. Expected: one row with `rejected_action: ["add_todo"]` and `signal: "undo_last"`.

Then clean up both the probe row and the todo. Extend the same throwaway script rather than opening a second connection — the repo's pool sets `ssl: { rejectUnauthorized: false }` (`memory.js:13`, a known pre-existing issue in CLAUDE.md → Ops), and a new script that copies that line spreads it to another file:

```js
    // append inside the withOwner block, after the console.log
    const { rows: gone } = await memory.pool.query(
      `DELETE FROM classifier_corrections WHERE message LIKE 'ZZTEMP%' RETURNING id`);
    const { rows: todosGone } = await memory.pool.query(
      `DELETE FROM todos WHERE content LIKE 'ZZTEMP%' RETURNING id`);
    console.log('cleaned up:', gone.length, 'corrections,', todosGone.length, 'todos');
```

If `memory.js` does not export `pool`, add it to `module.exports` — a single shared pool with one TLS configuration is the point. Expected: both counts reported. Delete the probe script file afterwards; it must not be committed.

- [ ] **Step 10: Commit**

```bash
git add src/agent/brain.js test/corrections.wiring.test.js
git commit -m "feat: record classifier misroutes from undo, delete and declined confirmations"
```

---

### Task 5: Export corrections into the eval set

**Files:**
- Create: `src/eval/import_corrections.js`
- Modify: `src/eval/run_eval.js` (pass `c.rejected` to `scoreCase`; make the failure printout null-safe)
- Modify: `package.json` (one script entry)

**Interfaces:**
- Consumes: `memory.getUnexportedCorrections`, `memory.markCorrectionsExported` from Task 3; `scoreCase(actual, accept, rejected)` from Task 1.
- Produces: `npm run eval:import`, appending `{msg, rejected, accept: null, reviewed: false}` records to `eval/captured.json`.

- [ ] **Step 1: Write the failing test**

Append to `test/eval.scoring.test.js`:

```js
// run_eval prints accepted values on failure. A correction case has accept: null, so the printout
// must not be the thing that crashes the run that found the regression.
const { describeExpectation } = require('../src/eval/scoring');

test('a rejected-only case describes its expectation without an accept list', () => {
  assert.match(describeExpectation({ accept: null, rejected: ['add_todo'] }), /not add_todo/);
});

test('a labeled case describes its accepted sets', () => {
  assert.match(
    describeExpectation({ accept: [['add_todo'], ['set_reminder']] }),
    /add_todo \| set_reminder/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/eval.scoring.test.js`
Expected: FAIL — `describeExpectation is not a function`.

- [ ] **Step 3: Add the helper to scoring.js**

In `src/eval/scoring.js`, add before `module.exports`:

```js
// How a case's expectation reads in the failure printout. A correction case has no accept list,
// so the raw `accept.map(...)` in run_eval would throw on exactly the cases this feature adds.
function describeExpectation(c) {
  if (Array.isArray(c.accept) && c.accept.length) {
    return c.accept.map(a => a.join(' + ')).join(' | ');
  }
  if (Array.isArray(c.rejected) && c.rejected.length) {
    return `anything not ${c.rejected.join(' or ')}`;
  }
  return '(nothing asserted)';
}
```

Update the exports line to:

```js
module.exports = { actionsFrom, scoreCase, describeExpectation };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/eval.scoring.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the new scoring into run_eval**

In `src/eval/run_eval.js`:

Change the import to include the helper:

```js
const { actionsFrom, scoreCase, describeExpectation } = require('./scoring');
```

(If the existing import destructures different names, keep them and add `describeExpectation`.)

Change the scoring call from `const pass = scoreCase(actual, c.accept);` to:

```js
    const pass = scoreCase(actual, c.accept, c.rejected);
```

Change the failure printout from `accepted ${f.accept.map(a => a.join(' + ')).join(' | ')}` to:

```js
    console.log(`  FAIL "${f.msg}"\n       got ${f.actual.join(' + ') || '(none)'}, expected ${describeExpectation(f)}`);
```

- [ ] **Step 6: Write the export command**

Create `src/eval/import_corrections.js`:

```js
// Exports captured classifier misroutes from Postgres into eval/captured.json.
//
// Production writes corrections to the database because Vercel's filesystem is read-only, so this
// runs locally, against the same database, to bring them into the eval set. A correction enters
// as a negative case — {rejected, accept: null} — which run_eval asserts as "must not classify as
// this" with no labeling effort. It stays reviewed:false, so nothing is asserted until reviewed.
//
// See docs/superpowers/specs/2026-09-17-correction-capture-design.md.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const memory = require('../agent/memory');
const { withOwner } = require('../agent/context');

const CAPTURED = path.join(__dirname, '..', '..', 'eval', 'captured.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

async function main() {
  await withOwner(async () => {
    const rows = await memory.getUnexportedCorrections();
    if (!rows.length) {
      console.log('No new corrections to export.');
      return;
    }

    const existing = readJson(CAPTURED);
    const seen = new Set(existing.map(c => c.msg));

    let added = 0;
    for (const row of rows) {
      // Idempotent on re-run, and a message already labeled by hand is never overwritten by an
      // inferred negative.
      if (seen.has(row.message)) continue;
      existing.push({
        msg: row.message,
        rejected: row.rejected_action,
        accept: null,
        reviewed: false,
        signal: row.signal,
      });
      seen.add(row.message);
      added++;
    }

    fs.writeFileSync(CAPTURED, JSON.stringify(existing, null, 2) + '\n');
    await memory.markCorrectionsExported(rows.map(r => r.id));

    console.log(`Exported ${added} new correction(s) into eval/captured.json` +
      (rows.length - added ? `, skipped ${rows.length - added} already present` : '') + '.');
    console.log('Each asserts "must not classify as X" once you set "reviewed": true.');
    console.log('Optionally fill in "accept" to upgrade it to a positive case.');
  });
  process.exit(0);
}

main().catch(err => { console.error('Export failed:', err.message); process.exit(1); });
```

- [ ] **Step 7: Add the npm script**

In `package.json`, add to `scripts`:

```json
    "eval:import": "node src/eval/import_corrections.js"
```

- [ ] **Step 8: Verify the export round-trip**

Seed one correction, export it, and confirm the eval asserts it:

```bash
node -e "require('dotenv').config();const m=require('./src/agent/memory');const{withOwner}=require('./src/agent/context');withOwner(async()=>{await m.recordCorrection({message:'ZZTEMP export probe',rejected:['add_todo'],signal:'undo_last'});console.log('seeded');}).then(()=>process.exit(0))"
npm run eval:import
```

Expected: `Exported 1 new correction(s)`, and `eval/captured.json` gains a record with `"rejected": ["add_todo"]`, `"accept": null`, `"reviewed": false`.

Run `npm run eval:import` a second time. Expected: `No new corrections to export.` — confirming `exported_at` was stamped.

Then remove the probe from both the file and the database. Reuse the shared pool via the `memory` module rather than constructing a second one — see the note in Task 4, Step 9:

```bash
node -e "const fs=require('fs');const p='eval/captured.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));const out=j.filter(c=>!c.msg.startsWith('ZZTEMP'));fs.writeFileSync(p,JSON.stringify(out,null,2)+'\n');console.log('removed',j.length-out.length)"
node -e "require('dotenv').config();const m=require('./src/agent/memory');m.pool.query(\"DELETE FROM classifier_corrections WHERE message LIKE 'ZZTEMP%'\").then(r=>console.log('deleted',r.rowCount)).finally(()=>process.exit(0))"
```

- [ ] **Step 9: Confirm the eval baseline is unchanged**

Run: `npm run eval`
Expected: `22/22 passed.` Behaviour must be identical — this feature adds no classification change. If the count differs, a probe row was left behind; check `eval/captured.json`.

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/eval/import_corrections.js src/eval/run_eval.js src/eval/scoring.js test/eval.scoring.test.js package.json
git commit -m "feat: export captured corrections into the eval set"
```

---

### Task 6: Document the loop

**Files:**
- Modify: `CLAUDE.md` (the Known issues section)
- Modify: `README.md` (Operations — how to run the export)

- [ ] **Step 1: Update CLAUDE.md**

Under `## Known issues / in flight`, immediately before `### Ops`, insert:

```markdown
### Resolved 2026-09-17 (correction capture)
The classifier runs on a frozen prompt plus the last three messages (`brain.js:894-901`), so it
never sees anything the agent has learned, and nothing recorded a misroute when one happened.
`eval/captured.json` labelled each case with *what the classifier did*, which can only confirm
current behaviour, and only grew when `--capture` was run by hand.

Now: a capture action leaves a `last_capture` breadcrumb (`saveState`, 10-minute TTL — the TTL
*is* the correction window). Three retraction actions read it back inside `executeAction`
(`undo_last`, `delete_note`, `delete_event`), plus a declined `destructive_action` confirmation.
A hit is written to `classifier_corrections` and exported locally by `npm run eval:import` as a
negative case — `{rejected: [...], accept: null}` — which the eval asserts as "must not classify
as X" with no labelling effort. Detection lives inside `executeAction` because there are eight
call sites and `undo_last` runs down the classifier path, not Path A.

Two exclusions are deliberate and pinned in `test/corrections.test.js`: `complete_todo` on a
just-added todo (finishing a task you added ten minutes ago is ordinary use, and it is the most
frequent plausible signal, so including it would swamp the dataset) and a declined note-merge
prompt (it shares the `pending_clarification:` key and the word "no" with the destructive-action
confirmation, but means "save it separately" — a storage preference, not a misroute).

This is instrumentation, not learning: no runtime prompt changes, no auto-promotion past the
`reviewed` gate, no LLM judge. Nothing alters classification; `npm run eval` still reports 22/22.

**Open:** recall is unmeasured. If corrections are usually expressed by rephrasing rather than
undo/delete, this captures very little. Count rows in `classifier_corrections` after a few weeks
of real use — a low count is the argument for the LLM-judge tier (Approach B in the spec).
Design: `docs/superpowers/specs/2026-09-17-correction-capture-design.md`.
```

- [ ] **Step 2: Update README.md**

In the Operations section, add:

```markdown
### Correction capture

Misroutes are recorded to `classifier_corrections` in production (Vercel's filesystem is
read-only, so they cannot be written to a file there). To pull them into the eval set, locally:

    npm run eval:import

This appends negative cases to `eval/captured.json`, which is gitignored because it holds real
message text. Each lands as `"reviewed": false` and asserts nothing until you set it to `true`.
A negative case asserts only "must not classify as X"; filling in `accept` upgrades it to an
ordinary positive case, and `accept` then takes precedence.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: record the correction-capture loop and its export command"
```

---

## Verification Checklist

Run after all tasks are complete:

- [ ] `npm test` — all tests pass
- [ ] `npm run eval` — still `22/22 passed`, confirming no classification change
- [ ] `node src/migrate_db.js` twice — idempotent, clean on the second run
- [ ] `git status` — no `ZZTEMP` probe files, scripts, rows, or eval entries left behind
- [ ] `grep -rn "ZZTEMP" . --exclude-dir=node_modules` returns nothing
