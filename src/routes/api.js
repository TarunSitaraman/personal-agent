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

// Live health check — tests Gemini + each OpenRouter model
router.get('/llm-health', async (req, res) => {
  const results = {};
  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const probe = [{ role: 'user', content: 'Reply with the single word: OK' }];

  // Gemini
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const chat = model.startChat({ history: [] });
    const r = await Promise.race([
      chat.sendMessage('Reply with the single word: OK'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    results.gemini = { ok: true, reply: r.response.text().slice(0, 20) };
  } catch (e) {
    results.gemini = { ok: false, error: e.message?.slice(0, 80) };
  }

  // OpenRouter models
  const models = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemma-3-27b-it:free',
    'qwen/qwen3-30b-a3b:free',
    'deepseek/deepseek-r1-0528:free',
  ];
  await Promise.all(models.map(async m => {
    try {
      const r = await axios.post(OPENROUTER_URL, { model: m, messages: probe }, {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://personal-agent',
          'X-Title': 'Personal Agent',
        },
        timeout: 8000,
      });
      const content = r.data?.choices?.[0]?.message?.content;
      results[m] = { ok: !!content, reply: content?.slice(0, 20) };
    } catch (e) {
      results[m] = { ok: false, error: (e.response?.data?.error?.message || e.message)?.slice(0, 80) };
    }
  }));

  const anyOk = Object.values(results).some(r => r.ok);
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
