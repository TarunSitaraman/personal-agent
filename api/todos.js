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

      // TEMPORARY maintenance action — remove once the embedding backfill has run.
      // Lives here rather than in its own file because the Hobby plan caps a deployment at
      // 12 serverless functions and we are at the limit. Requires the token in the
      // Authorization header specifically (not the query string, which is logged), and only
      // touches rows whose embedding IS NULL, so it is idempotent.
      if (action === 'backfill_embeddings') {
        const header = req.headers.authorization?.replace('Bearer ', '');
        if (header !== process.env.DASHBOARD_TOKEN) {
          return res.status(401).json({ error: 'header auth required for this action' });
        }
        const { getEmbedding } = require('../src/agent/brain');
        const tables = [
          { name: 'todos', text: 'content' },
          { name: 'notes', text: 'content' },
          { name: 'knowledge', text: 'fact' },
          { name: 'learnings', text: "topic || ': ' || content" },
        ];
        const report = {};
        let total = 0;
        for (const t of tables) {
          const rows = await memory.rawQuery(
            `SELECT id, ${t.text} AS text FROM ${t.name} WHERE embedding IS NULL AND ${t.text} IS NOT NULL LIMIT 50`
          );
          let done = 0;
          for (const row of rows) {
            const values = await getEmbedding(row.text);
            if (!values) continue;
            await memory.rawQuery(`UPDATE ${t.name} SET embedding = $1 WHERE id = $2`,
              [`[${values.join(',')}]`, row.id]);
            done++;
          }
          const [{ remaining }] = await memory.rawQuery(
            `SELECT count(*)::int AS remaining FROM ${t.name} WHERE embedding IS NULL`);
          report[t.name] = { embedded: done, of: rows.length, remaining };
          total += done;
        }
        return res.json({ ok: true, total, report });
      }

      return res.status(400).json({ error: 'id and action required' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.sendStatus(405);
};
