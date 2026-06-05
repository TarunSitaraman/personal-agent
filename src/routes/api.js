const express = require('express');
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
