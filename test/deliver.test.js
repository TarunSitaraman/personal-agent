// deliver() is where the move off WhatsApp happens: every proactive message tries the app first,
// falls back to WhatsApp, and is recorded in the inbox either way. Sending is mocked throughout.

const test = require('node:test');
const assert = require('node:assert');

const memory = require('../src/agent/memory');
const push = require('../src/push/push');
const send = require('../src/whatsapp/send');
const { runAsUser } = require('../src/agent/context');
const { deliver, chooseChannel } = require('../src/scheduler/delivery');

const ALICE = { id: 'aaaaaaaa-0000-0000-0000-000000000001', wa_number: '911' };
const asAlice = fn => runAsUser(ALICE, fn);

const pushed = (over = {}) => ({ attempted: 1, accepted: 1, deadTokens: [], failed: false, ...over });

function mockAll({ pushResult = pushed(), sendFails = false, inboxFails = false } = {}) {
  const calls = { push: [], message: [], buttons: [], inbox: [], removed: [] };
  test.mock.method(push, 'sendPush', async (...a) => { calls.push.push(a); return pushResult; });
  test.mock.method(send, 'sendMessage', async (...a) => { if (sendFails) throw new Error('meta down'); calls.message.push(a); });
  test.mock.method(send, 'sendButtonMessage', async (...a) => { if (sendFails) throw new Error('meta down'); calls.buttons.push(a); });
  test.mock.method(memory, 'saveInboxMessage', async row => { if (inboxFails) throw new Error('db down'); calls.inbox.push(row); });
  test.mock.method(memory, 'removePushToken', async t => { calls.removed.push(t); });
  return calls;
}

test.afterEach(() => test.mock.restoreAll());

// ── chooseChannel ────────────────────────────────────────────────────────────

test('chooseChannel: no registered device means WhatsApp', () => {
  assert.strictEqual(chooseChannel(pushed({ attempted: 0, accepted: 0 })), 'whatsapp');
});

test('chooseChannel: an accepted push means the app', () => {
  assert.strictEqual(chooseChannel(pushed()), 'push');
});

test('chooseChannel: every token dead means WhatsApp', () => {
  assert.strictEqual(chooseChannel(pushed({ accepted: 0, deadTokens: ['x'] })), 'whatsapp');
});

test('chooseChannel: a failed request means WhatsApp', () => {
  assert.strictEqual(chooseChannel(pushed({ accepted: 0, failed: true })), 'whatsapp');
});

// ── deliver ──────────────────────────────────────────────────────────────────

test('a message the app accepted does not also go to WhatsApp', async () => {
  const calls = mockAll();

  const channel = await asAlice(() => deliver({ kind: 'brief', text: 'Good morning' }));

  assert.strictEqual(channel, 'push');
  assert.strictEqual(calls.message.length + calls.buttons.length, 0, 'no duplicate on WhatsApp');
  assert.strictEqual(calls.inbox[0].channel, 'push');
});

test('with no registered device it falls back to WhatsApp', async () => {
  const calls = mockAll({ pushResult: pushed({ attempted: 0, accepted: 0 }) });

  const channel = await asAlice(() => deliver({ kind: 'nudge', text: 'hi' }));

  assert.strictEqual(channel, 'whatsapp');
  assert.deepStrictEqual(calls.message[0], ['911', 'hi']);
  assert.strictEqual(calls.inbox[0].channel, 'whatsapp');
});

test('dead tokens are pruned and the message falls back', async () => {
  const calls = mockAll({ pushResult: pushed({ accepted: 0, deadTokens: ['ExponentPushToken[dead]'] }) });

  const channel = await asAlice(() => deliver({ kind: 'reminder', text: 'x' }));

  assert.deepStrictEqual(calls.removed, ['ExponentPushToken[dead]']);
  assert.strictEqual(channel, 'whatsapp');
});

test('the WhatsApp fallback keeps its buttons', async () => {
  const calls = mockAll({ pushResult: pushed({ attempted: 0, accepted: 0 }) });
  const buttons = [{ id: 'rdone_1', title: 'Done' }];

  await asAlice(() => deliver({ kind: 'reminder', text: 'Reminder: x', whatsapp: { text: 'Reminder: x', buttons } }));

  assert.deepStrictEqual(calls.buttons[0], ['911', 'Reminder: x', buttons]);
});

test('when both channels fail the message is still recorded, as failed', async () => {
  const calls = mockAll({ pushResult: pushed({ accepted: 0, failed: true }), sendFails: true });

  const channel = await asAlice(() => deliver({ kind: 'weekly', text: 'review' }));

  assert.strictEqual(channel, 'failed');
  assert.strictEqual(calls.inbox[0].channel, 'failed');
});

test('an inbox write failure does not throw out of deliver', async () => {
  mockAll({ inboxFails: true });

  const channel = await asAlice(() => deliver({ kind: 'brief', text: 'x' }));

  assert.strictEqual(channel, 'push');
});

test('a push that throws still reaches WhatsApp', async () => {
  const calls = mockAll();
  test.mock.method(push, 'sendPush', async () => { throw new Error('getPushTokens failed'); });

  const channel = await asAlice(() => deliver({ kind: 'nudge', text: 'hi' }));

  assert.strictEqual(channel, 'whatsapp');
  assert.strictEqual(calls.message.length, 1);
});

test('the push is short and plain, the inbox keeps the full plain text', async () => {
  const calls = mockAll();
  const long = '*Morning* ' + 'detail '.repeat(60);

  await asAlice(() => deliver({ kind: 'brief', text: long }));

  const [, pushBody, data] = calls.push[0];
  assert.ok(pushBody.length <= 180);
  assert.ok(!pushBody.includes('*'));
  assert.strictEqual(data.type, 'brief');
  assert.strictEqual(data.channelId, 'briefs');
  assert.ok(!calls.inbox[0].body.includes('*'));
  assert.ok(calls.inbox[0].body.length > 180, 'the inbox keeps the whole message');
});
