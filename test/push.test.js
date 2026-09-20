// Push sending must report what happened, because deliver() decides from the result whether to
// fall back to WhatsApp. It used to log ticket errors and return nothing.

const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

const memory = require('../src/agent/memory');
const { sendPush, isExpoPushToken, stripWhatsAppMarkup, toPushText } = require('../src/push/push');

const GOOD = 'ExponentPushToken[aaaa]';
const GOOD2 = 'ExponentPushToken[bbbb]';

test.afterEach(() => test.mock.restoreAll());

test('no registered tokens means nothing is attempted', async () => {
  test.mock.method(memory, 'getPushTokens', async () => []);
  const posts = [];
  test.mock.method(axios, 'post', async (...a) => { posts.push(a); return { data: { data: [] } }; });

  const r = await sendPush('t', 'b');

  assert.deepStrictEqual(r, { attempted: 0, accepted: 0, deadTokens: [], failed: false });
  assert.strictEqual(posts.length, 0);
});

test('a raw FCM token is never sent to the Expo push service', async () => {
  // The old app fell back to getDevicePushTokenAsync(), storing raw FCM tokens that Expo rejects.
  test.mock.method(memory, 'getPushTokens', async () => ['fcm-raw-token-123', GOOD]);
  let sent = null;
  test.mock.method(axios, 'post', async (url, messages) => { sent = messages; return { data: { data: [{ status: 'ok' }] } }; });

  const r = await sendPush('t', 'b');

  assert.strictEqual(r.attempted, 1);
  assert.deepStrictEqual(sent.map(m => m.to), [GOOD]);
});

test('accepted tickets are counted', async () => {
  test.mock.method(memory, 'getPushTokens', async () => [GOOD, GOOD2]);
  test.mock.method(axios, 'post', async () => ({ data: { data: [{ status: 'ok' }, { status: 'ok' }] } }));

  const r = await sendPush('t', 'b');

  assert.strictEqual(r.accepted, 2);
  assert.strictEqual(r.failed, false);
});

test('DeviceNotRegistered identifies the dead token by position', async () => {
  test.mock.method(memory, 'getPushTokens', async () => [GOOD, GOOD2]);
  test.mock.method(axios, 'post', async () => ({ data: { data: [
    { status: 'ok' },
    { status: 'error', details: { error: 'DeviceNotRegistered' } },
  ] } }));

  const r = await sendPush('t', 'b');

  assert.strictEqual(r.accepted, 1);
  assert.deepStrictEqual(r.deadTokens, [GOOD2]);
});

test('a failed request reports failure instead of throwing', async () => {
  test.mock.method(memory, 'getPushTokens', async () => [GOOD]);
  test.mock.method(axios, 'post', async () => { throw new Error('socket hang up'); });

  const r = await sendPush('t', 'b');

  assert.strictEqual(r.failed, true);
  assert.strictEqual(r.accepted, 0);
});

test('isExpoPushToken accepts both Expo token prefixes and nothing else', () => {
  assert.strictEqual(isExpoPushToken('ExponentPushToken[abc]'), true);
  assert.strictEqual(isExpoPushToken('ExpoPushToken[abc]'), true);
  assert.strictEqual(isExpoPushToken('fcm-raw-token'), false);
  assert.strictEqual(isExpoPushToken(''), false);
  assert.strictEqual(isExpoPushToken(undefined), false);
});

test('WhatsApp emphasis is removed, identifiers with underscores are not', () => {
  assert.strictEqual(stripWhatsAppMarkup('Starting: *Review* now'), 'Starting: Review now');
  assert.strictEqual(stripWhatsAppMarkup('the **One Big Thing**'), 'the One Big Thing');
  assert.strictEqual(stripWhatsAppMarkup('PR touches item_events and api_key'), 'PR touches item_events and api_key');
});

test('push text is short, single-line and cut on a word boundary', () => {
  assert.strictEqual(toPushText('Reminder: *call* the bank'), 'Reminder: call the bank');
  assert.strictEqual(toPushText('line one\n\nline two'), 'line one line two');

  const long = toPushText('word '.repeat(100));
  assert.ok(long.length <= 180, `got ${long.length}`);
  assert.ok(long.endsWith('…'));
  assert.ok(!long.endsWith(' …'), 'cut at a word, not mid-space');
});
