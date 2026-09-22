const test = require('node:test');
const assert = require('node:assert');
const { parseVoiceBody, MAX_AUDIO_BYTES } = require('../src/agent/voice');

test('accepts a base64 recording with an allowed audio type', () => {
  const audio = Buffer.from('fake m4a bytes').toString('base64');
  const r = parseVoiceBody({ audio, mime: 'audio/mp4' });
  assert.ok(r.ok);
  assert.strictEqual(r.buffer.toString(), 'fake m4a bytes');
  assert.strictEqual(r.mime, 'audio/mp4');
  assert.strictEqual(r.filename, 'voice.m4a');
});

test('rejects missing, non-string, empty, oversized and non-audio bodies', () => {
  assert.strictEqual(parseVoiceBody(undefined).ok, false);
  assert.strictEqual(parseVoiceBody({}).ok, false);
  assert.strictEqual(parseVoiceBody({ audio: 42, mime: 'audio/mp4' }).ok, false);
  assert.strictEqual(parseVoiceBody({ audio: '', mime: 'audio/mp4' }).ok, false);
  assert.strictEqual(parseVoiceBody({ audio: 'aGk=', mime: 'image/png' }).ok, false);
  const huge = Buffer.alloc(MAX_AUDIO_BYTES + 1).toString('base64');
  const r = parseVoiceBody({ audio: huge, mime: 'audio/mp4' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /too long/);
});

test('a data: URI prefix is tolerated, since that is what FileReader produces', () => {
  const r = parseVoiceBody({ audio: 'data:audio/mp4;base64,' + Buffer.from('x').toString('base64'), mime: 'audio/mp4' });
  assert.ok(r.ok);
  assert.strictEqual(r.buffer.toString(), 'x');
});
