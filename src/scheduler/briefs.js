const cron = require('node-cron');
const { generateStandup, generateProactiveNudge, generateStaleAlert, generateWeeklyReview } = require('../agent/brain');
const { sendMessage, sendButtonMessage } = require('../whatsapp/send');
const memory = require('../agent/memory');

function startScheduler() {
  const myNumber = process.env.MY_WHATSAPP_NUMBER;

  // 8:00 AM IST — Hexaware standup
  cron.schedule('0 8 * * 1-5', async () => {
    try {
      const standup = await generateStandup('hexaware');
      await sendMessage(myNumber, standup);
    } catch (err) {
      console.error('Hexaware standup error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 6:30 PM IST — SmartResQ standup
  cron.schedule('30 18 * * *', async () => {
    try {
      const standup = await generateStandup('smartresq');
      await sendMessage(myNumber, standup);
    } catch (err) {
      console.error('SmartResQ standup error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // Every minute — check due reminders
  cron.schedule('* * * * *', async () => {
    try {
      const due = await memory.getDueReminders();
      for (const reminder of due) {
        await sendButtonMessage(myNumber, `Reminder: ${reminder.content}`, [
          { id: 'reminder_done', title: 'Done ✓' },
          { id: 'reminder_snooze', title: 'Snooze 1hr' },
        ]);
      }
    } catch (err) {
      console.error('Reminder check error:', err.message);
    }
  });

  // 9:00 AM IST daily — stale todo alert
  cron.schedule('0 9 * * 1-5', async () => {
    try {
      const alert = await generateStaleAlert();
      if (alert) {
        await sendButtonMessage(myNumber, alert, [
          { id: 'stale_snooze', title: 'Snooze 2 days' },
          { id: 'stale_dismiss', title: 'Dismiss' },
        ]);
      }
    } catch (err) {
      console.error('Stale alert error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // Sunday 8:00 PM IST — weekly review
  cron.schedule('0 20 * * 0', async () => {
    try {
      const review = await generateWeeklyReview();
      await sendMessage(myNumber, review);
    } catch (err) {
      console.error('Weekly review error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 9:00 PM IST — proactive nudge
  cron.schedule('0 21 * * *', async () => {
    try {
      const nudge = await generateProactiveNudge();
      if (nudge) await sendMessage(myNumber, nudge);
    } catch (err) {
      console.error('Proactive nudge error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('Scheduler started — Hexaware standup (8am), SmartResQ standup (6:30pm), reminders (every min), nudge (9pm)');
}

module.exports = { startScheduler };
