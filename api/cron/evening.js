require('dotenv').config();
const { generateStandup } = require('../../src/agent/brain');
const { sendMessage, sendButtonMessage } = require('../../src/whatsapp/send');

function auth(req) {
  const secret = req.headers['authorization']?.replace('Bearer ', '') || req.query.secret;
  return secret === process.env.CRON_SECRET;
}

module.exports = async (req, res) => {
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const myNumber = process.env.MY_WHATSAPP_NUMBER;

  try {
    const standup = await generateStandup('smartresq');
    await sendMessage(myNumber, standup);
    await sendButtonMessage(myNumber, "What's the *One Big Thing* you want to move tonight?", [
      { id: 'obt_set', title: 'Set it now' },
      { id: 'obt_skip', title: 'Skip tonight' },
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Evening brief error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
