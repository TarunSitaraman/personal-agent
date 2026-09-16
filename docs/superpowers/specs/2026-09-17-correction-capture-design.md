# Design: Correction Capture for the Classifier (personal-agent)

Date: 2026-09-17
Status: Approved, not yet implemented

## Problem Statement

The classifier is stateless with respect to everything the agent has learned. `handleIncoming`
forks in two: Path A (`none` plus the retrieval actions) loads insights, knowledge, the context
summary, upcoming events and skills; Path B — the classifier itself — receives only
`CLASSIFIER_PROMPT`, the last three messages truncated to 300 characters each, and the user
message (`src/agent/brain.js:894-901`).

So every capture decision is made by a frozen prompt, and the accumulated memory sits downstream
of a routing decision taken without it. When that routing is wrong, nothing records the failure.

`eval/captured.json` exists but is a manual harness: `npm run eval -- --capture N` replays real
messages and labels each with **what the classifier did**, then waits for the user to set
`reviewed: true`. Two consequences:

- A case labeled with the classifier's own output can only ever confirm current behaviour. It
  cannot encode a failure, because the label *is* the failure when the classifier was wrong.
- The backlog only grows when the user remembers to run `--capture`. Ten messages sat unreviewed
  for days (recorded in CLAUDE.md) before being cleared.

The eval suite currently passes 22/22, which measures intent routing on 12 hand-written plus 10
reviewed real messages. That number is real but small, and the captured half is biased toward
agreement for the reason above.

## Goal

Grow the eval dataset automatically with cases that carry evidence the classifier was **wrong**,
without changing runtime behaviour and without teaching the system anything the user has not
approved.

Explicit non-goal: this does not make the agent learn. It produces a reviewed dataset; the user
still changes prompts by hand. It is the instrumentation that would make a genuine learning loop
safe to attempt later, because a regression set containing real failures would exist.

## Constraints

- **Vercel's filesystem is read-only** outside `/tmp`, and `/tmp` does not survive between
  invocations. Production cannot write `eval/captured.json`. Corrections must land in Postgres,
  with a local command exporting them into the eval files.
- **`eval/captured.json` is gitignored** (`.gitignore:31`) because it contains real WhatsApp
  message text. That stays true; the new table holds the same class of data and is equally
  private.
- **No added LLM calls on the message path.** Detection must be deterministic.
- Every query against a user-owned table must filter on `user_id`
  (`test/schema.scoping.test.js`) and pass as many parameters as its highest `$N`
  (`test/schema.params.test.js`).

## Approaches Considered

### A. Deterministic detection, dataset only — RECOMMENDED

Detect misroutes from unambiguous user actions (undo, delete, rejected confirmation). Write the
pair to Postgres. Export locally into `eval/captured.json` with `reviewed: false`.

Zero added cost on the hot path, no new runtime failure mode, and it reuses the review gate that
already exists. Recall is limited to corrections expressed as undo/delete.

### B. Deterministic triggers gating an LLM judge

Same triggers, but each candidate goes to a cheap background judge that confirms the misroute and
proposes the correct action. Better labels and higher recall, at the cost of a judge that can be
wrong and a per-candidate call.

Deferred, not rejected. Approach A produces the data needed to decide whether it is worth it: if
deterministic recall turns out to be very low, that is the argument for adding the judge.

### C. Judge on every adjacent turn pair

Highest recall, catches correction-by-rephrasing. Costs a call for essentially every message and
generates false corrections that pollute the review queue. Not justified at a single user's
message volume.

## Recommended Approach

Approach A.

### Data flow

```
capture action executes (add_todo / add_note / add_event / set_reminder)
  └─> memory.saveState('last_capture', {action, itemType, itemId, msg}, ttl=10)

next message, after executeAction
  └─> corrections.detect(action, data, lastCapture)      ← pure, no DB
        └─> if misroute: memory.recordCorrection({message, rejected, signal})
```

The TTL on `saveState` is the correction window. `saveState` already takes `ttlMinutes` and
already scopes to `currentUserId()` (`memory.js:1089`), and `getState` filters on
`expires_at > NOW()`. After ten minutes the breadcrumb is gone and nothing can be claimed as a
correction — no new expiry logic is written.

### Detection rules

`src/agent/corrections.js` holds the rules as a pure function taking the current action, its data,
and the breadcrumb, returning a correction record or `null`. No database access, so it is unit
testable without Postgres — the same shape as `src/agent/itemTracking.js`, which is this repo's
precedent for testable diff logic.

| Signal | Meaning | Logged |
|---|---|---|
| `undo_last` executed | Unambiguous: the previous action was wrong | Yes |
| `destructive_action` clarification answered "no" | Unambiguous: the user declined the proposed action | Yes |
| `delete_note` / `delete_event` targeting the breadcrumb item | Probable correction | Yes |
| Note-merge clarification answered "no" | A legitimate choice, not a misroute | **No** |
| `complete_todo` on a just-added todo | Ambiguous | **No** |
| `update_todo` after `add_todo` | Content error, not routing error | **No** |

