const cron = require('node-cron');
const { generateStandup, generateProactiveNudge, generateStaleAlert, generateWeeklyReview } = require('../agent/brain');
const { sendMessage, sendButtonMessage, sendListMessage } = require('../whatsapp/send');
const { sendReminderPush, sendBriefPush, sendNudgePush } = require('../push/push');
const memory = require('../agent/memory');

function startScheduler() {
  const myNumber = process.env.MY_WHATSAPP_NUMBER;
  const remindedEventIds = new Set();

  // 9:00 AM IST — Morning brief (Hexaware standup)
  cron.schedule('0 9 * * 1-5', async () => {
    try {
      const standup = await generateStandup('hexaware');
      await sendMessage(myNumber, standup);
      await sendBriefPush('Morning Brief', 'Your Hexaware day starts now. Tap to see context.');
    } catch (err) {
      console.error('Morning brief error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 6:00 PM IST — Mode transition: Hexaware → SmartResQ
  cron.schedule('0 18 * * *', async () => {
    try {
      const standup = await generateStandup('smartresq');
      await sendMessage(myNumber, standup);
      // Follow up with a goal-setting nudge after the brief arrives
      setTimeout(async () => {
        await sendButtonMessage(myNumber, "What's the *One Big Thing* you want to move tonight?", [
          { id: 'obt_set', title: "Set it now" },
          { id: 'obt_skip', title: "Skip tonight" },
        ]);
      }, 1500);
    } catch (err) {
      console.error('Mode transition brief error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // Every minute — check due todo reminders + events starting in ~15 min
  cron.schedule('* * * * *', async () => {
    try {
      const due = await memory.getDueTodoReminders();
      for (const todo of due) {
        await sendButtonMessage(myNumber, `Reminder: ${todo.content}`, [
          { id: `rdone_${todo.id}`, title: 'Done' },
          { id: `rsnooze_60_${todo.id}`, title: 'Snooze 1hr' },
        ]);
        await sendReminderPush(todo.id, todo.content);
      }
    } catch (err) {
      console.error('Reminder check error:', err.message);
    }

    try {
      const upcoming = await memory.getEventsStartingSoon(14, 16);
      for (const ev of upcoming) {
        if (remindedEventIds.has(ev.id)) continue;
        remindedEventIds.add(ev.id);
        const timeStr = new Date(ev.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' });
        await sendButtonMessage(myNumber, `Starting in 15 min: *${ev.title}* at ${timeStr}`, [
          { id: `evnoted_${ev.id}`, title: 'Noted' },
          { id: `evsnooze_${ev.id}`, title: '+15 min' },
        ]);
        await sendNudgePush(`Starting in 15 min: ${ev.title} at ${timeStr}`);
      }
    } catch (err) {
      console.error('Event reminder error:', err.message);
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

  // Sunday 8:00 PM IST — weekly review + conversation trim
  cron.schedule('0 20 * * 0', async () => {
    try {
      await memory.trimConversations(200);
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
      if (nudge) {
        await sendMessage(myNumber, nudge);
        // Push a short version (notifications have limited space)
        await sendNudgePush(nudge.slice(0, 120));
      }
    } catch (err) {
      console.error('Proactive nudge error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 10:00 AM Sunday — Tech Twitter Pulse
  cron.schedule('0 10 * * 0', async () => {
    try {
      const pulse = await generateTechPulse();
      if (pulse) await sendMessage(myNumber, pulse);
    } catch (err) {
      console.error('Tech Pulse error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 10:00 PM IST — late night goal nudge
  cron.schedule('0 22 * * *', async () => {
    try {
      const pendingGoal = await memory.getPendingGoal();
      if (pendingGoal) {
        await sendMessage(myNumber, `Hermes checking in: How's progress on the **One Big Thing**? (*${pendingGoal.content}*). Almost there?`);
      }
    } catch (err) {
      console.error('Goal nudge error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('Scheduler started — morning (10am), evening (7pm), Tech Pulse (Sun 10am), Weekly Review (Sun 8pm), and Goal Nudge (10pm)');
}

module.exports = { startScheduler };
