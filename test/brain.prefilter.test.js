// The prefilter answers unambiguous commands without spending an LLM call. Its risk is entirely
// in the regexes: too greedy and a question gets silently captured as a todo (commit 0705e66 was
// exactly that bug), too strict and every message pays for an LLM round trip.
//
// These assert the match layer only — running a rule end to end would hit the DB.

const test = require('node:test');
const assert = require('node:assert');

const { PREFILTER_RULES, COMPOUND_REQUEST } = require('../src/agent/brain');

// Mirrors how tryPrefilter selects a rule: first match in declaration order wins.
function classify(message) {
  const msg = message.trim();
  // Mirrors tryPrefilter, including its compound-request bail-out.
  if (COMPOUND_REQUEST.test(msg)) return null;
  for (const rule of PREFILTER_RULES) {
    const m = msg.match(rule.match);
    if (m) return { action: rule.action, ...(rule.dataFn ? rule.dataFn(m) : {}) };
  }
  return null; // falls through to the LLM
}

test('captures explicit todo, note and completion prefixes', () => {
  assert.deepStrictEqual(classify('todo: buy milk'), { action: 'add_todo', content: 'buy milk' });
  assert.deepStrictEqual(classify('note: shipping idea'), { action: 'add_note', content: 'shipping idea' });
  assert.deepStrictEqual(classify('done: buy milk'), { action: 'complete_todo', content: 'buy milk' });
});

test('accepts a space as the separator, not just a colon', () => {
  assert.deepStrictEqual(classify('remind me to call mom'), { action: 'add_todo', content: 'call mom' });
  assert.deepStrictEqual(classify('finished the report'), { action: 'complete_todo', content: 'the report' });
});

test('is case insensitive and tolerates surrounding whitespace', () => {
  assert.deepStrictEqual(classify('  TODO:  buy milk  '), { action: 'add_todo', content: 'buy milk' });
});

test('does not capture questions about existing items', () => {
  // Regression guard for 0705e66: these must reach the LLM, not become new todos.
  assert.strictEqual(classify('what are my todos'), null);
  assert.strictEqual(classify('list my todos'), null);
  assert.strictEqual(classify('any todos left for today?'), null);
});

test('does not match a bare keyword with no payload', () => {
  assert.strictEqual(classify('done'), null);
  assert.strictEqual(classify('note'), null);
  assert.strictEqual(classify('todo'), null);
});

test('does not fire on a word that merely starts with a keyword', () => {
  // "addendum" begins with "add" but the rule requires a colon or space to follow.
  assert.strictEqual(classify('addendum: see the attached doc'), null);
  assert.strictEqual(classify('nothing to report'), null);
});

test('completion is matched ahead of capture for overlapping phrasing', () => {
  // "done with X" must complete a todo, never create one.
  assert.strictEqual(classify('done with the migration').action, 'complete_todo');
  assert.strictEqual(classify('just finished the deploy').action, 'complete_todo');
});

test('a compound request falls through instead of becoming one todo', () => {
  // The prefilter can only perform one action. "add milk and remind me to call the bank" used to
  // be captured whole as a single todo — the reminder dropped, and the todo left with a content
  // string no completion phrasing would ever match.
  assert.strictEqual(classify('add milk and remind me to call the bank'), null);
  assert.strictEqual(classify('todo: ship the api and also schedule the review'), null);
  assert.strictEqual(classify('remind me to call mom and add milk to the list'), null);
});

test('a plain list is still handled cheaply', () => {
  // Only a command word after the conjunction means compound; "and eggs" is just more content.
  assert.deepStrictEqual(classify('add milk and eggs and bread'), { action: 'add_todo', content: 'milk and eggs and bread' });
  assert.strictEqual(classify('remind me to call mom').action, 'add_todo');
});
