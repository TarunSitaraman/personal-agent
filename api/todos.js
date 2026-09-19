require('dotenv').config();
const memory = require('../src/agent/memory');
const { withDashboardUser } = require('../src/agent/dashboardAuth');

// Per-user token auth; the handler runs inside the token holder's scope, so an unauthenticated
// request never reaches the DB. `run` is referenced lazily because it is defined below.
module.exports = withDashboardUser((req, res) => run(req, res));

const run = async (req, res) => {

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
