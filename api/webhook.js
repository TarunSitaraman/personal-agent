require('dotenv').config();
const { handleIncoming } = require('../src/agent/brain');
const { sendMessage } = require('../src/whatsapp/send');
const { transcribeAudio } = require('../src/integrations/whisper');
const { analyzeImage } = require('../src/integrations/vision');
const { handleButtonAction, parseInteractive } = require('../src/whatsapp/buttons');
const memory = require('../src/agent/memory');
const { runAsUser } = require('../src/agent/context');

// Dedup cache — WhatsApp retries if it doesn't get 200 quickly enough
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

module.exports = async (req, res) => {
  // Webhook verification (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  if (req.method !== 'POST') return res.status(405).end();

  // Process the message synchronously — Vercel terminates after res.send()
  // maxDuration: 60 gives us enough headroom for LLM calls
  try {

    const entry   = req.body?.entry?.[0];
    const change  = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) return res.status(200).end();
    if (isDuplicate(message.id)) return res.status(200).end();

    const from = message.from;
    // The sender is looked up rather than compared against a single number — this is the seam
    // multi-user opens through. Until registration lands, only a known, active user passes.
    const user = await memory.getUserByNumber(from);
    if (!user || !user.active) return res.status(200).end();

    // `await` is load-bearing: returning the promise unawaited would let a rejection escape
    // the catch below, and WhatsApp would get silence instead of the apology message.
    return await runAsUser(user, async () => {
      let text = '';

      if (message.type === 'text') {
        text = message.text.body;
      } else if (message.type === 'audio') {
        const transcription = await transcribeAudio(message.audio.id);
        if (!transcription) {
          await sendMessage(from, "Couldn't transcribe the voice message. Try again or type it.");
          return res.status(200).end();
        }
        text = transcription;
      } else if (message.type === 'interactive') {
        const { buttonId, buttonTitle } = parseInteractive(message.interactive);
        if (!buttonId && !buttonTitle) return res.status(200).end();
        if (buttonId && await handleButtonAction(buttonId, from)) return res.status(200).end();
        text = buttonTitle || '';
      } else if (message.type === 'image') {
        const caption = message.image?.caption || '';
        const description = await analyzeImage(message.image.id, caption);
        if (!description) {
          await sendMessage(from, "Couldn't process the image. Try again.");
          return res.status(200).end();
        }
        text = `[Image received] ${description}${caption ? `\nCaption: ${caption}` : ''}`;
      } else {
        return res.status(200).end();
      }

      const reply = await handleIncoming(text, from);
      if (reply) await sendMessage(from, reply);

      res.status(200).end();
    });
  } catch (err) {
    console.error('Webhook error:', err.message);
    // Never echo raw exception text to WhatsApp — upstream failures (DB quota, provider
    // outages) leak infrastructure detail and spam the chat on every retry.
    try { await sendMessage(process.env.MY_WHATSAPP_NUMBER, 'Something went wrong on my end. It\'s logged — try again in a bit.'); } catch {}
    res.status(200).end(); // always 200 to WhatsApp
  }
};
