require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { router: webhookRouter } = require('./whatsapp/webhook');
const { startScheduler } = require('./scheduler/briefs');
const dashboardRouter = require('./routes/dashboard');
const apiRouter = require('./routes/api');
const { jsonExceptUploads } = require('./jsonBody');
const { makeAuthRouter } = require('./routes/auth');
const memory = require('./agent/memory');
const { isAllowed } = require('./agent/registration');
const { runAsUser } = require('./agent/context');
const { deliver } = require('./scheduler/delivery');

const app = express();
app.use(express.static('public'));
app.use(jsonExceptUploads()); // voice and image uploads bring their own larger limit
app.use('/webhook', webhookRouter);
// Sign-in with number + PIN: outside /dashboard, whose every route requires the token this returns.
app.use('/auth', makeAuthRouter({ memory, isAllowed, runAsUser, deliver }));
app.use('/dashboard', dashboardRouter);
app.use('/api', apiRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Personal agent running on port ${PORT}`);
  startScheduler();

  // Keep Render free tier awake — ping self every 4 minutes
  const selfUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
  if (selfUrl) {
    console.log(`Keep-alive ping active → ${selfUrl}/health`);
    setInterval(() => {
      axios.get(`${selfUrl}/health`).catch(err => console.warn('[keep-alive] ping failed:', err.message));
    }, 4 * 60 * 1000);
  } else {
    console.warn('Keep-alive disabled — set RENDER_EXTERNAL_URL or APP_URL env var');
  }
});
