// Recurrence expansion. Pure date arithmetic, no DB.
//
// Events carry a `recurrence` of none | daily | weekdays | weekly, but until now only the
// dashboard calendar could answer "when does this actually happen" — and it answered twice, in
// two copied blocks. Every delivery path instead filtered `recurrence = 'none'`, so a recurring
// event was stored, displayed, and never reminded once. This module is the single answer.
//
// All arithmetic is local-time, matching the rest of the codebase: the process runs with
// TZ=Asia/Kolkata, so a 9am weekdays event means 9am IST. `start_at` is both the pattern's
// time-of-day and its lower bound — an event created in June does not occur in March.

const VALID = ['none', 'daily', 'weekdays', 'weekly'];

// A recurring pattern is unbounded, so every walk needs a stop. A year of days is well past any
// window a caller asks for — the widest is the dashboard's month view.
const MAX_DAYS = 400;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// The occurrence datetime on a given calendar day: that day, at the pattern's time-of-day.
function atPatternTime(day, startAt) {
  const d = startOfDay(day);
  d.setHours(startAt.getHours(), startAt.getMinutes(), startAt.getSeconds(), 0);
  return d;
}

function dayMatches(recurrence, startAt, day) {
  const dow = day.getDay();
  switch (recurrence) {
    case 'daily':    return true;
    case 'weekdays': return dow >= 1 && dow <= 5;
    case 'weekly':   return dow === startAt.getDay();
    default:         return false;
  }
}

// Occurrences in [from, to). Returns [] rather than throwing on an unknown recurrence, so a bad
// value in the DB degrades to "never fires" instead of breaking the whole sweep for every event.
function occurrencesBetween(recurrence, startAt, from, to) {
  const start = new Date(startAt);
  const lo = new Date(from);
  const hi = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(lo.getTime()) || !(hi > lo)) return [];

  if (recurrence === 'none' || !VALID.includes(recurrence)) {
    return recurrence === 'none' && start >= lo && start < hi ? [start] : [];
  }

  // Never before the pattern's own start, and never more than MAX_DAYS of walking.
  const walkFrom = startOfDay(lo > start ? lo : start);
  const out = [];
  for (let i = 0; i < MAX_DAYS; i++) {
    const day = new Date(walkFrom);
    day.setDate(day.getDate() + i);
    if (day >= hi) break;
    if (!dayMatches(recurrence, start, day)) continue;

    // The lower bound is enforced by walkFrom above, at day granularity, and must not be
    // re-checked against `start` here: atPatternTime zeroes milliseconds, so for a start_at
    // carrying any, the pattern's own first occurrence compares as fractionally earlier than
    // itself and is dropped. That lost exactly one firing — the first — which is invisible in a
    // 48-hour brief and total in a 20-minute reminder window.
    const occurrence = atPatternTime(day, start);
    if (occurrence >= lo && occurrence < hi) out.push(occurrence);
  }
  return out;
}

// The first occurrence at or after `from`, or null if the pattern has none — a one-shot whose
// moment has passed, or a recurrence value the schema does not allow.
function nextOccurrence(recurrence, startAt, from = new Date()) {
  const lo = new Date(from);
  if (Number.isNaN(lo.getTime())) return null;
  const horizon = new Date(lo);
  horizon.setDate(horizon.getDate() + MAX_DAYS);
  return occurrencesBetween(recurrence, startAt, lo, horizon)[0] || null;
}

module.exports = { VALID, occurrencesBetween, nextOccurrence };
