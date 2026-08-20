require('dotenv').config();
const memory = require('../../src/agent/memory');
const { sendButtonMessage } = require('../../src/whatsapp/send');
const { sendReminderPush, sendNudgePush } = require('../../src/push/push');

function auth(req) {
  const secret = req.headers['authorization']?.replace('Bearer ', '') || req.query.secret;
  return secret === process.env.CRON_SECRET;
}

// Dedup lives in the DB: getEventsStartingSoon and getDueTodoReminders both claim the rows
// they return, so this endpoint is safe to call at any interval and needs no in-process state.
// Call it every 15 min, not every minute — polling faster than Neon's autosuspend window keeps
// the compute endpoint hot 24/7 and burns the whole monthly compute quota by mid-month.

module.exports = async (req, res) => {
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const myNumber = process.env.MY_WHATSAPP_NUMBER;
  const fired = [];

  try {
    const due = await memory.getDueTodoReminders();
    for (const todo of due) {
      await sendButtonMessage(myNumber, `Reminder: ${todo.content}`, [
        { id: `rdone_${todo.id}`, title: 'Done' },
        { id: `rsnooze_60_${todo.id}`, title: 'Snooze 1hr' },
      ]);
      await sendReminderPush(todo.id, todo.content);
      fired.push(`reminder:${todo.id}`);
    }
  } catch (err) {
    console.error('Reminder check error:', err.message);
  }

  try {
    // Fire once the event is inside its lead window. Serverless can't hold timers, so
    // reminders here land within one call interval rather than to the minute.
    const upcoming = await memory.getEventsStartingSoon(0, memory.EVENT_LEAD_MINUTES);
    for (const ev of upcoming) {
      const timeStr = new Date(ev.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' });
      const minsAway = Math.max(1, Math.round((new Date(ev.start_at) - Date.now()) / 60000));
      await sendButtonMessage(myNumber, `Starting in ${minsAway} min: *${ev.title}* at ${timeStr}`, [
        { id: `evnoted_${ev.id}`, title: 'Noted' },
        { id: `evsnooze_${ev.id}`, title: '+15 min' },
      ]);
      await sendNudgePush(`Starting in ${minsAway} min: ${ev.title} at ${timeStr}`);
      fired.push(`event:${ev.id}`);
    }
  } catch (err) {
    console.error('Event reminder error:', err.message);
  }

  res.json({ ok: true, fired });
};
