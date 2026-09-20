require('dotenv').config();
const { forEachUser } = require('../../src/agent/context');
const { generateStandup, generateStaleAlert } = require('../../src/agent/brain');
const { deliver } = require('../../src/scheduler/delivery');
const { localTimeSkip } = require('../../src/scheduler/briefTiming');

function auth(req) {
  const secret = req.headers['authorization']?.replace('Bearer ', '') || req.query.secret;
  return secret === process.env.CRON_SECRET;
}

module.exports = async (req, res) => {
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });
  // Scope is entered only after auth, so an unauthenticated request never reaches the DB.
  // One pass per active user, each in its own scope. forEachUser logs and skips a user
  // who fails, so one broken account cannot cost everyone else their brief.
  try {
    const results = await forEachUser(user => run(user, req.query));
    res.json({ ok: true, results });
  } catch (err) {
    console.error('Morning brief fan-out error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// With ?hourly=1, runs only at 9am local, Mon-Fri per user.tz (src/scheduler/briefTiming.js).
const run = async (user, query) => {
  const skip = localTimeSkip(query, user, 9, { weekdaysOnly: true });
  if (skip) return skip;

  const results = [];

  try {
    const standup = await generateStandup("generic");
    const channel = await deliver({ kind: 'brief', text: standup });
    results.push(`${user.wa_number}: morning brief → ${channel}`);
  } catch (err) {
    console.error('Morning brief error:', err.message);
    results.push(`${user.wa_number}: morning brief failed: ${err.message}`);
  }

  try {
    const alert = await generateStaleAlert();
    if (alert) {
      const channel = await deliver({
        kind: 'nudge', title: 'Stale todos', text: alert,
        whatsapp: { text: alert, buttons: [
          { id: 'stale_snooze', title: 'Snooze 2 days' },
          { id: 'stale_dismiss', title: 'Dismiss' },
        ] },
      });
      results.push(`${user.wa_number}: stale alert → ${channel}`);
    }
  } catch (err) {
    console.error('Stale alert error:', err.message);
    results.push(`${user.wa_number}: stale alert failed: ${err.message}`);
  }

  return results;
};
