const test = require('node:test');
const assert = require('node:assert');
const { parseSince, MAX_WINDOW_MS } = require('../src/agent/doneToday');

const NOW = new Date('2026-09-22T22:40:00.000Z');

test("accepts the phone's local midnight and normalises it to ISO", () => {
  // 00:00 IST on the 23rd, sent with an offset the way the app sends it
  assert.strictEqual(parseSince({ since: '2026-09-23T00:00:00+05:30' }, NOW), '2026-09-22T18:30:00.000Z');
});

test('rejects missing, unparseable, future and too-old values', () => {
  assert.strictEqual(parseSince({}, NOW), null);
  assert.strictEqual(parseSince(null, NOW), null);
  assert.strictEqual(parseSince({ since: 'yesterday' }, NOW), null);
  assert.strictEqual(parseSince({ since: '2026-09-23T00:00:00Z' }, NOW), null); // after now
  const tooOld = new Date(NOW.getTime() - MAX_WINDOW_MS - 1000).toISOString();
  assert.strictEqual(parseSince({ since: tooOld }, NOW), null);
});

test('an array (?since=a&since=b) is rejected, not coerced', () => {
  assert.strictEqual(parseSince({ since: ['2026-09-22T18:30:00Z', 'x'] }, NOW), null);
});
