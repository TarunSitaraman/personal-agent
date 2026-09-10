require('dotenv').config();
const { forEachUser } = require('../../src/agent/context');
const { sweepDueReminders } = require('../../src/scheduler/delivery');

function auth(req) {
  const secret = req.headers['authorization']?.replace('Bearer ', '') || req.query.secret;
  return secret === process.env.CRON_SECRET;
}

// Serverless can't hold timers, so the sweep is the only delivery path here and reminders land
// within one call interval rather than to the minute. Delivery itself lives in
// src/scheduler/delivery.js, shared with the always-on server.
//
// Dedup lives in the DB: the sweep's queries claim the rows they return, so this endpoint is
// safe to call at any interval and needs no in-process state. Call it every 15 min, not every
// minute — polling faster than the autosuspend window keeps the compute endpoint hot 24/7.

module.exports = async (req, res) => {
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });
  // Scope is entered only after auth, so an unauthenticated request never reaches the DB.
  // The sweep runs per user: its queries are scoped, so a single pass would only ever find the
  // owner's due reminders and everyone else's would sit unfired forever.
  try {
    const fired = await forEachUser(run);
    res.json({ ok: true, fired });
  } catch (err) {
    console.error('Reminder sweep fan-out error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const run = async () => sweepDueReminders();
