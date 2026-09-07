const express = require('express');
const { transcribeAudio } = require('../integrations/whisper');
const { analyzeImage } = require('../integrations/vision');
const memory = require('../agent/memory');

const router = express.Router();

// In-memory log of last 10 webhook hits for diagnostics
const webhookLog = [];
function logHit(entry) {
  webhookLog.unshift({ t: new Date().toISOString(), ...entry });
  if (webhookLog.length > 10) webhookLog.pop();
}

// Dedup cache — WhatsApp retries webhook delivery if it doesn't get 200 fast enough.
// We respond 200 immediately but process async, so retries can arrive and double-process.
const seenIds = new Map();
function isDuplicate(msgId) {
  const now = Date.now();
  for (const [id, ts] of seenIds) {
    if (now - ts > 60_000) seenIds.delete(id);
  }
  if (seenIds.has(msgId)) return true;
  seenIds.set(msgId, now);
  return false;
}

// Button taps are handled downstream by the queue processor (src/whatsapp/buttons.js) — this
// route only enqueues, so nothing here inspects the payload beyond routing it.

router.get('/log', (req, res) => {
  res.json(webhookLog);
});

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

const { processQueue } = require('../agent/queueProcessor');

router.post('/', async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    logHit({ hasMessage: !!message, from: message?.from, type: message?.type });

    if (!message) return;

    const from = message.from;
    if (from !== process.env.MY_WHATSAPP_NUMBER) {
      logHit({ filtered: true, from, expected: process.env.MY_WHATSAPP_NUMBER });
      return;
    }

    // 5. Dedup via DB
    const isDup = await memory.isDuplicateRequest(message.id);
    if (isDup) {
      console.warn(`[Webhook] Duplicate message ${message.id} — skipping`);
      return;
    }

    // 1. Store in queue table
    await memory.queueIncomingMessage(message.id, from, message);

    // Kick off immediate processing in background (non-blocking)
    processQueue().catch(err => console.error('[Webhook] Immediate process queue error:', err.message));

  } catch (err) {
    console.error('Webhook receive error:', err.message);
  }
});

module.exports = { router };
