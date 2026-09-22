const test = require('node:test');
const assert = require('node:assert');
const { reminderFromText } = require('../src/agent/timeHints');

const TZ = 'Asia/Kolkata';
// Tue 22 Sep 2026, 10:36 IST — when the grocery todo was actually sent.
const NOW = new Date('2026-09-22T10:36:00+05:30');
const at = (text, now = NOW) => {
  const d = reminderFromText(text, now, TZ);
  return d ? d.toISOString() : null;
};
const ist = s => new Date(s + '+05:30').toISOString();

test('the production message that got no reminder: "today ... around 6pm"', () => {
  assert.strictEqual(at('order groceries today after college around 6pm'), ist('2026-09-22T18:00:00'));
});

test('clock times, with and without minutes, am/pm and 24h', () => {
  assert.strictEqual(at('call the bank at 4:30pm'), ist('2026-09-22T16:30:00'));
  assert.strictEqual(at('standup prep at 17:45'), ist('2026-09-22T17:45:00'));
  assert.strictEqual(at('pay rent by 11 am tomorrow'), ist('2026-09-23T11:00:00'));
  assert.strictEqual(at('lunch with Ravi at noon'), ist('2026-09-22T12:00:00'));
});

test('a time already past today rolls to tomorrow, unless "today" was said', () => {
  assert.strictEqual(at('take vitamins at 9am'), ist('2026-09-23T09:00:00'));
  assert.strictEqual(at('take vitamins today at 9am'), null);
});

test('day parts without a clock time', () => {
  assert.strictEqual(at('buy groceries tonight'), ist('2026-09-22T21:00:00'));
  assert.strictEqual(at('email the dean this evening'), ist('2026-09-22T18:00:00'));
  assert.strictEqual(at('renew parking pass tomorrow'), ist('2026-09-23T08:00:00'));
  assert.strictEqual(at('gym tomorrow evening'), ist('2026-09-23T18:00:00'));
  assert.strictEqual(at('tomorrow morning review PR 214'), ist('2026-09-23T08:00:00'));
});

test('weekdays mean the next one, never today', () => {
  assert.strictEqual(at('submit report on friday at 10:30am'), ist('2026-09-25T10:30:00'));
  assert.strictEqual(at('dentist tuesday 3pm'), ist('2026-09-29T15:00:00')); // today is Tuesday
});

test('relative offsets', () => {
  assert.strictEqual(at('check the oven in 20 minutes'), ist('2026-09-22T10:56:00'));
  assert.strictEqual(at('follow up in 2 hours'), ist('2026-09-22T12:36:00'));
});

test('no time at all, or a bare number, sets nothing', () => {
  assert.strictEqual(at('buy milk'), null);
  assert.strictEqual(at('read 6 chapters of FLA'), null);
  assert.strictEqual(at('ship v2 of the app'), null);
  assert.strictEqual(at(''), null);
  assert.strictEqual(at(null), null);
});
