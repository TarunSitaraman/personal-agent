const axios = require('axios');

const BASE_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

async function sendMessage(to, text) {
  try {
    await axios.post(
      BASE_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    console.error('WhatsApp send error:', err.response?.data || err.message);
  }
}

async function sendButtonMessage(to, body, buttons) {
  try {
    await axios.post(
      BASE_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: {
            buttons: buttons.map(b => ({
              type: 'reply',
              reply: { id: b.id, title: b.title.slice(0, 20) },
            })),
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    console.error('WhatsApp button send error:', err.response?.data || err.message);
  }
}

module.exports = { sendMessage, sendButtonMessage };
