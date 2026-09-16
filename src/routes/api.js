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

// Live health check — tests all configured LLM providers
router.get('/llm-health', async (req, res) => {
  const results = {};
  const probe = [{ role: 'user', content: 'Reply with only: OK' }];

  const tests = [];

  // Probe the live ladder rather than a hardcoded copy — the old list still named Groq and
  // OpenRouter models that were decommissioned, so this route reported outages that weren't real.
  const { MODEL_LADDERS } = require('../agent/brain');
  const OPENAI_COMPATIBLE = {
    groq:       { url: 'https://api.groq.com/openai/v1/chat/completions', headers: k => ({ Authorization: `Bearer ${k}` }) },
    nvidia:     { url: 'https://integrate.api.nvidia.com/v1/chat/completions', headers: k => ({ Authorization: `Bearer ${k}` }) },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', headers: k => ({ Authorization: `Bearer ${k}`, 'HTTP-Referer': 'https://personal-agent', 'X-Title': 'Personal Agent' }) },
  };

  for (const [provider, { key, models }] of Object.entries(MODEL_LADDERS)) {
    if (!process.env[key]) continue;
    for (const model of models) {
      tests.push(async () => {
        const label = `${provider}:${model}`;
        const start = Date.now();
        try {
          if (provider === 'gemini') {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(process.env[key]);
            const r = await Promise.race([
              genAI.getGenerativeModel({ model }).generateContent('Reply with only: OK'),
              new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
            ]);
            results[label] = { ok: true, ms: Date.now() - start, reply: r.response.text().trim().slice(0, 20) };
            return;
          }
          const { url, headers } = OPENAI_COMPATIBLE[provider];
          // gpt-oss reasons inside the completion: a 10-token budget is spent thinking and the
          // content comes back empty, which read as an outage. Mirror what callGroqModel sends.
          const body = { model, messages: probe, max_tokens: 256 };
          if (model.includes('gpt-oss')) body.reasoning_effort = 'low';
          const r = await axios.post(url, body, { headers: headers(process.env[key]), timeout: 8000 });
          if (r.data?.error) throw new Error(r.data.error.message);
          const content = r.data?.choices?.[0]?.message?.content;
          results[label] = { ok: !!content, ms: Date.now() - start, reply: content?.trim().slice(0, 20) };
        } catch (e) {
          results[label] = { ok: false, error: (e.response?.data?.error?.message || e.message)?.slice(0, 80) };
        }
      });
    }
  }

  results._env = Object.fromEntries(
    Object.entries(MODEL_LADDERS).map(([provider, { key }]) => [provider, !!process.env[key]])
  );

  await Promise.all(tests.map(t => t()));
  const anyOk = Object.entries(results).filter(([k]) => k !== '_env').some(([, v]) => v.ok);
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
