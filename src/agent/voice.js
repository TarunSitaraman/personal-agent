// Validates a voice note uploaded by the app (POST /dashboard/chat/voice) before it goes to
// Whisper — the same transcription path WhatsApp voice notes already use. Pure, so it is tested
// without any network.

const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // ~8 minutes of AAC; far beyond a voice note

const EXT = {
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
};

function parseVoiceBody(body) {
  if (!body || typeof body.audio !== 'string' || !body.audio) return { ok: false, error: 'audio (base64) is required' };
  const mime = typeof body.mime === 'string' ? body.mime.toLowerCase() : '';
  if (!EXT[mime]) return { ok: false, error: `unsupported audio type: ${mime || 'none'}` };
  const b64 = body.audio.replace(/^data:[^,]*,/, ''); // FileReader hands back a data: URI
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length) return { ok: false, error: 'audio is empty' };
  if (buffer.length > MAX_AUDIO_BYTES) return { ok: false, error: 'recording is too long' };
  return { ok: true, buffer, mime, filename: `voice.${EXT[mime]}` };
}

module.exports = { parseVoiceBody, MAX_AUDIO_BYTES };
