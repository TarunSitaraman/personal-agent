// Single source of truth for reminder delivery.
//
// Three callers deliver reminders, and they used to each carry their own copy of the message
// text, button ids and push call: the exact-time timers (scheduler/timers.js), the Express
// catch-up sweep (scheduler/briefs.js) and the serverless catch-up sweep (api/cron/reminder.js).
// Keeping three copies in step by hand is how a button id or a wording change silently applies
// to one path only. They all route through here now.
//
// The destination is currentNumber(), not an env var: every caller already runs inside a user
// scope, so a reminder goes to whoever owns it rather than to whoever deployed the process.
//
// Dedup is not this module's job — it lives in the DB. The sweep queries claim the rows they
// return, and the timer path claims via memory.claimTodoReminder/claimEventReminder, so a timer
// and a sweep racing the same row still send once.

const memory = require('../agent/memory');
// Module objects, not destructured, so tests can substitute them (see src/whatsapp/buttons.js).
const send = require('../whatsapp/send');
const push = require('../push/push');
const { currentNumber } = require('../agent/context');

// The app creates these Android channels (mobile/App.js); a missing one falls back to 'default'.
const PUSH_CHANNEL = {
  reminder: 'reminders', event: 'reminders',
  brief: 'briefs', evening: 'briefs', pulse: 'briefs', weekly: 'briefs',
  nudge: 'nudges', goal: 'nudges',
};
const PUSH_TITLE = {
  reminder: 'Reminder', event: 'Starting soon', brief: 'Morning brief', evening: 'Evening brief',
  nudge: 'Blu', goal: 'One Big Thing', pulse: 'Tech pulse', weekly: 'Weekly review',
};

// Push when a registered device accepted it, otherwise WhatsApp. `attempted` is how many valid
// tokens the user had; zero accepted covers every token being dead as well as a failed request.
function chooseChannel(pushResult) {
  if (!pushResult || !pushResult.attempted) return 'whatsapp';
  if (pushResult.failed || pushResult.accepted === 0) return 'whatsapp';
  return 'push';
}

// Every proactive message goes through here: the app first, WhatsApp as the fallback, and the
// inbox always — written after sending, so it records the channel that actually delivered and a
// failed write can never delay a notification. Runs inside a user scope.
// See docs/superpowers/specs/2026-09-19-mobile-foundation-design.md.
async function deliver({ kind, title = null, text, whatsapp = null }) {
  const pushTitle = title || PUSH_TITLE[kind] || 'Blu';

  const pushResult = await push.sendPush(pushTitle, push.toPushText(text), {
    type: kind,
    channelId: PUSH_CHANNEL[kind] || 'default',
  }).catch(err => {
    console.error(`[Deliver] ${kind}: push threw:`, err.message);
    return { attempted: 0, accepted: 0, deadTokens: [], failed: true };
  });

  for (const token of pushResult.deadTokens) {
    await memory.removePushToken(token)
      .catch(err => console.error('[Deliver] token prune failed:', err.message));
  }

  let channel = chooseChannel(pushResult);
  if (channel === 'whatsapp') {
    const wa = whatsapp || { text };
    try {
      if (wa.buttons?.length) await send.sendButtonMessage(currentNumber(), wa.text, wa.buttons);
      else await send.sendMessage(currentNumber(), wa.text);
    } catch (err) {
      console.error(`[Deliver] ${kind}: no push and WhatsApp failed:`, err.message);
      channel = 'failed';
    }
  }

  await memory.saveInboxMessage({ kind, title: pushTitle, body: push.stripWhatsAppMarkup(text), channel })
    .catch(err => console.error('[Deliver] inbox write failed:', err.message));

  return channel;
}

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
    buttons: [
      { id: `evnoted_${ev.id}`, title: 'Noted' },
      { id: `evsnooze_${ev.id}`, title: '+15 min' },
    ],
  };
}

async function deliverTodoReminder(todo) {
  const { text, buttons } = formatTodoReminder(todo);
  return deliver({ kind: 'reminder', text, whatsapp: { text, buttons } });
}

async function deliverEventReminder(ev) {
  const { text, buttons } = formatEventReminder(ev);
  return deliver({ kind: 'event', text, whatsapp: { text, buttons } });
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
  deliver,
  chooseChannel,
};
