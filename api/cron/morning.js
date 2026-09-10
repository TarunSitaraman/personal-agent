require('dotenv').config();
const { forEachUser, currentNumber } = require('../../src/agent/context');
const { generateStandup, generateStaleAlert } = require('../../src/agent/brain');
const { sendMessage, sendButtonMessage } = require('../../src/whatsapp/send');
const { sendBriefPush } = require('../../src/push/push');

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
    console.error('Morning brief fan-out error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const run = async (user) => {
  const myNumber = currentNumber();
  const results = [];

  try {
    const standup = await generateStandup("generic");
    await sendMessage(myNumber, standup);
    await sendBriefPush('Morning Brief', 'Your day starts now. Tap to see context.');
    results.push(`${user.wa_number}: morning brief sent`);
  } catch (err) {
    console.error('Morning brief error:', err.message);
    results.push(`${user.wa_number}: morning brief failed: ${err.message}`);
  }

  try {
    const alert = await generateStaleAlert();
    if (alert) {
      await sendButtonMessage(myNumber, alert, [
        { id: 'stale_snooze', title: 'Snooze 2 days' },
        { id: 'stale_dismiss', title: 'Dismiss' },
      ]);
      results.push(`${user.wa_number}: stale alert sent`);
    }
  } catch (err) {
    console.error('Stale alert error:', err.message);
    results.push(`${user.wa_number}: stale alert failed: ${err.message}`);
  }

  return results;
};
