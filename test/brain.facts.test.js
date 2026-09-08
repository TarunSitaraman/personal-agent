// Passive fact learning. The risk here is not that it misses a fact — it is that it stores a
// wrong or duplicate one, because a bad fact is retrieved and reasoned from for months and
// nothing ever prompts a review. These lean on refusing to write.

const test = require('node:test');
const assert = require('node:assert');

const memory = require('../src/agent/memory');
const { shouldExtractFacts } = require('../src/agent/brain');

test.afterEach(() => test.mock.restoreAll());

test('skips capture commands — the content is a task, not a fact', () => {
  assert.strictEqual(shouldExtractFacts('todo: send the investor deck to the team tomorrow'), false);
  assert.strictEqual(shouldExtractFacts('note: the pricing page needs a rewrite before launch'), false);
  assert.strictEqual(shouldExtractFacts('remind me to call the bank about the account'), false);
  assert.strictEqual(shouldExtractFacts('done: finished the dispatch refactor this afternoon'), false);
});

test('skips retrieval commands — a question states nothing', () => {
  assert.strictEqual(shouldExtractFacts('what are my pending todos for this week'), false);
  assert.strictEqual(shouldExtractFacts('list everything tagged smartresq please'), false);
  assert.strictEqual(shouldExtractFacts('when is the next thing on my calendar'), false);
  assert.strictEqual(shouldExtractFacts('search for the note about onboarding'), false);
});

test('skips short acknowledgements', () => {
  assert.strictEqual(shouldExtractFacts('ok'), false);
  assert.strictEqual(shouldExtractFacts('thanks!'), false);
  assert.strictEqual(shouldExtractFacts('yes do that'), false);
  assert.strictEqual(shouldExtractFacts(''), false);
  assert.strictEqual(shouldExtractFacts(undefined), false);
});

test('accepts the conversational statements worth learning from', () => {
  // These are exactly the passing remarks that learn_context never caught.
  assert.strictEqual(shouldExtractFacts('Rohan is handling the dispatch module for SmartResQ now'), true);
  assert.strictEqual(shouldExtractFacts('the patient app is the hardest part of the build honestly'), true);
  assert.strictEqual(shouldExtractFacts('I usually do deep work in the evenings after everyone logs off'), true);
});

test('a word merely starting with a command keyword is not skipped', () => {
  // "additionally" begins with "add"; the rule requires a separator after the keyword.
  assert.strictEqual(shouldExtractFacts('additionally the demo environment runs on a separate cluster'), true);
  assert.strictEqual(shouldExtractFacts('whatever happens the launch date is fixed for next quarter'), true);
});

test('the extractor writes nothing when the model returns no facts', async () => {
  const { extractFactsFromExchange } = require('../src/agent/brain');
  const written = [];
  test.mock.method(memory, 'saveKnowledge', async (...a) => { written.push(a); return 'id'; });

  // A skipped message must not even reach the model, so this resolves without writing.
  await extractFactsFromExchange('ok', 'Sure.');
  assert.deepStrictEqual(written, [], 'a skipped exchange must never write knowledge');
});

// ── storeFactIfNew: the shared write path for both the passive extractor and the seeder ──

test('storeFactIfNew refuses input that is not a usable fact', async () => {
  const { storeFactIfNew } = require('../src/agent/brain');
  const written = [];
  test.mock.method(memory, 'saveKnowledge', async (...a) => { written.push(a); return 'id'; });

  assert.strictEqual(await storeFactIfNew(''), null);
  assert.strictEqual(await storeFactIfNew('   '), null);
  assert.strictEqual(await storeFactIfNew('too short'), null, 'under 10 chars is noise');
  assert.strictEqual(await storeFactIfNew(null), null);
  assert.strictEqual(await storeFactIfNew({ fact: 'x' }), null, 'a non-string must not be stored');

  assert.deepStrictEqual(written, [], 'nothing unusable may reach the database');
});

// Embeddings are unavailable under the test runner (no GEMINI_API_KEY), which is the same state
// the agent ran in for months after the embedding model was retired. These therefore exercise the
// no-embedding fallback — the path where the dedupe used to vanish silently. The vector path is
// covered by running the seeder against the live database.

test('storeFactIfNew skips a known fact even with no embeddings available', async () => {
  const { storeFactIfNew } = require('../src/agent/brain');
  const written = [];
  test.mock.method(memory, 'saveKnowledge', async (...a) => { written.push(a); return 'id'; });
  test.mock.method(memory, 'getAllKnowledge', async () => ['Tarun is the founder of SmartResQ.']);

  // Differs only by punctuation — normalisation must still recognise it.
  const id = await storeFactIfNew('Tarun is the founder of SmartResQ');

  assert.strictEqual(id, null, 'a duplicate must not be written just because embeddings are down');
  assert.deepStrictEqual(written, []);
});

test('storeFactIfNew writes a fact that is genuinely new', async () => {
  const { storeFactIfNew } = require('../src/agent/brain');
  const written = [];
  test.mock.method(memory, 'saveKnowledge', async (...a) => { written.push(a); return 'new-id'; });
  test.mock.method(memory, 'getAllKnowledge', async () => ['something unrelated entirely']);

  const id = await storeFactIfNew('Rohan handles the dispatch module.');

  assert.strictEqual(id, 'new-id');
  assert.strictEqual(written.length, 1);
  assert.strictEqual(written[0][0], 'Rohan handles the dispatch module.', 'stored trimmed and intact');
});

test('extractFactsFromText returns nothing for empty input without calling a model', async () => {
  const { extractFactsFromText } = require('../src/agent/brain');
  assert.deepStrictEqual(await extractFactsFromText(''), []);
  assert.deepStrictEqual(await extractFactsFromText('   '), []);
  assert.deepStrictEqual(await extractFactsFromText(null), []);
});
