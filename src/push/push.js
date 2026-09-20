const axios = require('axios');
const memory = require('../agent/memory');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Expo's push service only accepts Expo push tokens. The old app fell back to a raw FCM device
// token when it could not get an Expo one, and those can never be delivered through exp.host.
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;
function isExpoPushToken(token) {
  return typeof token === 'string' && EXPO_TOKEN.test(token);
}

// WhatsApp emphasis (*bold*, **bold**) renders literally in a notification and in the app.
// Underscores are deliberately left alone: stripping _italic_ would mangle identifiers such as
// item_events that appear in PR briefs, and the codebase only emits asterisk emphasis.
function stripWhatsAppMarkup(text) {
  return String(text).replace(/\*+([^*\n]+?)\*+/g, '$1');
}

const PUSH_BODY_MAX = 180;
// A notification shows a line or two. The full text is kept in the app's inbox (deliver()).
function toPushText(text) {
  const plain = stripWhatsAppMarkup(text).replace(/\s+/g, ' ').trim();
  if (plain.length <= PUSH_BODY_MAX) return plain;
  const cut = plain.slice(0, PUSH_BODY_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > PUSH_BODY_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

// Sends to every registered Expo device of the current user and reports the outcome, because
// deliver() decides from it whether to fall back to WhatsApp. Never throws on a send failure.
// Ticket order matches message order (Expo push API), which is how a DeviceNotRegistered ticket is
// mapped back to the token to prune.
async function sendPush(title, body, data = {}) {
  const tokens = (await memory.getPushTokens()).filter(isExpoPushToken);
  const result = { attempted: tokens.length, accepted: 0, deadTokens: [], failed: false };
  if (!tokens.length) return result;

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
      // A hung request would stall the whole cron run; fall back to WhatsApp instead.
      timeout: 10000,
    });
    const tickets = res.data?.data || [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === 'ok') result.accepted++;
      else if (ticket.details?.error === 'DeviceNotRegistered') result.deadTokens.push(tokens[i]);
    });
    const errors = tickets.filter(t => t.status === 'error');
    if (errors.length) console.error('[Push] Delivery errors:', JSON.stringify(errors));
  } catch (err) {
    console.error('[Push] Failed to send:', err.response?.data || err.message);
    result.failed = true;
  }
  return result;
}

module.exports = { sendPush, isExpoPushToken, stripWhatsAppMarkup, toPushText };
