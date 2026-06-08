const express = require('express');
const axios = require('axios');
const memory = require('../agent/memory');
const { handleIncoming } = require('../agent/brain');
const { sendPush } = require('../push/push');

const router = express.Router();

// Simple bearer token auth — same token as the dashboard
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (token !== process.env.DASHBOARD_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
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
    const [hex, srq, personal] = await Promise.all([
      memory.getPendingTodos('hexaware'),
      memory.getPendingTodos('smartresq'),
      memory.getPendingTodos('personal'),
    ]);
    res.json({ hexaware: hex, smartresq: srq, personal });
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

  // Groq
  if (process.env.GROQ_API_KEY) {
    for (const model of ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']) {
      tests.push(async () => {
        const start = Date.now();
        try {
          const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
            { model, messages: probe, max_tokens: 10 },
            { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, timeout: 8000 }
          );
          const content = r.data?.choices?.[0]?.message?.content;
          results[`groq:${model}`] = { ok: !!content, ms: Date.now() - start, reply: content?.slice(0, 20) };
        } catch (e) {
          results[`groq:${model}`] = { ok: false, error: (e.response?.data?.error?.message || e.message)?.slice(0, 80) };
        }
      });
    }
  }

  // OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    tests.push(async () => {
      const m = 'meta-llama/llama-3.3-70b-instruct:free';
      const start = Date.now();
      try {
        const r = await axios.post('https://openrouter.ai/api/v1/chat/completions',
          { model: m, messages: probe, max_tokens: 10 },
          { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'HTTP-Referer': 'https://personal-agent', 'X-Title': 'Personal Agent' }, timeout: 8000 }
        );
        const content = r.data?.choices?.[0]?.message?.content;
        results[`or:${m}`] = { ok: !!content, ms: Date.now() - start };
      } catch (e) {
        results[`or:${m}`] = { ok: false, error: (e.response?.data?.error?.message || e.message)?.slice(0, 80) };
      }
    });
  }

  // Gemini
  if (process.env.GEMINI_API_KEY) {
    tests.push(async () => {
      try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const start = Date.now();
        const r = await Promise.race([
          model.generateContent('Reply with only: OK'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
        ]);
        results['gemini:2.0-flash'] = { ok: true, ms: Date.now() - start, reply: r.response.text().slice(0, 20) };
      } catch (e) {
        results['gemini:2.0-flash'] = { ok: false, error: e.message?.slice(0, 80) };
      }
    });
  }

  results._env = {
    groq: !!process.env.GROQ_API_KEY,
    openrouter: !!process.env.OPENROUTER_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
  };

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
