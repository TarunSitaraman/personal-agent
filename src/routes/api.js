const express = require('express');
const axios = require('axios');
const { handleIncoming } = require('../agent/brain');
const { sendPush } = require('../push/push');
const { runAsUser } = require('../agent/context');
const memory = require('../agent/memory');
const { getUserByDashboardToken } = require('../agent/memory');

const router = express.Router();

// Resolve the authenticated user from the dashboard token query param.
// Each user has their own token stored in the database.
function tokenMiddleware(req, res, next) {
   const token = req.query.token;
   if (!token) return res.status(401).json({ error: 'Unauthorized' });
   getUserByDashboardToken(token).then(user => {
     if (!user) return res.status(401).json({ error: 'Unauthorized' });
     req.user = user;
     runAsUser(user, () => next());
   }).catch(next);
}

// Every route below reads or writes one person's data, so the whole router runs in scope.
router.use(tokenMiddleware);

// Public cron queue processing endpoint (Item 1)
router.post('/cron/process', async (req, res) => {
   const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token || req.headers['x-cron-secret'];
   const cronSecret = process.env.CRON_SECRET || '';
   if (cronSecret && token !== cronSecret && !req.user) {
     return res.status(401).json({ error: 'Unauthorized' });
   }
  
  try {
    const { processQueue } = require('../agent/queueProcessor');
    await processQueue();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full health dashboard endpoint (Item 6)
router.get('/health/full', async (req, res) => {
  const results = {
    db: false,
    llm: false,
    whatsapp: false,
    timestamp: new Date().toISOString()
  };
  
  // 1. DB check
  try {
    await memory.getMessageCount();
    results.db = true;
  } catch (dbErr) {
    results.db = { ok: false, error: dbErr.message };
  }
  
  // 2. LLM check (Gemini)
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite' });
    const r = await Promise.race([
      model.generateContent('Reply with only: OK'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ]);
    const text = r.response.text().trim();
    results.llm = text.includes('OK');
  } catch (llmErr) {
    results.llm = { ok: false, error: llmErr.message };
  }

  // 3. WhatsApp check
  try {
    const waRes = await axios.get('https://graph.facebook.com/v19.0', { timeout: 5000 });
    results.whatsapp = waRes.status === 200 || waRes.status === 400 || waRes.status === 401;
  } catch (waErr) {
    if (waErr.response) {
      results.whatsapp = true; // graph.facebook.com returned a response (even if 4xx/400 bad request), showing reachability
    } else {
      results.whatsapp = { ok: false, error: waErr.message };
    }
  }

  const allOk = results.db === true && results.llm === true && results.whatsapp === true;
  res.status(allOk ? 200 : 503).json(results);
});

// Simple bearer token auth — same token as the dashboard
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.use(auth);

// Register Expo push token from the device
router.post('/push/register', async (req, res) => {
  const { token } = req.body;
  if (!token || !token.startsWith('ExponentPushToken')) {
    return res.status(400).json({ error: 'Invalid Expo push token' });
  }
  await memory.savePushToken(token);
  res.json({ ok: true });
});

// Unregister (logout / uninstall)
router.delete('/push/register', async (req, res) => {
  const { token } = req.body;
  if (token) await memory.removePushToken(token);
  res.json({ ok: true });
});

// Get all pending todos grouped by context
router.get('/todos', async (req, res) => {
  try {
    const [pending] = await Promise.all([memory.getPendingTodos()]);
    res.json({ pending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Complete a todo by ID
router.post('/todos/:id/complete', async (req, res) => {
  try {
    await memory.completeTodo(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get upcoming events
router.get('/events', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const events = await memory.getUpcomingEvents(hours);
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send a message to Blu (replaces WhatsApp as the input channel)
router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });
    const reply = await handleIncoming(message.trim());
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live health check — tests all configured LLM providers.
// Shared with api/health.js?llm=1, which is the one production actually serves.
router.get('/llm-health', async (req, res) => {
  const { probeAllProviders } = require('../agent/llmHealth');
  const { results, anyOk } = await probeAllProviders();
  res.status(anyOk ? 200 : 503).json(results);
});

// Test push (dev only)
router.post('/push/test', async (req, res) => {
  try {
    await sendPush('Blu test', req.body.message || 'Push notifications working.', { type: 'test' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
