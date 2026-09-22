const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { jsonExceptUploads, isUpload } = require('../src/jsonBody');

test('upload routes are left to their own, larger parsers', () => {
  assert.ok(isUpload('/dashboard/chat/voice'));
  assert.ok(isUpload('/dashboard/chat/image'));
  assert.ok(!isUpload('/dashboard/chat'));
  assert.ok(!isUpload('/dashboard/chat/voice/extra'));
  assert.ok(!isUpload('/webhook'));
});

// Regression: a global express.json() (100 KB) ran before the dashboard router, so every voice
// note and image returned 413 before the route's own 12 MB parser was reached.
test('a 300 KB voice body reaches the route; a 300 KB body elsewhere is still refused', async () => {
  const app = express();
  app.use(jsonExceptUploads());
  app.post('/dashboard/chat/voice', express.json({ limit: '12mb' }), (req, res) => res.json({ n: req.body.audio.length }));
  app.post('/dashboard/chat', (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ audio: 'a'.repeat(300 * 1024), mime: 'audio/mp4' });
  const post = path => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  try {
    const voice = await post('/dashboard/chat/voice');
    assert.strictEqual(voice.status, 200);
    assert.strictEqual((await voice.json()).n, 300 * 1024);
    assert.strictEqual((await post('/dashboard/chat')).status, 413);
  } finally {
    server.close();
  }
});
