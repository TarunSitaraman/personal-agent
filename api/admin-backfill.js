// TEMPORARY maintenance endpoint — remove after the embedding backfill has run.
//
// Exists because the developer machine's network blocks outbound Postgres ports, so the
// backfill cannot be run locally. Vercel can reach both the database and the Gemini API.
//
// Only fills rows whose embedding IS NULL, so it is idempotent and cannot overwrite data.
require('dotenv').config();
const crypto = require('crypto');
const memory = require('../src/agent/memory');
const { getEmbedding } = require('../src/agent/brain');

// Header only — a token in the query string is recorded in request logs, and this one also
// guards /api/todos. Constant-time compare so the check cannot be timed.
function authorised(req) {
  const supplied = req.headers.authorization?.replace('Bearer ', '') || '';
  const expected = process.env.DASHBOARD_TOKEN || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && expected.length > 0 && crypto.timingSafeEqual(a, b);
}

const TABLES = [
  { name: 'todos', text: 'content' },
  { name: 'notes', text: 'content' },
  { name: 'knowledge', text: 'fact' },
  { name: 'learnings', text: "topic || ': ' || content" },
];

module.exports = async (req, res) => {
  if (!authorised(req)) return res.status(401).json({ error: 'Unauthorized' });

  const report = {};
  let total = 0;

  try {
    for (const t of TABLES) {
      const rows = await memory.rawQuery(
        `SELECT id, ${t.text} AS text FROM ${t.name} WHERE embedding IS NULL AND ${t.text} IS NOT NULL LIMIT 100`
      );
      let done = 0;
      for (const row of rows) {
        const values = await getEmbedding(row.text);
        if (!values) continue;
        await memory.rawQuery(
          `UPDATE ${t.name} SET embedding = $1 WHERE id = $2`,
          [`[${values.join(',')}]`, row.id]
        );
        done++;
      }
      const [{ remaining }] = await memory.rawQuery(
        `SELECT count(*)::int AS remaining FROM ${t.name} WHERE embedding IS NULL`
      );
      report[t.name] = { embedded: done, of: rows.length, remaining };
      total += done;
    }
    res.json({ ok: true, total, report });
  } catch (err) {
    console.error('[admin-backfill]', err.message);
    res.status(500).json({ error: err.message });
  }
};
