require('dotenv').config();
const { forEachUser, currentNumber } = require('../../src/agent/context');
const { generateWeeklyReview } = require('../../src/agent/brain');
const { sendMessage } = require('../../src/whatsapp/send');
const memory = require('../../src/agent/memory');
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
    console.error('Weekly review fan-out error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// With ?hourly=1, runs only at 8pm local, Sundays per user.tz (src/scheduler/briefTiming.js).
const run = async (user, query) => {
  const skip = localTimeSkip(query, user, 20, { sundayOnly: true });
  if (skip) return skip;

  await memory.trimConversations(200);
  const review = await generateWeeklyReview();
  await sendMessage(currentNumber(), review);
  return `${user.wa_number}: weekly review sent`;
};
