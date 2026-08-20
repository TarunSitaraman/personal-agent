const cron = require('node-cron');
const { generateStandup, generateProactiveNudge, generateStaleAlert, generateWeeklyReview, generateTechPulse } = require('../agent/brain');
const { sendMessage, sendButtonMessage, sendListMessage } = require('../whatsapp/send');
const { sendReminderPush, sendBriefPush, sendNudgePush } = require('../push/push');
const memory = require('../agent/memory');
const timers = require('./timers');

function startScheduler() {
  const myNumber = process.env.MY_WHATSAPP_NUMBER;

  // 9:00 AM IST — Morning brief (Morning Brief)
  cron.schedule('0 9 * * 1-5', async () => {
    try {
      const standup = await generateStandup("generic");
      await sendMessage(myNumber, standup);
      await sendBriefPush('Morning Brief', 'Your day starts now. Tap to see context.');
    } catch (err) {
      console.error('Morning brief error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 6:00 PM IST — Evening Brief
  cron.schedule('0 18 * * *', async () => {
    try {
      const standup = await generateStandup("generic");
      await sendMessage(myNumber, standup);
      // Follow up with a goal-setting nudge after the brief arrives
      setTimeout(async () => {
        await sendButtonMessage(myNumber, "What's the *One Big Thing* you want to move tonight?", [
          { id: 'obt_set', title: "Set it now" },
          { id: 'obt_skip', title: "Skip tonight" },
        ]);
      }, 1500);
    } catch (err) {
      console.error('Evening brief error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // Every 15 min, 06:00–23:59 IST — queue retry sweep, catch-up on missed reminders, and
  // re-arm the precise timers that actually deliver on time (see scheduler/timers.js).
  // Deliberately NOT every minute: sub-autosuspend polling keeps the Neon compute endpoint hot
  // 24/7 (~730 compute-hours/month against a ~192-hour free-tier budget), which exhausts the
  // quota mid-month and makes every DB call fail. Inbound messages are already processed
  // immediately by the webhook, so this sweep never needs to be the fast path.
  cron.schedule('*/15 6-23 * * *', async () => {
    // 1. Process message queue
    try {
      const { processQueue } = require('../agent/queueProcessor');
      await processQueue();
    } catch (err) {
      console.error('Queue processing error:', err.message);
    }

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
      // Catch-up only: events whose 15-min mark already passed (missed while the process was
      // down). Anything still in the future is delivered exactly on time by scheduler/timers.
      const upcoming = await memory.getEventsStartingSoon(0, memory.EVENT_LEAD_MINUTES);
      for (const ev of upcoming) {
        const timeStr = new Date(ev.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' });
        const minsAway = Math.max(1, Math.round((new Date(ev.start_at) - Date.now()) / 60000));
        await sendButtonMessage(myNumber, `Starting in ${minsAway} min: *${ev.title}* at ${timeStr}`, [
          { id: `evnoted_${ev.id}`, title: 'Noted' },
          { id: `evsnooze_${ev.id}`, title: '+15 min' },
        ]);
        await sendNudgePush(`Starting in ${minsAway} min: ${ev.title} at ${timeStr}`);
      }
    } catch (err) {
      console.error('Event reminder error:', err.message);
    }

    // Arm exact-time delivery for everything due before the next sweep.
    await timers.refresh();
  }, { timezone: 'Asia/Kolkata' });

  // Midnight daily — run memory decay check + auto-summarise old notes (Item 8 & 13)
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('Running daily memory decay check...');
      const decayResults = await memory.processMemoryDecay();
      console.log(`Memory decay complete: flagged ${decayResults.flagged} facts, pruned ${decayResults.pruned} facts.`);
    } catch (err) {
      console.error('Memory decay check error:', err.message);
    }

    try {
      console.log('Running daily notes auto-summarization and archiving...');
      const { autoSummarizeOldNotes } = require('../agent/brain');
      await autoSummarizeOldNotes();
    } catch (err) {
      console.error('Auto-summarize old notes error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

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

  // Arm timers for anything already due within the horizon, so a restart doesn't wait
  // for the first sweep.
  timers.refresh();

  console.log('Scheduler started — morning brief (9am Mon-Fri), evening brief (6pm), reminder sweep (every 15min, 6am-midnight), Tech Pulse (Sun 10am), Weekly Review (Sun 8pm), Goal Nudge (10pm)');
}

module.exports = { startScheduler };
