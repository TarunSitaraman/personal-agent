require('dotenv').config();
const { forEachUser, currentNumber } = require('../../src/agent/context');
const { generateProactiveNudge } = require('../../src/agent/brain');
const { sendMessage } = require('../../src/whatsapp/send');
const { sendNudgePush } = require('../../src/push/push');

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
    const results = await forEachUser(run);
    res.json({ ok: true, results });
  } catch (err) {
    console.error('Nudge fan-out error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const run = async (user) => {
  const nudge = await generateProactiveNudge();
  if (!nudge) return `${user.wa_number}: nothing worth nudging about`;

  await sendMessage(currentNumber(), nudge);
  await sendNudgePush(nudge.slice(0, 120));
  return `${user.wa_number}: nudge sent`;
};
