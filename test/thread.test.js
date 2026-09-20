// Query parsing for GET /dashboard/api/messages. The route is thin; this is the part with rules.

const test = require('node:test');
const assert = require('node:assert');
const { parseThreadQuery } = require('../src/agent/thread');

test('defaults to the 50 newest', () => {
  assert.deepStrictEqual(parseThreadQuery({}), { before: null, limit: 50 });
});

test('limit is capped at 200', () => {
  assert.strictEqual(parseThreadQuery({ limit: '5000' }).limit, 200);
});

test('a bad limit falls back to the default', () => {
  assert.strictEqual(parseThreadQuery({ limit: 'abc' }).limit, 50);
  assert.strictEqual(parseThreadQuery({ limit: '-3' }).limit, 50);
  assert.strictEqual(parseThreadQuery({ limit: '0' }).limit, 50);
});

test('before is normalised to ISO, and a bad date is ignored rather than sent to SQL', () => {
  assert.strictEqual(parseThreadQuery({ before: '2026-09-19T10:00:00Z' }).before, '2026-09-19T10:00:00.000Z');
  assert.strictEqual(parseThreadQuery({ before: 'not-a-date' }).before, null);
});

test('a missing query object is handled', () => {
  assert.deepStrictEqual(parseThreadQuery(undefined), { before: null, limit: 50 });
});
