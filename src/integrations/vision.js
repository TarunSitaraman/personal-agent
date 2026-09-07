const axios = require('axios');

const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

async function analyzeImage(mediaId, caption = '') {
  try {
    // Step 1: get media URL from Meta
    const { data: meta } = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    );

    // Step 2: download image binary
    const { data: imageBuffer } = await axios.get(meta.url, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
      responseType: 'arraybuffer',
    });

    const base64 = Buffer.from(imageBuffer).toString('base64');
    const mimeType = meta.mime_type || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const prompt = caption
      ? `Tarun sent this image with caption: "${caption}". Describe what you see and what's relevant for a personal productivity agent. Be concise.`
      : `Tarun sent this image. Describe what you see — if it's a screenshot, code, document, or note, extract the key information. Be concise.`;

    // Step 3: send to Groq vision model
    const { data } = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
    );

    return data.choices[0].message.content;
  } catch (err) {
    console.error('Vision error:', err.response?.data || err.message);
    return null;
  }
}

module.exports = { analyzeImage };
