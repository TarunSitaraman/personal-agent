// Precise, in-process reminder delivery for the always-on server.
//
// Why this exists: reminders used to be found by polling the DB every 60 seconds. Polling
// faster than Neon's autosuspend window keeps the compute endpoint hot 24/7 (~730 compute-hours
// a month against a ~192-hour free-tier budget), which exhausts the quota mid-month and makes
// every query fail. Slowing the poll down fixes the quota but makes reminders late.
//
// Instead: a sparse sweep looks ahead one horizon and arms an exact setTimeout per item, so the
// DB is touched a few times an hour while reminders still land on time. Every delivery goes
// through an atomic claim, so a timer and a catch-up sweep racing the same row send once.
//
// Serverless (api/cron/*) can't hold timers and keeps using the sweep alone.

const memory = require('../agent/memory');
const { deliverTodoReminder, deliverEventReminder } = require('./delivery');

// Must be >= the sweep interval that calls refresh(), or items can fall between passes.
const HORIZON_MINUTES = 20;

const timers = new Map();

function armTimer(key, fireAt, deliver) {
  if (timers.has(key)) return;

  const delay = Math.max(0, new Date(fireAt).getTime() - Date.now());
  const timer = setTimeout(async () => {
    timers.delete(key);
    try {
      await deliver();
    } catch (err) {
      console.error(`[Timers] Delivery failed for ${key}:`, err.message);
    }
  }, delay);

  timers.set(key, timer);
}

async function deliverTodo(id) {
  const todo = await memory.claimTodoReminder(id);
  if (!todo) return; // already delivered, completed, or cancelled
  await deliverTodoReminder(todo);
}

async function deliverEvent(id) {
  const ev = await memory.claimEventReminder(id);
  if (!ev) return; // already delivered or the event was removed
  await deliverEventReminder(ev);
}

// Arms timers for everything due within the horizon. Safe to call often — already-armed
// items are skipped, and one call is one query pair.
async function refresh() {
  try {
    const { todos, events } = await memory.getUpcomingReminders(HORIZON_MINUTES);

    for (const todo of todos) {
      armTimer(`todo:${todo.id}`, todo.fire_at, () => deliverTodo(todo.id));
    }
    for (const ev of events) {
      armTimer(`event:${ev.id}`, ev.fire_at, () => deliverEvent(ev.id));
    }
  } catch (err) {
    console.error('[Timers] Refresh failed:', err.message);
  }
}

module.exports = { refresh, HORIZON_MINUTES };
