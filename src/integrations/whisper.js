const axios = require('axios');
const FormData = require('form-data');

async function downloadWhatsAppAudio(mediaId) {
  // Step 1: get the media URL
  const { data: meta } = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );

  // Step 2: download the binary
  const { data: audioBuffer } = await axios.get(meta.url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer',
  });

  return { buffer: Buffer.from(audioBuffer), mimeType: meta.mime_type };
}

async function transcribeAudio(mediaId) {
  try {
    const { buffer, mimeType } = await downloadWhatsAppAudio(mediaId);

    const ext = mimeType.includes('ogg') ? 'ogg' : 'mp4';
    const form = new FormData();
    form.append('file', buffer, { filename: `audio.${ext}`, contentType: mimeType });
    form.append('model', 'whisper-large-v3');
    form.append('language', 'en');

    const { data } = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      form,
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          ...form.getHeaders(),
        },
      }
    );

    return data.text;
  } catch (err) {
    console.error('Whisper transcription error:', err.response?.data || err.message);
    return null;
  }
}

module.exports = { transcribeAudio };
