require('dotenv').config();
const { handleIncoming } = require('../src/agent/brain');
const { initContext } = require('../src/agent/context');

function auth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  return token === process.env.DASHBOARD_TOKEN;
}

module.exports = async (req, res) => {
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.sendStatus(405);

  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  try {
    await initContext();
    const reply = await handleIncoming(message.trim());
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
