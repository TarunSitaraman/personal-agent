require('dotenv').config();
const { forEachUser, currentNumber } = require('../../src/agent/context');
const { generateTechPulse } = require('../../src/agent/brain');
const { sendMessage } = require('../../src/whatsapp/send');

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
    console.error('Tech Pulse fan-out error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const run = async (user) => {
  const pulse = await generateTechPulse();
  if (!pulse) return `${user.wa_number}: no pulse today`;

  await sendMessage(currentNumber(), pulse);
  return `${user.wa_number}: pulse sent`;
};
