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

// Transcribes audio bytes with Groq Whisper. Shared by WhatsApp voice notes and the app's
// voice button (POST /dashboard/chat/voice). Returns the text, or null on any failure.
async function transcribeBuffer(buffer, mimeType, filename) {
  try {
    const ext = mimeType.includes('ogg') ? 'ogg' : 'mp4';
    const form = new FormData();
    form.append('file', buffer, { filename: filename || `audio.${ext}`, contentType: mimeType });
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

    return data.text?.trim() || null;
  } catch (err) {
    console.error('Whisper transcription error:', err.response?.data || err.message);
    return null;
  }
}

async function transcribeAudio(mediaId) {
  try {
    const { buffer, mimeType } = await downloadWhatsAppAudio(mediaId);
    return await transcribeBuffer(buffer, mimeType);
  } catch (err) {
    console.error('WhatsApp audio download error:', err.response?.data || err.message);
    return null;
  }
}

module.exports = { transcribeAudio, transcribeBuffer };
