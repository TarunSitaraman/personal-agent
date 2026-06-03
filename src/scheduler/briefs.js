const cron = require('node-cron');
const { generateBrief, generateProactiveNudge } = require('../agent/brain');
const { sendMessage } = require('../whatsapp/send');
const memory = require('../agent/memory');

function startScheduler() {
  const myNumber = process.env.MY_WHATSAPP_NUMBER;

  // 10:00 AM IST — morning brief
  cron.schedule('0 10 * * 1-5', async () => {
    try {
      const brief = await generateBrief('morning');
      await sendMessage(myNumber, brief);
    } catch (err) {
      console.error('Morning brief error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 7:00 PM IST — evening switch
  cron.schedule('0 19 * * *', async () => {
    try {
      const brief = await generateBrief('evening');
      await sendMessage(myNumber, brief);
    } catch (err) {
      console.error('Evening brief error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // Every minute — check due reminders
  cron.schedule('* * * * *', async () => {
    try {
      const due = await memory.getDueReminders();
      for (const reminder of due) {
        await sendMessage(myNumber, `Reminder: ${reminder.content}`);
      }
    } catch (err) {
      console.error('Reminder check error:', err.message);
    }
  });

  // 9:00 PM IST — proactive nudge
  cron.schedule('0 21 * * *', async () => {
    try {
      const nudge = await generateProactiveNudge();
      if (nudge) await sendMessage(myNumber, nudge);
    } catch (err) {
      console.error('Proactive nudge error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('Scheduler started — morning (10am), evening (7pm), reminders (every min), nudge (9pm)');
}

module.exports = { startScheduler };
