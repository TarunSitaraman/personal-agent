const memory = require('./memory');
const { handleIncoming } = require('./brain');
const { sendMessage } = require('../whatsapp/send');
const { transcribeAudio } = require('../integrations/whisper');
const { analyzeImage } = require('../integrations/vision');
const hub = require('../events/hub');
const { handleButtonAction, parseInteractive } = require('../whatsapp/buttons');

async function processMessage(msgRow) {
  const { id, from_number, message_raw } = msgRow;
  const message = message_raw;
  
  try {
    let text = '';
    
    if (message.type === 'text') {
      text = message.text.body;
    } else if (message.type === 'audio') {
      const transcription = await transcribeAudio(message.audio.id);
      if (!transcription) {
        await sendMessage(from_number, "Couldn't transcribe the voice message. Try again or type it.");
        await memory.markMessageCompleted(id);
        return;
      }
      text = transcription;
    } else if (message.type === 'interactive') {
      const { buttonId, buttonTitle } = parseInteractive(message.interactive);
      if (!buttonId && !buttonTitle) {
        await memory.markMessageCompleted(id);
        return;
      }
      
      if (buttonId && await handleButtonAction(buttonId, from_number)) {
        await memory.markMessageCompleted(id);
        return;
      }
      text = buttonTitle || '';
    } else if (message.type === 'image') {
      const caption = message.image?.caption || '';
      const description = await analyzeImage(message.image.id, caption);
      if (!description) {
        await sendMessage(from_number, "Couldn't process the image. Try again.");
        await memory.markMessageCompleted(id);
        return;
      }
      text = `[Image received] ${description}${caption ? `\nCaption: ${caption}` : ''}`;
    } else {
      await memory.markMessageCompleted(id);
      return;
    }

    // Call LLM
    const reply = await handleIncoming(text, from_number);
    if (reply) {
      if (reply.includes("offline right now") || reply.includes("All my LLMs are down")) {
        const offlineReply = "I'm offline right now, I've saved your message and will process it when I'm back.";
        await sendMessage(from_number, offlineReply);
        throw new Error("All LLMs are offline");
      }
      
      await sendMessage(from_number, reply);
    }
    
    // Check if we can record token usage (we will inject metadata into processed fields if returned, handled during markMessageCompleted)
    await memory.markMessageCompleted(id);
    hub.notify();

    // A message may have just set a reminder for sooner than the next sweep — arm it now.
    require('../scheduler/timers').refresh();
  } catch (err) {
    console.error(`[QueueProcessor] Error processing message ${id}:`, err.message);
    await memory.markMessageFailed(id, err.message);
    
    // DLQ check
    const attempts = msgRow.attempts + 1;
    if (attempts >= 3) {
      try {
        const truncatedText = message.text?.body || message.type || 'unknown type';
        await sendMessage(
          from_number,
          `Sorry, I couldn't process your message "${truncatedText}". Please try again.`
        );
      } catch (sendErr) {
        console.error('[QueueProcessor] Failed to send DLQ message:', sendErr.message);
      }
    }
  }
}

async function processQueue() {
  const pending = await memory.getNextPendingMessages(5);
  if (!pending.length) return;
  
  console.log(`[QueueProcessor] Processing ${pending.length} pending messages...`);
  for (const row of pending) {
    await memory.markMessageProcessing(row.id);
    await processMessage(row);
  }
}

module.exports = { processQueue };
