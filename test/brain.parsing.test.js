// Parsing of model output. This is the layer that stands between an unpredictable LLM and the
// action executor, so it has to survive prose, markdown fences, reasoning blocks and truncation
// without throwing — returning null is fine, crashing the webhook is not.

const test = require('node:test');
const assert = require('node:assert');

const { extractFirstJSON, extractPartialReply, validateJsonSchema } = require('../src/agent/brain');

test('extractFirstJSON parses a bare object', () => {
  assert.deepStrictEqual(extractFirstJSON('{"action":"add_todo","reply":"ok"}'), {
    action: 'add_todo',
    reply: 'ok',
  });
});

test('extractFirstJSON ignores prose around the object', () => {
  assert.deepStrictEqual(extractFirstJSON('Sure! {"reply":"hi"} Hope that helps.'), { reply: 'hi' });
});

test('extractFirstJSON handles a markdown code fence', () => {
  const raw = '```json\n{"reply":"fenced"}\n```';
  assert.deepStrictEqual(extractFirstJSON(raw), { reply: 'fenced' });
});

test('extractFirstJSON skips a reasoning block before the JSON', () => {
  // Reasoning models emit <think>...</think> ahead of the answer.
  const raw = '<think>The user wants a todo. I should return add_todo.</think>\n{"reply":"done"}';
  assert.deepStrictEqual(extractFirstJSON(raw), { reply: 'done' });
});

test('extractFirstJSON keeps nested objects intact', () => {
  const parsed = extractFirstJSON('{"data":{"tags":["work"],"nested":{"deep":1}},"reply":"x"}');
  assert.deepStrictEqual(parsed.data.nested, { deep: 1 });
  assert.deepStrictEqual(parsed.data.tags, ['work']);
});

test('extractFirstJSON falls through a malformed object to the next valid one', () => {
  assert.deepStrictEqual(extractFirstJSON('{not json} {"ok":true}'), { ok: true });
});

test('extractFirstJSON returns null when there is no object at all', () => {
  assert.strictEqual(extractFirstJSON('I could not answer that.'), null);
});

test('extractFirstJSON returns null on an unterminated object', () => {
  assert.strictEqual(extractFirstJSON('{"reply":"truncated mid-str'), null);
});

test('extractPartialReply reads a reply that is still streaming', () => {
  assert.strictEqual(extractPartialReply('{"reply":"partial te'), 'partial te');
});

test('extractPartialReply unescapes quotes and newlines', () => {
  assert.strictEqual(extractPartialReply('{"reply":"line\\nnext \\"quoted\\""}'), 'line\nnext "quoted"');
});

test('extractPartialReply returns null before the reply field arrives', () => {
  assert.strictEqual(extractPartialReply('{"action":"add_todo"'), null);
});

test('validateJsonSchema requires a string reply', () => {
  assert.strictEqual(validateJsonSchema({ reply: 'hi' }), true);
  assert.strictEqual(validateJsonSchema({ action: 'add_todo' }), false, 'reply is mandatory');
  assert.strictEqual(validateJsonSchema({ reply: 42 }), false);
  assert.strictEqual(validateJsonSchema(null), false);
  assert.strictEqual(validateJsonSchema('a string'), false);
});

test('validateJsonSchema accepts a well-formed actions array', () => {
  assert.strictEqual(
    validateJsonSchema({ reply: 'ok', actions: [{ action: 'add_todo' }, { action: 'add_note' }] }),
    true
  );
});

test('validateJsonSchema rejects a malformed actions array', () => {
  assert.strictEqual(validateJsonSchema({ reply: 'ok', actions: 'add_todo' }), false);
  assert.strictEqual(validateJsonSchema({ reply: 'ok', actions: [{ noAction: true }] }), false);
});

test('validateJsonSchema type-checks optional fields', () => {
  assert.strictEqual(validateJsonSchema({ reply: 'ok', action: 123 }), false);
  assert.strictEqual(validateJsonSchema({ reply: 'ok', confidence: 'high' }), false);
  assert.strictEqual(validateJsonSchema({ reply: 'ok', confidence: 0.9 }), true);
});
