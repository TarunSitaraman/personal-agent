require('dotenv').config();
const { generateStandup, generateStaleAlert } = require('../../src/agent/brain');
const { sendMessage, sendButtonMessage } = require('../../src/whatsapp/send');
const { sendBriefPush } = require('../../src/push/push');

function auth(req) {
  const secret = req.headers['authorization']?.replace('Bearer ', '') || req.query.secret;
  return secret === process.env.CRON_SECRET;
}

module.exports = async (req, res) => {
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const myNumber = process.env.MY_WHATSAPP_NUMBER;
  const results = [];

  try {
    const standup = await generateStandup("generic");
    await sendMessage(myNumber, standup);
    await sendBriefPush('Morning Brief', 'Your day starts now. Tap to see context.');
    results.push('morning brief sent');
  } catch (err) {
    console.error('Morning brief error:', err.message);
    results.push(`morning brief failed: ${err.message}`);
  }

  try {
    const alert = await generateStaleAlert();
    if (alert) {
      await sendButtonMessage(myNumber, alert, [
        { id: 'stale_snooze', title: 'Snooze 2 days' },
        { id: 'stale_dismiss', title: 'Dismiss' },
      ]);
      results.push('stale alert sent');
    }
  } catch (err) {
    console.error('Stale alert error:', err.message);
    results.push(`stale alert failed: ${err.message}`);
  }

  res.json({ ok: true, results });
};
