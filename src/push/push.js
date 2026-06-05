const axios = require('axios');
const memory = require('../agent/memory');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Send a push notification to all registered Expo devices.
// data: arbitrary object — the Expo app can inspect this to decide how to handle the tap.
async function sendPush(title, body, data = {}) {
  const tokens = await memory.getPushTokens();
  if (!tokens.length) return;

  const messages = tokens.map(token => ({
    to: token,
    title,
    body,
    data,
    sound: 'default',
    priority: 'high',
    channelId: data.channelId || 'default',
  }));

  try {
    const res = await axios.post(EXPO_PUSH_URL, messages, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    const tickets = res.data?.data || [];
    const errors = tickets.filter(t => t.status === 'error');
    if (errors.length) console.error('[Push] Delivery errors:', JSON.stringify(errors));
  } catch (err) {
    console.error('[Push] Failed to send:', err.response?.data || err.message);
  }
}

// Convenience wrappers for common notification types
function sendReminderPush(todoId, content) {
  return sendPush('Reminder', content, {
    type: 'todo_reminder',
    todoId,
    channelId: 'reminders',
  });
}

function sendBriefPush(title, summary) {
  return sendPush(title, summary, {
    type: 'brief',
    channelId: 'briefs',
  });
}

function sendNudgePush(message) {
  return sendPush('Blu', message, {
    type: 'nudge',
    channelId: 'nudges',
  });
}

module.exports = { sendPush, sendReminderPush, sendBriefPush, sendNudgePush };
