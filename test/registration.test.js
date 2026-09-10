// Who is allowed to talk to the agent.
//
// This replaced a string comparison against MY_WHATSAPP_NUMBER, which was the entire auth check.
// Getting it wrong in the permissive direction turns a public WhatsApp number into an open bot
// on a metered Meta account and a metered LLM, so the policy is asserted directly rather than
// inferred from the webhook's behaviour.

const test = require('node:test');
const assert = require('node:assert');

const { parseAllowlist, isAllowed, WELCOME } = require('../src/agent/registration');

const OWNER = '919324791556';

test('the owner is always allowed, even with no allowlist configured', () => {
  // A mistyped or missing ALLOWED_NUMBERS must not lock the operator out of their own agent.
  assert.strictEqual(isAllowed(OWNER, { MY_WHATSAPP_NUMBER: OWNER }), true);
  assert.strictEqual(isAllowed(OWNER, { MY_WHATSAPP_NUMBER: OWNER, ALLOWED_NUMBERS: '' }), true);
});

test('an unknown number is refused when no allowlist is set', () => {
  // The default is closed. An agent that registers whoever writes to it is an open bot.
  assert.strictEqual(isAllowed('4915112345678', { MY_WHATSAPP_NUMBER: OWNER }), false);
  assert.strictEqual(isAllowed('4915112345678', { MY_WHATSAPP_NUMBER: OWNER, ALLOWED_NUMBERS: '' }), false);
});

test('a number named in the allowlist is admitted', () => {
  const env = { MY_WHATSAPP_NUMBER: OWNER, ALLOWED_NUMBERS: '4915112345678,447700900000' };
  assert.strictEqual(isAllowed('4915112345678', env), true);
  assert.strictEqual(isAllowed('447700900000', env), true);
  assert.strictEqual(isAllowed('919999999999', env), false);
});

test('allowlist entries tolerate the spacing people actually type', () => {
  assert.deepStrictEqual(parseAllowlist('111, 222 ,333'), ['111', '222', '333']);
  assert.deepStrictEqual(parseAllowlist(' 111 '), ['111']);
});

test('an empty or absent allowlist parses to nothing, not to a blank entry', () => {
  // '' .split(',') yields [''], and a blank entry would match a blank sender.
  assert.deepStrictEqual(parseAllowlist(''), []);
  assert.deepStrictEqual(parseAllowlist(undefined), []);
  assert.deepStrictEqual(parseAllowlist(',,'), []);
});

test('a missing sender is never allowed', () => {
  const env = { MY_WHATSAPP_NUMBER: OWNER, ALLOWED_NUMBERS: '111' };
  assert.strictEqual(isAllowed('', env), false);
  assert.strictEqual(isAllowed(undefined, env), false);
  assert.strictEqual(isAllowed(null, env), false);
});

test('an unset MY_WHATSAPP_NUMBER does not admit an unset sender', () => {
  // Both undefined would compare equal, which would admit a message with no sender at all.
  assert.strictEqual(isAllowed(undefined, {}), false);
});

test('the welcome message explains what to do next', () => {
  // A first contact that gets no orientation is a first contact that goes nowhere.
  assert.match(WELCOME, /Blu/);
  assert.ok(WELCOME.length > 80, 'welcome should actually orient someone');
});
