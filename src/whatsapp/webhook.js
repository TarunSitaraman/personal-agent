const express = require('express');
const { handleIncoming } = require('../agent/brain');
const { sendMessage } = require('./send');
const { transcribeAudio } = require('../integrations/whisper');

const router = express.Router();

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

router.post('/', async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) return;

    const from = message.from;
    if (from !== process.env.MY_WHATSAPP_NUMBER) return;

    let text = '';

    if (message.type === 'text') {
      text = message.text.body;
    } else if (message.type === 'audio') {
      const mediaId = message.audio.id;
      const transcription = await transcribeAudio(mediaId);
      if (!transcription) {
        await sendMessage(from, "Couldn't transcribe the voice message. Try again or type it.");
        return;
      }
      text = transcription;
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
