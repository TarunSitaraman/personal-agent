const express = require('express');
const { handleIncoming } = require('../agent/brain');
const { sendMessage } = require('./send');
const { transcribeAudio } = require('../integrations/whisper');
const { analyzeImage } = require('../integrations/vision');
const hub = require('../events/hub');

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
      const transcription = await transcribeAudio(message.audio.id);
      if (!transcription) {
        await sendMessage(from, "Couldn't transcribe the voice message. Try again or type it.");
        return;
      }
      text = transcription;
    } else if (message.type === 'interactive') {
      const buttonReply = message.interactive?.button_reply;
      if (!buttonReply) return;
      text = buttonReply.title;
    } else if (message.type === 'image') {
      const caption = message.image?.caption || '';
      const description = await analyzeImage(message.image.id, caption);
      if (!description) {
        await sendMessage(from, "Couldn't process the image. Try again.");
        return;
      }
      text = `[Image received] ${description}${caption ? `\nCaption: ${caption}` : ''}`;
    } else {
      return;
    }

    const reply = await handleIncoming(text);
    if (reply) await sendMessage(from, reply);
    hub.notify();
  } catch (err) {
    console.error('Webhook error:', err.message);
    try { await sendMessage(process.env.MY_WHATSAPP_NUMBER, `Error: ${err.message}`); } catch {}
  }
});

module.exports = { router };
