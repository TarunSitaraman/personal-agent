require('dotenv').config();
// Called through the module object rather than destructured, so tests can substitute it — the
// same convention as src/whatsapp/buttons.js.
const brain = require('../src/agent/brain');
const { withDashboardUser } = require('../src/agent/dashboardAuth');

// Per-user token auth; the agent runs as the token holder. This endpoint executes arbitrary agent
// actions, so it must never be reachable anonymously. `run` is referenced lazily (defined below).
module.exports = withDashboardUser((req, res) => run(req, res));

const run = async (req, res) => {
  if (req.method !== 'POST') return res.sendStatus(405);

  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  try {
    const reply = await brain.handleIncoming(message.trim());
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
