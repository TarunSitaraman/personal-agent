require('dotenv').config();
const { generateWeeklyReview } = require('../../src/agent/brain');
const { sendMessage } = require('../../src/whatsapp/send');
const memory = require('../../src/agent/memory');

function auth(req) {
  const secret = req.headers['authorization']?.replace('Bearer ', '') || req.query.secret;
  return secret === process.env.CRON_SECRET;
}

module.exports = async (req, res) => {
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await memory.trimConversations(200);
    const review = await generateWeeklyReview();
    await sendMessage(process.env.MY_WHATSAPP_NUMBER, review);
    res.json({ ok: true });
  } catch (err) {
    console.error('Weekly review error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
