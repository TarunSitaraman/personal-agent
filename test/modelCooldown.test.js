const test = require('node:test');
const assert = require('node:assert');
const { cooldownFor } = require('../src/agent/brain');

// Free-tier limits are per minute and upstream overload clears in seconds. Benching either for the
// full five minutes is what emptied the whole fallback ladder mid-burst, so both cool down briefly.

test('a 429 status gets the short transient cooldown', () => {
  assert.strictEqual(cooldownFor({ response: { status: 429 } }), 60 * 1000);
});

test('upstream overload (502/503) gets the short transient cooldown', () => {
  assert.strictEqual(cooldownFor({ response: { status: 503 } }), 60 * 1000);
  assert.strictEqual(cooldownFor(new Error('upstream 502: Service temporarily overloaded')), 60 * 1000);
});

test('Gemini SDK rate-limit errors (no status, text only) get the short cooldown', () => {
  assert.strictEqual(cooldownFor(new Error('[GoogleGenerativeAI Error]: [429 Too Many Requests] quota')), 60 * 1000);
  assert.strictEqual(cooldownFor(new Error('RESOURCE_EXHAUSTED')), 60 * 1000);
});

test('other failures keep the long cooldown', () => {
  assert.strictEqual(cooldownFor({ response: { status: 404 } }), 5 * 60 * 1000);
  assert.strictEqual(cooldownFor(new Error('Gemini timeout')), 5 * 60 * 1000);
  assert.strictEqual(cooldownFor(undefined), 5 * 60 * 1000);
});
