const axios = require('axios');

const BASE_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

async function callMetaWithRetry(axiosCall, maxRetries = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await axiosCall();
    } catch (err) {
      attempt++;
      const status = err.response?.status;
      const is5xx = status && status >= 500 && status < 600;
      
      if (is5xx && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`[WhatsApp API] Meta returned 5xx (${status}). Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

async function sendMessage(to, text) {
  try {
    await callMetaWithRetry(() => axios.post(
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
    ));
  } catch (err) {
    console.error('WhatsApp send error:', err.response?.data || err.message);
  }
}

async function sendButtonMessage(to, body, buttons) {
  try {
    await callMetaWithRetry(() => axios.post(
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
    ));
  } catch (err) {
    // Interactive messages not supported on test numbers — fall back to text
    console.error('Button send failed, using text fallback:', err.response?.data?.error?.message || err.message);
    const options = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
    await sendMessage(to, `${body}\n\n${options}`);
  }
}

// sections: [{ title: string, rows: [{ id, title, description? }] }]
async function sendListMessage(to, body, buttonLabel, sections) {
  try {
    await callMetaWithRetry(() => axios.post(
      BASE_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body },
          action: {
            button: buttonLabel.slice(0, 20),
            sections: sections.map(s => ({
              title: s.title.slice(0, 24),
              rows: s.rows.map(r => ({
                id: r.id,
                title: r.title.slice(0, 24),
                ...(r.description ? { description: r.description.slice(0, 72) } : {}),
              })),
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
    ));
  } catch (err) {
    // Fall back to plain text if list messages aren't supported
    console.error('List send failed, using text fallback:', err.response?.data?.error?.message || err.message);
    const lines = sections.flatMap(s => [`*${s.title}*`, ...s.rows.map((r, i) => `${i + 1}. ${r.title}`)]).join('\n');
    await sendMessage(to, `${body}\n\n${lines}`);
  }
}

module.exports = { sendMessage, sendButtonMessage, sendListMessage };
