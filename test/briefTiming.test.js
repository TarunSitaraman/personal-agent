// Guards the multi-timezone brief gate. Uses node's built-in fake timers to pin "now" to known
// UTC instants, so the test is deterministic regardless of when it actually runs.
//
// See CLAUDE.md "Two things still single-user" and src/scheduler/briefTiming.js for why this
// exists: cron-job.org fires each endpoint at one fixed clock time, and forEachUser fans that
// out to every user regardless of their own tz. This is the per-user filter that makes it safe
// to widen the trigger to hourly.

const test = require('node:test');
const assert = require('node:assert');

const { isUserBriefTime, localTimeSkip } = require('../src/scheduler/briefTiming');

const berlinUser = { wa_number: '49000', tz: 'Europe/Berlin' };

test('without ?hourly=1 the gate never skips — today\'s once-daily triggers keep working', () => {
  // 05:30 IST, nowhere near 9am anywhere relevant. Must still run, because the real
  // cron-job.org trigger time is unknown to this repo.
  test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-14T00:00:00Z') });
  assert.strictEqual(localTimeSkip({}, berlinUser, 9), null);
  assert.strictEqual(localTimeSkip(undefined, berlinUser, 9), null);
  assert.strictEqual(localTimeSkip({ secret: 'x' }, berlinUser, 9), null);
  test.mock.timers.reset();
});

test('with ?hourly=1 the gate skips a user outside their local target hour', () => {
  test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-14T03:30:00Z') }); // 05:30 Berlin
  const skip = localTimeSkip({ hourly: '1' }, berlinUser, 9);
  assert.match(skip, /skipped/);
  assert.match(skip, /Europe\/Berlin/);
  test.mock.timers.reset();
});

test('with ?hourly=1 the gate admits a user at their local target hour', () => {
  test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-14T07:00:00Z') }); // 09:00 Berlin (CEST)
  assert.strictEqual(localTimeSkip({ hourly: '1' }, berlinUser, 9), null);
  test.mock.timers.reset();
});

test('a user with no stored tz is evaluated in Asia/Kolkata, not the UTC runtime default', () => {
  test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-14T03:30:00Z') }); // 09:00 IST, 03:30 UTC
  assert.strictEqual(localTimeSkip({ hourly: '1' }, { wa_number: '91000', tz: null }, 9), null);
  test.mock.timers.reset();
});

test('matches a user whose local hour equals the target hour', () => {
  // 2026-09-14 is a Monday. 09:00 IST = 03:30 UTC.
  test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-14T03:30:00Z') });
  assert.strictEqual(isUserBriefTime('Asia/Kolkata', 9), true);
  test.mock.timers.reset();
});

test('does not match a user in a different timezone at the same instant', () => {
  // Same instant as above (09:00 IST). In America/New_York this is 23:30 the previous day.
  test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-14T03:30:00Z') });
  assert.strictEqual(isUserBriefTime('America/New_York', 9), false);
  test.mock.timers.reset();
});

test('a user in a different timezone matches at their own local target hour', () => {
  // 09:00 America/New_York (EDT, UTC-4) = 13:00 UTC.
  test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-14T13:00:00Z') });
  assert.strictEqual(isUserBriefTime('America/New_York', 9), true);
  test.mock.timers.reset();
});

test('weekdaysOnly excludes Saturday and Sunday', () => {
  // 2026-09-12 is a Saturday, 09:00 IST = 03:30 UTC.
  test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-12T03:30:00Z') });
  assert.strictEqual(isUserBriefTime('Asia/Kolkata', 9, { weekdaysOnly: true }), false);
  test.mock.timers.reset();
});

test('weekdaysOnly admits a weekday at the target hour', () => {
  // 2026-09-14 is a Monday, 09:00 IST = 03:30 UTC.
  test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-14T03:30:00Z') });
  assert.strictEqual(isUserBriefTime('Asia/Kolkata', 9, { weekdaysOnly: true }), true);
  test.mock.timers.reset();
});

test('sundayOnly rejects a non-Sunday at the target hour', () => {
  // 2026-09-14 is a Monday, 10:00 IST = 04:30 UTC.
  test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-14T04:30:00Z') });
  assert.strictEqual(isUserBriefTime('Asia/Kolkata', 10, { sundayOnly: true }), false);
  test.mock.timers.reset();
});

test('sundayOnly admits Sunday at the target hour', () => {
  // 2026-09-13 is a Sunday, 10:00 IST = 04:30 UTC.
  test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-13T04:30:00Z') });
  assert.strictEqual(isUserBriefTime('Asia/Kolkata', 10, { sundayOnly: true }), true);
  test.mock.timers.reset();
});

test('rejects the wrong hour entirely', () => {
  test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-14T00:00:00Z') }); // 05:30 IST
  assert.strictEqual(isUserBriefTime('Asia/Kolkata', 9), false);
  test.mock.timers.reset();
});
