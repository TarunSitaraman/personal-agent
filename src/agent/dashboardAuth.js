// Per-user dashboard-token auth for the Vercel data endpoints (api/todos.js, api/chat.js).
//
// Lives in src/ rather than api/ because every .js file under api/ is deployed as its own
// Serverless Function, and the Hobby plan's 12-function cap is already reached — see api/health.js.
//
// Replaces a check that compared the request token against the retired shared DASHBOARD_TOKEN.
// Production no longer sets that variable, so a request with no token compared
// undefined === undefined and was let in: GET /api/todos served the owner's todos to anyone, and
// /api/chat ran the whole agent as the owner. The rule here is that a missing token is a
// rejection, decided before any lookup, and a present one must belong to an active user.

const memory = require('./memory');
const { runAsUser } = require('./context');

function tokenFrom(req) {
  const header = req.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return token;
  }
  // Query-string fallback kept for the current mobile app, which sends ?token= on its data paths
  // (mobile/api.js). Query strings are recorded in access logs, so the app should move to the
  // Authorization header — api/health.js already accepts the header only.
  const query = req.query?.token;
  return typeof query === 'string' && query ? query : null;
}

// Wraps a handler so it runs only for an authenticated user, inside that user's scope.
function withDashboardUser(handler) {
  return async (req, res) => {
    const token = tokenFrom(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const user = await memory.getUserByDashboardToken(token).catch(() => null);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    return runAsUser(user, () => handler(req, res));
  };
}

module.exports = { withDashboardUser, tokenFrom };
