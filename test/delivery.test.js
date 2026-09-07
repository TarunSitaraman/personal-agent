// Reminder message formatting. Three paths deliver reminders (exact-time timers, the Express
// sweep, the serverless sweep) and they now share this one implementation — these assertions are
// what keeps the WhatsApp button ids in step with the handlers that parse them back in
// (src/whatsapp/webhook.js, src/agent/queueProcessor.js).

const test = require('node:test');
const assert = require('node:assert');

const { formatTodoReminder, formatEventReminder } = require('../src/scheduler/delivery');

test('todo reminder carries the content and both action buttons', () => {
  const { text, buttons } = formatTodoReminder({ id: 'abc-123', content: 'buy milk' });

  assert.strictEqual(text, 'Reminder: buy milk');
  // Button ids are a wire format — webhook.js splits on "_" to recover the id.
  assert.deepStrictEqual(buttons, [
    { id: 'rdone_abc-123', title: 'Done' },
    { id: 'rsnooze_60_abc-123', title: 'Snooze 1hr' },
  ]);
});

test('event reminder reports whole minutes until start', () => {
  const now = Date.now();
  const ev = { id: 'e1', title: 'Standup', start_at: new Date(now + 15 * 60000).toISOString() };

  const { text, buttons } = formatEventReminder(ev, now);

  assert.match(text, /^Starting in 15 min: \*Standup\* at /);
  assert.deepStrictEqual(buttons, [
    { id: 'evnoted_e1', title: 'Noted' },
    { id: 'evsnooze_e1', title: '+15 min' },
  ]);
});

test('event reminder never counts down below one minute', () => {
  const now = Date.now();
  // A sweep can pick an event up after its start time has already passed.
  const ev = { id: 'e2', title: 'Late', start_at: new Date(now - 5 * 60000).toISOString() };

  assert.match(formatEventReminder(ev, now).text, /^Starting in 1 min:/);
});

test('event reminder rounds to the nearest minute', () => {
  const now = Date.now();
  const ev = { id: 'e3', title: 'Soon', start_at: new Date(now + 100 * 1000).toISOString() };

  assert.match(formatEventReminder(ev, now).text, /^Starting in 2 min:/); // 1m40s rounds up
});

test('push copy drops the WhatsApp bold markers', () => {
  const now = Date.now();
  const ev = { id: 'e4', title: 'Review', start_at: new Date(now + 10 * 60000).toISOString() };

  const { text, pushText } = formatEventReminder(ev, now);

  assert.ok(text.includes('*Review*'), 'WhatsApp copy keeps the emphasis');
  assert.ok(!pushText.includes('*'), 'push notifications render asterisks literally');
  assert.ok(pushText.includes('Review'));
});

test('event time is rendered in IST regardless of server timezone', () => {
  // 2026-01-15T04:30:00Z is 10:00 in Asia/Kolkata.
  const ev = { id: 'e5', title: 'Sync', start_at: '2026-01-15T04:30:00.000Z' };
  const now = Date.parse('2026-01-15T04:15:00.000Z');

  assert.match(formatEventReminder(ev, now).text, /at 10:00/);
});
