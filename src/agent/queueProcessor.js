const memory = require('./memory');
const { handleIncoming } = require('./brain');
const { sendMessage } = require('../whatsapp/send');
const { transcribeAudio } = require('../integrations/whisper');
const { analyzeImage } = require('../integrations/vision');
const hub = require('../events/hub');

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
      if (ev) await memory.addTodo(`Upcoming: ${ev.title}`, ev.context || 'personal', remindAt);
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
