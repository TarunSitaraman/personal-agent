require('dotenv').config();
const { generateTechPulse } = require('../../src/agent/brain');
const { sendMessage } = require('../../src/whatsapp/send');

function auth(req) {
  const secret = req.headers['authorization']?.replace('Bearer ', '') || req.query.secret;
  return secret === process.env.CRON_SECRET;
}

module.exports = async (req, res) => {
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const pulse = await generateTechPulse();
    if (pulse) await sendMessage(process.env.MY_WHATSAPP_NUMBER, pulse);
    res.json({ ok: true, sent: !!pulse });
  } catch (err) {
    console.error('Tech Pulse error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
