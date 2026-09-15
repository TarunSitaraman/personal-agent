const test = require('node:test');
const assert = require('node:assert');
const { cooldownFor } = require('../src/agent/brain');

// Free-tier limits are per minute. Benching a rate-limited model for the full five minutes is what
// emptied the whole fallback ladder mid-burst, so a 429 gets a short cooldown.

test('a 429 status gets the short rate-limit cooldown', () => {
  assert.strictEqual(cooldownFor({ response: { status: 429 } }), 60 * 1000);
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
