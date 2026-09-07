require('dotenv').config();
const { generateProactiveNudge } = require('../../src/agent/brain');
const { sendMessage } = require('../../src/whatsapp/send');
const { sendNudgePush } = require('../../src/push/push');

function auth(req) {
  const secret = req.headers['authorization']?.replace('Bearer ', '') || req.query.secret;
  return secret === process.env.CRON_SECRET;
}

module.exports = async (req, res) => {
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const nudge = await generateProactiveNudge();
    if (nudge) {
      await sendMessage(process.env.MY_WHATSAPP_NUMBER, nudge);
      await sendNudgePush(nudge.slice(0, 120));
    }
    res.json({ ok: true, sent: !!nudge });
  } catch (err) {
    console.error('Nudge error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
