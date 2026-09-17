require('dotenv').config();

// GET /api/health            → liveness, public
// GET /api/health?llm=1&token=… → live probe of every configured LLM provider
//
// The LLM probe lives here rather than in its own api/llm-health.js because the Hobby plan caps a
// deployment at 12 Serverless Functions and this project is already at exactly 12 — a 13th file
// fails the whole deploy with exceeded_serverless_functions_per_deployment.
module.exports = async (req, res) => {
  if (!req.query?.llm) return res.json({ status: 'ok' });

  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  // Per-user dashboard token, same as the Express router. No user data is read here, but the
  // probe spends provider quota, so it stays behind auth.
  const { getUserByDashboardToken } = require('../src/agent/memory');
  const user = await getUserByDashboardToken(token).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { probeAllProviders } = require('../src/agent/llmHealth');
  const { results, anyOk } = await probeAllProviders();
  return res.status(anyOk ? 200 : 503).json(results);
};
