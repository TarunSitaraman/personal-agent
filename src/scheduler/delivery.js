// Single source of truth for reminder delivery.
//
// Three callers deliver reminders, and they used to each carry their own copy of the message
// text, button ids and push call: the exact-time timers (scheduler/timers.js), the Express
// catch-up sweep (scheduler/briefs.js) and the serverless catch-up sweep (api/cron/reminder.js).
// Keeping three copies in step by hand is how a button id or a wording change silently applies
// to one path only. They all route through here now.
//
// Dedup is not this module's job — it lives in the DB. The sweep queries claim the rows they
// return, and the timer path claims via memory.claimTodoReminder/claimEventReminder, so a timer
// and a sweep racing the same row still send once.

const memory = require('../agent/memory');
const { sendButtonMessage } = require('../whatsapp/send');
const { sendReminderPush, sendNudgePush } = require('../push/push');

// Formatting is kept pure and separate from sending so it can be asserted on directly.
function formatTodoReminder(todo) {
  return {
    text: `Reminder: ${todo.content}`,
    buttons: [
      { id: `rdone_${todo.id}`, title: 'Done' },
      { id: `rsnooze_60_${todo.id}`, title: 'Snooze 1hr' },
    ],
  };
}

function formatEventReminder(ev, now = Date.now()) {
  const timeStr = new Date(ev.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' });
  const minsAway = Math.max(1, Math.round((new Date(ev.start_at) - now) / 60000));
  return {
    text: `Starting in ${minsAway} min: *${ev.title}* at ${timeStr}`,
    // The push copy drops the WhatsApp bold markers, which would render literally.
    pushText: `Starting in ${minsAway} min: ${ev.title} at ${timeStr}`,
    buttons: [
      { id: `evnoted_${ev.id}`, title: 'Noted' },
      { id: `evsnooze_${ev.id}`, title: '+15 min' },
    ],
  };
}

async function deliverTodoReminder(todo) {
  const { text, buttons } = formatTodoReminder(todo);
  await sendButtonMessage(process.env.MY_WHATSAPP_NUMBER, text, buttons);
  await sendReminderPush(todo.id, todo.content);
}

async function deliverEventReminder(ev) {
  const { text, pushText, buttons } = formatEventReminder(ev);
  await sendButtonMessage(process.env.MY_WHATSAPP_NUMBER, text, buttons);
  await sendNudgePush(pushText);
}

// Catch-up path: delivers anything already overdue — reminders whose moment passed while the
// process was down, or which no timer was ever armed for (serverless holds no timers at all).
// Anything still in the future is left to scheduler/timers on the always-on server.
//
// Each half is guarded separately so a failing todo send cannot cost the event reminders.
// Returns the ids fired, for the serverless endpoint's response body.
async function sweepDueReminders() {
  const fired = [];

  try {
    const due = await memory.getDueTodoReminders();
    for (const todo of due) {
      await deliverTodoReminder(todo);
      fired.push(`reminder:${todo.id}`);
    }
  } catch (err) {
    console.error('Reminder check error:', err.message);
  }

  try {
    const upcoming = await memory.getEventsStartingSoon(0, memory.EVENT_LEAD_MINUTES);
    for (const ev of upcoming) {
      await deliverEventReminder(ev);
      fired.push(`event:${ev.id}`);
    }
  } catch (err) {
    console.error('Event reminder error:', err.message);
  }

  return fired;
}

module.exports = {
  formatTodoReminder,
  formatEventReminder,
  deliverTodoReminder,
  deliverEventReminder,
  sweepDueReminders,
};
