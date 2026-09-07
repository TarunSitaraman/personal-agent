require('dotenv').config();
const memory = require('../src/agent/memory');

function auth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  return token === process.env.DASHBOARD_TOKEN;
}

module.exports = async (req, res) => {
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    try {
      const [pending] = await Promise.all([memory.getPendingTodos()]);
      return res.json({ pending });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST /api/todos/:id/complete — Vercel doesn't support param routes in files,
  // so the mobile app should pass the ID in the body: { id, action: 'complete' }
  if (req.method === 'POST') {
    try {
      const { id, action } = req.body;
      if (action === 'complete' && id) {
        await memory.completeTodo(id);
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: 'id and action required' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.sendStatus(405);
};
