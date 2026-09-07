require('dotenv').config();
const memory = require('../../src/agent/memory');
const { sendMessage } = require('../../src/whatsapp/send');

function auth(req) {
  const secret = req.headers['authorization']?.replace('Bearer ', '') || req.query.secret;
  return secret === process.env.CRON_SECRET;
}

module.exports = async (req, res) => {
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const pendingGoal = await memory.getPendingGoal();
    if (pendingGoal) {
      await sendMessage(
        process.env.MY_WHATSAPP_NUMBER,
        `Hermes checking in: How's progress on the *One Big Thing*? (*${pendingGoal.content}*). Almost there?`
      );
    }
    res.json({ ok: true, hasGoal: !!pendingGoal });
  } catch (err) {
    console.error('Goal nudge error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
