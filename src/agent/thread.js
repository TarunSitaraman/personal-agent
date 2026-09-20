// Query parsing for the app's chat thread (GET /dashboard/api/messages). Pure, so the paging
// rules are tested without a database. The query itself is memory.getThread.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseThreadQuery(query = {}) {
  const q = query || {};
  const n = parseInt(q.limit, 10);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;

  const d = q.before ? new Date(q.before) : null;
  const before = d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;

  return { before, limit };
}

module.exports = { parseThreadQuery, DEFAULT_LIMIT, MAX_LIMIT };
