const express = require('express');
const { handleIncoming } = require('../agent/brain');
const { sendMessage } = require('./send');

const router = express.Router();

// Webhook verification (Meta handshake)
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Incoming messages
router.post('/', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) return;

    const from = message.from;
    const myNumber = process.env.MY_WHATSAPP_NUMBER;

    // Only respond to Tarun's number
    if (from !== myNumber) return;

    let text = '';
    if (message.type === 'text') {
      text = message.text.body;
    } else if (message.type === 'audio') {
      text = '[Voice message received — voice transcription not yet implemented]';
    } else {
      return;
    }

    const reply = await handleIncoming(text);
    await sendMessage(from, reply);
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

module.exports = { router };
