require('dotenv').config();
const { handleIncoming } = require('../src/agent/brain');
const { sendMessage, sendButtonMessage } = require('../src/whatsapp/send');
const { transcribeAudio } = require('../src/integrations/whisper');
const { analyzeImage } = require('../src/integrations/vision');
const memory = require('../src/agent/memory');

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

async function handleButtonAction(id, from) {
  try {
    if (id.startsWith('ltdone_')) {
      await memory.completeTodo(id.slice(7));
      await sendMessage(from, 'Done. Removed from your list.');
      return true;
    }
    if (id.startsWith('rdone_')) {
      await memory.completeTodo(id.slice(6));
      await sendMessage(from, 'Done. Removed from your list.');
      return true;
    }
    if (id.startsWith('rsnooze_')) {
      const parts = id.split('_');
      const mins = parseInt(parts[1]) || 60;
      const todoId = parts.slice(2).join('_');
      await memory.updateTodoReminder(todoId, new Date(Date.now() + mins * 60 * 1000));
      await sendMessage(from, `Snoozed ${mins} min.`);
      return true;
    }
    if (id.startsWith('evnoted_')) {
      await sendMessage(from, 'Good luck!');
      return true;
    }
    if (id.startsWith('evsnooze_')) {
      const ev = await memory.getEventById(id.slice(9));
      if (ev) await memory.addTodo(`Upcoming: ${ev.title}`, ev.tags || [], new Date(Date.now() + 15 * 60 * 1000));
      await sendMessage(from, "I'll remind you again in 15 minutes.");
      return true;
    }
    if (id.startsWith('rem_tonight_')) {
      const keyword = id.slice('rem_tonight_'.length).replace(/_/g, ' ');
      const now = new Date();
      const remindAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0);
      if (remindAt <= now) remindAt.setDate(remindAt.getDate() + 1);
      await memory.setTodoReminderByContent(keyword, remindAt);
      await sendMessage(from, 'Reminder set for 9pm.');
      return true;
    }
    if (id.startsWith('rem_tmrw_')) {
      const keyword = id.slice('rem_tmrw_'.length).replace(/_/g, ' ');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await memory.setTodoReminderByContent(keyword, new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 8, 0, 0));
      await sendMessage(from, 'Reminder set for tomorrow 8am.');
      return true;
    }
    if (id === 'rem_no')       { await sendMessage(from, 'Ok, no reminder.'); return true; }
    if (id === 'stale_dismiss') { await sendMessage(from, 'Got it.'); return true; }
    if (id === 'stale_snooze')  { await sendMessage(from, "I'll check back in a couple of days."); return true; }
    if (id === 'obt_skip')      { await sendMessage(from, 'No problem. Have a focused session.'); return true; }
    if (id === 'obt_set') {
      const reply = await handleIncoming('I want to set my One Big Thing for tonight', from);
      if (reply) await sendMessage(from, reply);
      return true;
    }
  } catch (err) {
    console.error('[Button] Handler error:', id, err.message);
  }
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
    if (from !== process.env.MY_WHATSAPP_NUMBER) return res.status(200).end();

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
      const interactive = message.interactive;
      let buttonId, buttonTitle;
      if (interactive?.type === 'button_reply') {
        buttonId = interactive.button_reply?.id;
        buttonTitle = interactive.button_reply?.title;
      } else if (interactive?.type === 'list_reply') {
        buttonId = interactive.list_reply?.id;
        buttonTitle = interactive.list_reply?.title;
      } else {
        buttonId = interactive?.button_reply?.id;
        buttonTitle = interactive?.button_reply?.title;
      }
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
  } catch (err) {
    console.error('Webhook error:', err.message);
    // Never echo raw exception text to WhatsApp — upstream failures (DB quota, provider
    // outages) leak infrastructure detail and spam the chat on every retry.
    try { await sendMessage(process.env.MY_WHATSAPP_NUMBER, 'Something went wrong on my end. It\'s logged — try again in a bit.'); } catch {}
    res.status(200).end(); // always 200 to WhatsApp
  }
};
