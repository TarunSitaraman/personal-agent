// The eval harness is only as trustworthy as its scorer: a scorer that passes wrong actions makes
// every green run meaningless. Pure logic, no network.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { actionsFrom, scoreCase } = require('../src/eval/scoring');

test('actionsFrom reads a single primary action', () => {
  assert.deepStrictEqual(actionsFrom({ action: 'add_todo', data: {} }), ['add_todo']);
});

test('actionsFrom reads a compound actions array', () => {
  const parsed = { actions: [{ action: 'add_todo' }, { action: 'set_reminder' }] };
  assert.deepStrictEqual(actionsFrom(parsed), ['add_todo', 'set_reminder']);
});

test('actionsFrom tolerates garbage without throwing', () => {
  assert.deepStrictEqual(actionsFrom(null), []);
  assert.deepStrictEqual(actionsFrom('nope'), []);
  assert.deepStrictEqual(actionsFrom({ actions: [null, { action: 3 }] }), []);
});

test('scoreCase passes when the action set matches any accepted alternative', () => {
  assert.strictEqual(scoreCase(['none'], [['list_todos'], ['none']]), true);
});

test('scoreCase ignores order within a compound request', () => {
  assert.strictEqual(scoreCase(['set_reminder', 'add_todo'], [['add_todo', 'set_reminder']]), true);
});

test('scoreCase fails a question misread as a completion', () => {
  assert.strictEqual(scoreCase(['complete_todo'], [['list_todos'], ['none']]), false);
});

test('scoreCase fails a compound request that silently dropped half', () => {
  assert.strictEqual(scoreCase(['add_todo'], [['add_todo', 'set_reminder']]), false);
});

test('scoreCase fails an empty classification', () => {
  assert.strictEqual(scoreCase([], [['add_note']]), false);
});

test('every labeled case only accepts actions the classifier prompt actually allows', () => {
  // A typo in cases.json would make a case impossible to pass, or silently always fail.
  const { CLASSIFIER_PROMPT } = require('../src/agent/brain');
  const allowed = new Set(
    [...CLASSIFIER_PROMPT.matchAll(/^- ([a-z_]+):/gm)].map(m => m[1])
  );
  // generate_brief is routed but not listed in the classifier's allowed names.
  allowed.add('generate_brief');

  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eval', 'cases.json'), 'utf8'));
  for (const c of cases) {
    for (const alt of c.accept) {
      for (const action of alt) {
        assert.ok(allowed.has(action), `"${c.msg}" accepts unknown action "${action}"`);
      }
    }
  }
});

// ── Negative cases from captured corrections ─────────────────────────────────
//
// A correction case knows what was WRONG, not what was right: the user's own undo or delete told
// us the routing was a misroute without saying what it should have been. It asserts the
// classifier does not reproduce the rejected action — a real regression test needing no labeling.

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
  // Reviewing a correction can fill in `accept`. From then on it is an ordinary positive case and
  // `rejected` is ignored, so a hand-supplied label always wins over the inferred negative.
  assert.strictEqual(scoreCase(['add_todo'], [['add_todo']], ['add_todo']), true);
});

test('a case with neither accept nor rejected does not silently pass', () => {
  // A malformed case must not look like a green test. run_eval filters these out, but scoring
  // must not be the thing that hides them.
  assert.strictEqual(scoreCase(['add_todo'], null, []), false);
});

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
