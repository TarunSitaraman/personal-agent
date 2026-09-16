require('dotenv').config();
const { getUserByDashboardToken } = require('../src/agent/memory');
const { probeAllProviders } = require('../src/agent/llmHealth');

module.exports = async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  // Per-user dashboard token, same as the Express router. No user data is read here, but the
  // probe spends provider quota, so it stays behind auth.
  const user = await getUserByDashboardToken(token).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { results, anyOk } = await probeAllProviders();
  return res.status(anyOk ? 200 : 503).json(results);
};
