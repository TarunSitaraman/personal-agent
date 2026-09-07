// Inbound WhatsApp button/list handling — the mirror of scheduler/delivery.js.
//
// delivery.js emits the button ids; this parses them back and runs the action, without spending
// an LLM call on a tap the user already made unambiguous. The two files have to agree on the id
// format, so they are tested against each other in test/delivery.test.js and test/buttons.test.js.
//
// This used to exist in three copies (src/whatsapp/webhook.js, src/agent/queueProcessor.js,
// api/webhook.js) and had already drifted: the serverless copy had lost the "Noted — " prefix on
// stale_snooze and never fired hub.notify(), so the live dashboard sat stale after a tap.
//
// hub.notify() pushes an SSE refresh to any connected dashboard. On serverless the client set is
// always empty, so the call is a harmless no-op there and both platforms can share this code.

// Called through the module objects rather than destructured, so tests can substitute them with
// node:test's mock.method — a destructured reference is captured at load and cannot be replaced.
const memory = require('../agent/memory');
const send = require('./send');
const hub = require('../events/hub');

// Parsed here rather than inline so the id format lives in one place.
// Format: rsnooze_<minutes>_<uuid>, where the uuid itself may contain underscores.
function parseSnooze(id) {
  const parts = id.split('_');
  return {
    mins: parseInt(parts[1], 10) || 60,
    todoId: parts.slice(2).join('_'),
  };
}

// Keyword ids encode the todo content with underscores standing in for spaces.
function decodeKeyword(id, prefix) {
  return id.slice(prefix.length).replace(/_/g, ' ');
}

function at(date, hour) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0);
}

// Returns true if the tap was fully handled, false to fall through to the LLM.
async function handleButtonAction(id, from) {
  try {
    // List picker selection: tap a todo to mark it done
    if (id.startsWith('ltdone_')) {
      await memory.completeTodo(id.slice('ltdone_'.length));
      await send.sendMessage(from, 'Done. Removed from your list.');
      hub.notify();
      return true;
    }

    // Todo reminder: Done — mark the specific todo complete by ID
    if (id.startsWith('rdone_')) {
      await memory.completeTodo(id.slice('rdone_'.length));
      await send.sendMessage(from, 'Done. Removed from your list.');
      hub.notify();
      return true;
    }

    // Todo reminder: Snooze — push remind_at out by N minutes
    if (id.startsWith('rsnooze_')) {
      const { mins, todoId } = parseSnooze(id);
      await memory.updateTodoReminder(todoId, new Date(Date.now() + mins * 60 * 1000));
      await send.sendMessage(from, `Snoozed ${mins} min.`);
      return true;
    }

    // Event reminder: Noted — just acknowledge
    if (id.startsWith('evnoted_')) {
      await send.sendMessage(from, 'Good luck!');
      return true;
    }

    // Event reminder: Snooze — re-queue as a todo reminder 15 min out
    if (id.startsWith('evsnooze_')) {
      const ev = await memory.getEventById(id.slice('evsnooze_'.length));
      if (ev) {
        await memory.addTodo(`Upcoming: ${ev.title}`, ev.tags || [], new Date(Date.now() + 15 * 60 * 1000));
      }
      await send.sendMessage(from, "I'll remind you again in 15 minutes.");
      return true;
    }

    // Reminder follow-up: tonight 9pm, rolling to tomorrow if 9pm has already passed
    if (id.startsWith('rem_tonight_')) {
      const now = new Date();
      const remindAt = at(now, 21);
      if (remindAt <= now) remindAt.setDate(remindAt.getDate() + 1);
      await memory.setTodoReminderByContent(decodeKeyword(id, 'rem_tonight_'), remindAt);
      await send.sendMessage(from, 'Reminder set for 9pm.');
      hub.notify();
      return true;
    }

    // Reminder follow-up: tomorrow 8am
    if (id.startsWith('rem_tmrw_')) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await memory.setTodoReminderByContent(decodeKeyword(id, 'rem_tmrw_'), at(tomorrow, 8));
      await send.sendMessage(from, 'Reminder set for tomorrow 8am.');
      hub.notify();
      return true;
    }

    // Reminder follow-up: skip / no reminder
    if (id === 'rem_no') {
      await send.sendMessage(from, 'Ok, no reminder.');
      return true;
    }

    // Stale todos: dismiss the alert
    if (id === 'stale_dismiss') {
      await send.sendMessage(from, 'Got it.');
      return true;
    }

    // Stale todos: snooze (legacy button without an encoded id — just acknowledge)
    if (id === 'stale_snooze') {
      await send.sendMessage(from, "Noted — I'll check back in a couple of days.");
      return true;
    }

    // One Big Thing — skip
    if (id === 'obt_skip') {
      await send.sendMessage(from, 'No problem. Have a focused session.');
      return true;
    }

    // One Big Thing — set: prime the LLM with a goal-setting prompt
    if (id === 'obt_set') {
      // Required lazily: brain.js pulls in this module's siblings, and a top-level require here
      // would close a cycle through whatsapp/send.
      const { handleIncoming } = require('../agent/brain');
      const reply = await handleIncoming('I want to set my One Big Thing for tonight', from);
      if (reply) await send.sendMessage(from, reply);
      hub.notify();
      return true;
    }
  } catch (err) {
    console.error('[Button] Handler error:', id, err.message);
  }

  return false;
}

// Both webhook entry points receive the same interactive payload shape.
// Returns { buttonId, buttonTitle }, either of which may be undefined.
function parseInteractive(interactive) {
  if (interactive?.type === 'list_reply') {
    return { buttonId: interactive.list_reply?.id, buttonTitle: interactive.list_reply?.title };
  }
  // button_reply, and anything unrecognised that still carries one.
  return { buttonId: interactive?.button_reply?.id, buttonTitle: interactive?.button_reply?.title };
}

module.exports = { handleButtonAction, parseInteractive, parseSnooze, decodeKeyword };
