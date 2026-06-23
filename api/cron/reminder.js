require('dotenv').config();
const memory = require('../../src/agent/memory');
const { sendButtonMessage } = require('../../src/whatsapp/send');
const { sendReminderPush, sendNudgePush } = require('../../src/push/push');

function auth(req) {
  const secret = req.headers['authorization']?.replace('Bearer ', '') || req.query.secret;
  return secret === process.env.CRON_SECRET;
}

// In-memory set not useful across serverless invocations — use a short TTL in DB instead.
// For event reminders we check a 2-minute window to avoid double-firing on each invocation.

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
    // 14–16 min window — cron-job.org calls this every minute so a 2-min window avoids gaps
    const upcoming = await memory.getEventsStartingSoon(14, 16);
    for (const ev of upcoming) {
      const timeStr = new Date(ev.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' });
      await sendButtonMessage(myNumber, `Starting in 15 min: *${ev.title}* at ${timeStr}`, [
        { id: `evnoted_${ev.id}`, title: 'Noted' },
        { id: `evsnooze_${ev.id}`, title: '+15 min' },
      ]);
      await sendNudgePush(`Starting in 15 min: ${ev.title} at ${timeStr}`);
      fired.push(`event:${ev.id}`);
    }
  } catch (err) {
    console.error('Event reminder error:', err.message);
  }

  res.json({ ok: true, fired });
};
