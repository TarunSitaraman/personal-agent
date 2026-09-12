require('dotenv').config();
const { forEachUser, currentNumber } = require('../../src/agent/context');
const { generateStandup } = require('../../src/agent/brain');
const { sendMessage, sendButtonMessage } = require('../../src/whatsapp/send');
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
    console.error('Evening brief fan-out error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// With ?hourly=1, runs only at 6pm local per user.tz (src/scheduler/briefTiming.js).
const run = async (user, query) => {
  const skip = localTimeSkip(query, user, 18);
  if (skip) return skip;

  const myNumber = currentNumber();

  const standup = await generateStandup('smartresq');
  await sendMessage(myNumber, standup);
  await sendButtonMessage(myNumber, "What's the *One Big Thing* you want to move tonight?", [
    { id: 'obt_set', title: 'Set it now' },
    { id: 'obt_skip', title: 'Skip tonight' },
  ]);
  return `${user.wa_number}: evening brief sent`;
};
