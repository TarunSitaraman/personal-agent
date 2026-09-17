require('dotenv').config();

// GET /api/health   → liveness, public
// GET /api/health?llm=1 → live probe of every configured LLM provider.
//                         Auth: Authorization: Bearer <dashboard_token>
//
// The LLM probe lives here rather than in its own api/llm-health.js because the Hobby plan caps a
// deployment at 12 Serverless Functions and this project is already at exactly 12 — a 13th fails
// the whole deploy with exceeded_serverless_functions_per_deployment.
//
// That 12 is not the number of files in api/: there are 11. vercel.json sets
// "framework": "express" and package.json's main is src/server.js, so Vercel builds the Express
// app as one more function on top of every api/*.js. 11 + 1 = 12, at the cap. Adding
// api/llm-health.js made it 12 + 1 = 13, which is the deploy that failed. Count the Express
// entrypoint before concluding there is headroom here.
module.exports = async (req, res) => {
  if (!req.query?.llm) return res.json({ status: 'ok' });

  // Header only — deliberately no ?token= fallback. Query strings are recorded in platform access
  // logs and proxy logs in a way Authorization headers are not, so accepting the dashboard token
  // there leaks a long-lived credential into log storage.
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  // Per-user dashboard token. No user data is read here, but the probe spends provider quota, so
  // it stays behind auth. (The Express twin at src/routes/api.js is unauthenticated, but that
  // path is not deployed — see CLAUDE.md.)
  const { getUserByDashboardToken } = require('../src/agent/memory');
  const user = await getUserByDashboardToken(token).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { probeAllProviders } = require('../src/agent/llmHealth');
  const { results, anyOk } = await probeAllProviders();
  return res.status(anyOk ? 200 : 503).json(results);
};
