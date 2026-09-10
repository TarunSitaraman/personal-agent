const cron = require('node-cron');
const { generateStandup, generateProactiveNudge, generateStaleAlert, generateWeeklyReview, generateTechPulse } = require('../agent/brain');
const { sendMessage, sendButtonMessage, sendListMessage } = require('../whatsapp/send');
const { sendBriefPush, sendNudgePush } = require('../push/push');
const memory = require('../agent/memory');
const timers = require('./timers');
const { sweepDueReminders } = require('./delivery');
const { withOwner, forEachUser, currentNumber } = require('../agent/context');

// Two registration helpers, because the jobs split into two kinds.
//
// Most are per-person work — briefs, nudges, reminder sweeps — and run once for every active
// user, each inside their own scope. Wrapping at registration leaves the job bodies untouched
// and makes it impossible to add one that forgets.
const scheduleForEachUser = (expr, fn, opts) =>
  cron.schedule(expr, () => forEachUser(fn).catch(err =>
    console.error('[Scheduler] job failed:', err.message)), opts);

// The rest are process-wide maintenance that must run exactly once no matter how many users
// there are. The queue drain is the sharp example: it already resolves and scopes each message's
// own sender, so fanning it out would run the same drain once per user.
const scheduleOnce = (expr, fn, opts) =>
  cron.schedule(expr, () => withOwner(fn).catch(err =>
    console.error('[Scheduler] job failed:', err.message)), opts);

function startScheduler() {
  // 9:00 AM IST — Morning brief (Morning Brief)
  scheduleForEachUser('0 9 * * 1-5', async () => {
    try {
      const standup = await generateStandup("generic");
      await sendMessage(currentNumber(), standup);
      await sendBriefPush('Morning Brief', 'Your day starts now. Tap to see context.');
    } catch (err) {
      console.error('Morning brief error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 6:00 PM IST — Evening Brief
  scheduleForEachUser('0 18 * * *', async () => {
    try {
      const standup = await generateStandup("generic");
      await sendMessage(currentNumber(), standup);
      // Follow up with a goal-setting nudge after the brief arrives
      setTimeout(async () => {
        await sendButtonMessage(currentNumber(), "What's the *One Big Thing* you want to move tonight?", [
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
  scheduleOnce('*/15 6-23 * * *', async () => {
    // 1. Process message queue. Once, not per user: processQueue resolves each message's own
    // sender and enters that scope itself.
    try {
      const { processQueue } = require('../agent/queueProcessor');
      await processQueue();
    } catch (err) {
      console.error('Queue processing error:', err.message);
    }

    // The reminder halves are per user, because their queries are scoped — a single pass would
    // only ever find the owner's due reminders.
    await forEachUser(async () => {
      // Catch-up only: anything already overdue (missed while the process was down). Anything
      // still in the future is delivered exactly on time by scheduler/timers.
      await sweepDueReminders();

      // Arm exact-time delivery for everything due before the next sweep.
      await timers.refresh();
    });
  }, { timezone: 'Asia/Kolkata' });

  // Midnight daily — run memory decay check + auto-summarise old notes (Item 8 & 13)
  scheduleForEachUser('0 0 * * *', async () => {
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
  scheduleForEachUser('0 9 * * 1-5', async () => {
    try {
      const alert = await generateStaleAlert();
      if (alert) {
        await sendButtonMessage(currentNumber(), alert, [
          { id: 'stale_snooze', title: 'Snooze 2 days' },
          { id: 'stale_dismiss', title: 'Dismiss' },
        ]);
      }
    } catch (err) {
      console.error('Stale alert error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // Sunday 8:00 PM IST — weekly review + conversation trim
  scheduleForEachUser('0 20 * * 0', async () => {
    try {
      await memory.trimConversations(200);
      const review = await generateWeeklyReview();
      await sendMessage(currentNumber(), review);
    } catch (err) {
      console.error('Weekly review error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 9:00 PM IST — proactive nudge
  scheduleForEachUser('0 21 * * *', async () => {
    try {
      const nudge = await generateProactiveNudge();
      if (nudge) {
        await sendMessage(currentNumber(), nudge);
        // Push a short version (notifications have limited space)
        await sendNudgePush(nudge.slice(0, 120));
      }
    } catch (err) {
      console.error('Proactive nudge error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 10:00 AM Sunday — Tech Twitter Pulse
  scheduleForEachUser('0 10 * * 0', async () => {
    try {
      const pulse = await generateTechPulse();
      if (pulse) await sendMessage(currentNumber(), pulse);
    } catch (err) {
      console.error('Tech Pulse error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 10:00 PM IST — late night goal nudge
  scheduleForEachUser('0 22 * * *', async () => {
    try {
      const pendingGoal = await memory.getPendingGoal();
      if (pendingGoal) {
        await sendMessage(currentNumber(), `Hermes checking in: How's progress on the **One Big Thing**? (*${pendingGoal.content}*). Almost there?`);
      }
    } catch (err) {
      console.error('Goal nudge error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // Arm timers for anything already due within the horizon, so a restart doesn't wait
  // for the first sweep. This one runs at boot rather than inside a job, so it needs the
  // scope established explicitly.
  forEachUser(() => timers.refresh())
    .catch(err => console.error('[Scheduler] initial timer refresh failed:', err.message));

  console.log('Scheduler started — morning brief (9am Mon-Fri), evening brief (6pm), reminder sweep (every 15min, 6am-midnight), Tech Pulse (Sun 10am), Weekly Review (Sun 8pm), Goal Nudge (10pm)');
}

module.exports = { startScheduler };
