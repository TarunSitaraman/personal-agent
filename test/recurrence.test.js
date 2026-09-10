// Recurrence expansion — the rule that decides when a repeating event actually fires.
//
// This is the whole reason recurring reminders were dead: every delivery path filtered
// `recurrence = 'none'` because nothing could answer "when is the next one". These assertions are
// what that answer is checked against, and they run without a database — the expansion is pure.
//
// Dates are written with an explicit +05:30 offset. India has no DST, so a local-time walk is
// stable year-round, which is why the walk is allowed to use local Date methods at all.

const test = require('node:test');
const assert = require('node:assert');

const { occurrencesBetween, nextOccurrence } = require('../src/agent/recurrence');

const MONDAY_9AM = new Date('2026-09-07T09:00:00+05:30');

test('a weekdays pattern skips the weekend', () => {
  // Friday evening — the next standup is Monday, not Saturday.
  const next = nextOccurrence('weekdays', MONDAY_9AM, new Date('2026-09-11T18:00:00+05:30'));

  assert.strictEqual(next.toISOString(), new Date('2026-09-14T09:00:00+05:30').toISOString());
});

test('a weekdays pattern yields five occurrences in a full week', () => {
  const week = occurrencesBetween(
    'weekdays', MONDAY_9AM,
    new Date('2026-09-14T00:00:00+05:30'),
    new Date('2026-09-21T00:00:00+05:30')
  );

  assert.strictEqual(week.length, 5);
  assert.ok(week.every(d => d.getDay() >= 1 && d.getDay() <= 5));
});

test('a daily pattern keeps the pattern time-of-day, not the window boundary', () => {
  const [first] = occurrencesBetween(
    'daily', MONDAY_9AM,
    new Date('2026-09-20T00:00:00+05:30'),
    new Date('2026-09-21T00:00:00+05:30')
  );

  assert.strictEqual(first.getHours(), 9);
  assert.strictEqual(first.getMinutes(), 0);
});

test('a weekly pattern lands on the same weekday as its start', () => {
  const month = occurrencesBetween(
    'weekly', MONDAY_9AM,
    new Date('2026-09-09T00:00:00+05:30'),
    new Date('2026-10-09T00:00:00+05:30')
  );

  assert.strictEqual(month.length, 4);
  assert.ok(month.every(d => d.getDay() === MONDAY_9AM.getDay()));
});

test('a pattern never occurs before its own start date', () => {
  // The dashboard's two copied expansions got this wrong: an event created in September was
  // drawn onto every day of every earlier month too.
  const before = occurrencesBetween(
    'daily', MONDAY_9AM,
    new Date('2026-03-01T00:00:00+05:30'),
    new Date('2026-03-05T00:00:00+05:30')
  );

  assert.deepStrictEqual(before, []);
});

test('the first occurrence survives a start_at carrying milliseconds', () => {
  // Occurrences are built at second precision, so re-checking them against a millisecond-bearing
  // start_at made the pattern's own first firing compare as earlier than itself. It was dropped —
  // silently, and only the first, which a wide window hides and a 20-minute one does not.
  const withMs = new Date('2026-09-07T09:00:00.123+05:30');
  const found = occurrencesBetween(
    'daily', withMs,
    new Date('2026-09-07T08:00:00+05:30'),
    new Date('2026-09-07T10:00:00+05:30')
  );

  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].getHours(), 9);
});

test('a one-shot event occurs exactly once, and only inside the window', () => {
  const inside = occurrencesBetween(
    'none', MONDAY_9AM,
    new Date('2026-09-07T08:00:00+05:30'),
    new Date('2026-09-07T10:00:00+05:30')
  );
  const outside = occurrencesBetween(
    'none', MONDAY_9AM,
    new Date('2026-09-08T08:00:00+05:30'),
    new Date('2026-09-08T10:00:00+05:30')
  );

  assert.strictEqual(inside.length, 1);
  assert.strictEqual(inside[0].toISOString(), MONDAY_9AM.toISOString());
  assert.deepStrictEqual(outside, []);
});

test('a recurrence the schema does not allow yields nothing rather than throwing', () => {
  // A bad value reaching the DB must cost that one event its reminders, not break the sweep
  // for every other event in the same pass.
  assert.deepStrictEqual(
    occurrencesBetween('hourly', MONDAY_9AM, new Date('2026-09-14T00:00:00+05:30'), new Date('2026-09-15T00:00:00+05:30')),
    []
  );
  assert.strictEqual(nextOccurrence('hourly', MONDAY_9AM, new Date('2026-09-14T00:00:00+05:30')), null);
});

test('an unparseable start_at yields nothing rather than throwing', () => {
  assert.deepStrictEqual(
    occurrencesBetween('daily', 'not a date', new Date('2026-09-14T00:00:00+05:30'), new Date('2026-09-15T00:00:00+05:30')),
    []
  );
});

test('an inverted or empty window yields nothing', () => {
  assert.deepStrictEqual(
    occurrencesBetween('daily', MONDAY_9AM, new Date('2026-09-15T00:00:00+05:30'), new Date('2026-09-14T00:00:00+05:30')),
    []
  );
});

test('a past one-shot has no next occurrence', () => {
  assert.strictEqual(nextOccurrence('none', MONDAY_9AM, new Date('2026-09-08T00:00:00+05:30')), null);
});

test('the window is half-open, so an occurrence is never delivered by two adjacent sweeps', () => {
  // Sweeps tile the timeline back to back. If both ends were inclusive, the occurrence sitting
  // exactly on a boundary would be picked up twice — once per sweep.
  const boundary = new Date('2026-09-14T09:00:00+05:30');
  const earlier = occurrencesBetween('weekdays', MONDAY_9AM, new Date('2026-09-14T08:00:00+05:30'), boundary);
  const later = occurrencesBetween('weekdays', MONDAY_9AM, boundary, new Date('2026-09-14T10:00:00+05:30'));

  assert.deepStrictEqual(earlier, []);
  assert.strictEqual(later.length, 1);
});
