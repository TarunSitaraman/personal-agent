const express = require('express');
const { handleIncoming } = require('../agent/brain');
const { sendMessage, sendButtonMessage } = require('./send');
const { transcribeAudio } = require('../integrations/whisper');
const { analyzeImage } = require('../integrations/vision');
const hub = require('../events/hub');
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

// Handle structured button IDs directly without going to the LLM.
// Returns true if the action was handled, false to fall through to LLM.
async function handleButtonAction(id, from) {
  try {
    // List picker selection: tap a todo to mark it done
    if (id.startsWith('ltdone_')) {
      const todoId = id.slice(7);
      await memory.completeTodo(todoId);
      await sendMessage(from, 'Done. Removed from your list.');
      hub.notify();
      return true;
    }

    // Todo reminder: Done — mark the specific todo complete by ID
    if (id.startsWith('rdone_')) {
      const todoId = id.slice(6);
      await memory.completeTodo(todoId);
      await sendMessage(from, 'Done. Removed from your list.');
      hub.notify();
      return true;
    }

    // Todo reminder: Snooze — update remind_at by N minutes
    if (id.startsWith('rsnooze_')) {
      const parts = id.split('_'); // rsnooze_60_<uuid>
      const mins = parseInt(parts[1]) || 60;
      const todoId = parts.slice(2).join('_');
      const remindAt = new Date(Date.now() + mins * 60 * 1000);
      await memory.updateTodoReminder(todoId, remindAt);
      await sendMessage(from, `Snoozed ${mins} min.`);
      return true;
    }

    // Event reminder: Noted — just acknowledge
    if (id.startsWith('evnoted_')) {
      await sendMessage(from, 'Good luck!');
      return true;
    }

    // Event reminder: Snooze — queue a new reminder in 15 min via todo system
    if (id.startsWith('evsnooze_')) {
      const eventId = id.slice(9);
      const ev = await memory.getEventById(eventId);
      const remindAt = new Date(Date.now() + 15 * 60 * 1000);
      if (ev) await memory.addTodo(`Upcoming: ${ev.title}`, ev.tags || [], remindAt);
      await sendMessage(from, "I'll remind you again in 15 minutes.");
      return true;
    }

    // Reminder follow-up: set tonight 9pm on the most recently added todo matching content
    if (id.startsWith('rem_tonight_')) {
      const keyword = id.slice('rem_tonight_'.length).replace(/_/g, ' ');
      const now = new Date();
      const remindAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0);
      if (remindAt <= now) remindAt.setDate(remindAt.getDate() + 1);
      await memory.setTodoReminderByContent(keyword, remindAt);
      await sendMessage(from, 'Reminder set for 9pm.');
      hub.notify();
      return true;
    }

    // Reminder follow-up: set tomorrow 8am
    if (id.startsWith('rem_tmrw_')) {
      const keyword = id.slice('rem_tmrw_'.length).replace(/_/g, ' ');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const remindAt = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 8, 0, 0);
      await memory.setTodoReminderByContent(keyword, remindAt);
      await sendMessage(from, 'Reminder set for tomorrow 8am.');
      hub.notify();
      return true;
    }

    // Reminder follow-up: skip / no reminder
    if (id === 'rem_no') {
      await sendMessage(from, 'Ok, no reminder.');
      return true;
    }

    // Stale todos: dismiss the alert
    if (id === 'stale_dismiss') {
      await sendMessage(from, 'Got it.');
      return true;
    }

    // Stale todos: snooze (legacy button without encoded ID — just acknowledge)
    if (id === 'stale_snooze') {
      await sendMessage(from, 'Noted — I\'ll check back in a couple of days.');
      return true;
    }

    // One Big Thing — skip
    if (id === 'obt_skip') {
      await sendMessage(from, 'No problem. Have a focused session.');
      return true;
    }
    // One Big Thing — set: prime LLM with a goal-setting prompt
    if (id === 'obt_set') {
      const reply = await handleIncoming('I want to set my One Big Thing for tonight', from);
      if (reply) await sendMessage(from, reply);
      hub.notify();
      return true;
    }

  } catch (err) {
    console.error('[Button] Handler error:', id, err.message);
  }
  return false;
}

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
