// Which facts reach the prompt. This is the layer that decides what the model gets to reason
// from, so a bad choice here looks exactly like a weak model — and no stronger model recovers
// from being handed the wrong context.
//
// The word-overlap ranker matched "when am I most productive" to "When a task is completed,
// remove associated reminders" on the word "when", while the fact that answered it never made it
// into the prompt at all.

const test = require('node:test');
const assert = require('node:assert');

const memory = require('../src/agent/memory');
const { filterKnowledge, selectKnowledge } = require('../src/agent/brain');

test.afterEach(() => test.mock.restoreAll());

const FACTS = [
  'When a task is completed, remove associated reminders',
  'Tarun does focused work in the evenings.',
  'Rohan handles the dispatch module.',
];

test('ranks by embedding when one is available', async () => {
  test.mock.method(memory, 'getRelevantKnowledge', async () => [
    'Tarun does focused work in the evenings.',
  ]);

  const picked = await selectKnowledge(FACTS, 'when am I most productive', [0.1, 0.2]);

  assert.deepStrictEqual(picked, ['Tarun does focused work in the evenings.']);
  assert.ok(!picked.includes('When a task is completed, remove associated reminders'),
    'the word-overlap red herring must not reach the prompt');
});

test('falls back to word overlap when there is no embedding', async () => {
  // Embeddings have been unavailable on this project for months at a stretch; a degraded
  // ranking is still better than sending no context at all.
  const picked = await selectKnowledge(FACTS, 'tell me about dispatch', null);

  assert.ok(picked.length > 0, 'must still return something to reason from');
  assert.deepStrictEqual(picked, filterKnowledge(FACTS, 'tell me about dispatch'));
});

test('falls back when the vector search finds nothing', async () => {
  test.mock.method(memory, 'getRelevantKnowledge', async () => []);

  const picked = await selectKnowledge(FACTS, 'dispatch module', [0.1]);

  assert.ok(picked.length > 0, 'an empty semantic result must not blank the context');
});

test('falls back when ranking is unavailable rather than throwing', async () => {
  test.mock.method(memory, 'getRelevantKnowledge', async () => null);

  const picked = await selectKnowledge(FACTS, 'dispatch module', [0.1]);
  assert.ok(Array.isArray(picked));
});

test('filterKnowledge still returns something when nothing overlaps', () => {
  // The fallback path leans on this: no word match must not mean no context.
  const picked = filterKnowledge(FACTS, 'zzz qqq');
  assert.ok(picked.length > 0, 'a no-match query still gets a few facts to work with');
});

// ── Guard against accidental billing ────────────────────────────────────────
// Everything in the model ladder is free tier. A paid model may only enter through
// CLASSIFIER_MODEL, which is unset by default, so deploying a file can never start charging.

test('no paid model is hardcoded into the model ladder', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/brain.js'), 'utf8');

  // The ladder arrays, not the comments explaining how to opt in.
  const ladders = src.match(/const (GROQ_MODELS|OR_MODELS|GEMINI_MODELS) = \[[\s\S]*?\];/g) || [];
  assert.ok(ladders.length === 3, 'expected all three ladder definitions');

  for (const ladder of ladders) {
    assert.doesNotMatch(ladder, /nousresearch|anthropic\/|openai\/gpt-4|\bgpt-5\b/,
      'a paid model in the default ladder would bill on every message');
  }
});

test('the paid classifier override is opt-in, never a default', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/brain.js'), 'utf8');

  assert.match(src, /const CLASSIFIER_MODEL = process\.env\.CLASSIFIER_MODEL \|\| null/,
    'CLASSIFIER_MODEL must default to null so nothing bills unless it is deliberately set');
});
