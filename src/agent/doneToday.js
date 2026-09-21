// Query parsing for GET /dashboard/api/done?since=… — how many todos were finished since the
// phone's local midnight. The phone sends its own midnight because "today" is the user's day,
// not the server's. Pure, so the rules are tested without a database; the count is
// memory.countCompletedSince.

const MAX_WINDOW_MS = 48 * 3600 * 1000; // generous for any timezone, still clearly "today"

function parseSince(query, now = new Date()) {
  const raw = query && query.since;
  if (typeof raw !== 'string' || !raw) return null;
  const d = new Date(raw);
  const t = d.getTime();
  if (Number.isNaN(t) || t > now.getTime() || now.getTime() - t > MAX_WINDOW_MS) return null;
  return d.toISOString();
}

module.exports = { parseSince, MAX_WINDOW_MS };