Two different clarifications share the `pending_clarification:` state key and both are answered
with yes/no (`brain.js:826-870`). Only one is a correction signal:

- `type === 'destructive_action'` (`brain.js:859`) is raised when the classifier proposed
  `complete_todo` or `delete_event` with confidence below 0.8. Answering "no" means the proposed
  routing was wrong — a misroute, logged. This signal is self-contained: the saved state already
  holds `{action, data}` (`brain.js:1062`), so the rejected action is known directly and no
  breadcrumb is needed.
- The note-merge prompt (`brain.js:829`, raised at `brain.js:1360`) asks whether to merge a new
  note with a similar existing one. Answering "no" means "save it separately" — a legitimate
  choice about storage, not a statement that `add_note` was the wrong action. Excluded.

Conflating these two would file a routine preference as a classifier failure, which is exactly
the kind of wrong label that makes an auto-grown dataset worse than no dataset.

`complete_todo` is excluded deliberately. Adding "call the bank" and marking it done nine minutes
later is ordinary use, not a correction; including it would make the noisiest signal also the most
frequent. `update_todo` is excluded because the routing was correct and only the extracted text
was wrong — a different problem that would pollute a routing dataset.

These exclusions are asserted in the tests, so they stay deliberate rather than becoming
incidental.

### Storage

New table, added as `migrate_db.js` step 15:

```sql
CREATE TABLE IF NOT EXISTS classifier_corrections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  message         text NOT NULL,
  rejected_action text[] NOT NULL,
  signal          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  exported_at     timestamptz
);
```

`classifier_corrections` must be appended to the `OWNED` list in **both** `migrate_db.js` and
`test/schema.scoping.test.js`. Those two lists are asserted equal by
`schema.scoping.test.js`, so omitting either fails the suite.

### Export

`src/eval/import_corrections.js`, run locally, selects rows with `exported_at IS NULL`, appends
them to `eval/captured.json`, and stamps `exported_at`. Deduplicates on message text against
cases already present, so re-running is idempotent.

### Eval integration

A correction enters the file as:

```json
{ "msg": "...", "rejected": ["add_todo"], "accept": null, "reviewed": false }
```

`src/eval/scoring.js` gains one rule: **when `accept` is null and `rejected` is present, the case
passes if the classifier's output does not contain the rejected action.**

That is a working regression test with no labeling effort. If the user later fills in `accept`, it
becomes an ordinary positive case and `accept` takes precedence over `rejected`.

This is what fixes the bias in today's `--capture`: a negative case is labeled with evidence of a
failure rather than with the behaviour under test.

The `reviewed: false` gate is unchanged — `run_eval.js:85` already filters to reviewed cases
before asserting, so nothing captured automatically enters the assertion set until the user
approves it.

## Testing

- `test/corrections.test.js` — the pure detector against each signal, including assertions that
  `complete_todo`, `update_todo` and a rejected note-merge do **not** register, pinning the
  exclusions. The note-merge case matters most: it is the one exclusion that looks like a
  correction from the outside, since both clarification types are answered with the same word.
- `test/eval.scoring.test.js` — extended for the negative-assertion rule, including the precedence
  case where both `accept` and `rejected` are present.
- `test/schema.scoping.test.js` — the `OWNED` list gains the new table.
- `test/schema.params.test.js` — covers the new queries automatically.

## Success Criteria

- A misroute followed by `undo_last` produces a row in `classifier_corrections` without any added
  LLM call on the message path.
- `complete_todo` on a recently added todo produces no row, and neither does declining a
  note-merge prompt.
- `import_corrections.js` writes a `rejected` case into `eval/captured.json` and is idempotent on
  a second run.
- `npm run eval` asserts that case immediately, with no labeling, and fails if the classifier
  reproduces the rejected action.
- No change to classification behaviour: the 22/22 baseline holds.

## Open Questions

**Deferred past the first pass:**

- Recall is unknown. If corrections are typically expressed by rephrasing rather than by
  undo/delete, this captures very little. That outcome is the argument for Approach B, and is
  measurable once this ships — count rows after a few weeks of real use.
- Whether `classifier_corrections` needs pruning. At a single user's volume, almost certainly not.

**Not open, recorded to prevent re-litigation:**

- Auto-promotion to `reviewed: true` was considered and rejected: a wrong auto-label silently
  becomes a regression test locking in the wrong answer.
- Injecting corrections into `CLASSIFIER_PROMPT` as few-shot examples was considered and rejected
  for this pass: a bad pair actively degrades classification and the failure is hard to notice.

## Dependencies

- Migration runs via the existing idempotent `migrate_db.js` pattern.
- No new packages, services, or deployment changes. Ships on the current Vercel plus cron-job.org
  infrastructure.
