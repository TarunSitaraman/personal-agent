const test = require('node:test');
const assert = require('node:assert');
const { cleanNudge } = require('../src/agent/nudgeText');

test('SKIP in any spelling means no nudge', () => {
  for (const raw of ['SKIP', 'SKIP.', ' skip\n', 'SKIP — nothing new today', '**SKIP**', '']) {
    assert.strictEqual(cleanNudge(raw), null, JSON.stringify(raw));
  }
  assert.strictEqual(cleanNudge(null), null);
});

test('drops the model narrating its own checklist (the 2026-09-22 production message)', () => {
  const raw = 'Proactive nudge: No “One Big Thing” pending, so skip that.\n'
    + 'Automation suggestion: Create a simple Zapier workflow that auto-tags notes.';
  assert.strictEqual(cleanNudge(raw), 'Create a simple Zapier workflow that auto-tags notes.');
});

test('drops priority walk-through lines and label prefixes', () => {
  const raw = 'Priority 1 (Goal Check): none pending.\nPriority 3: *PR #42* has waited 4 days for review — worth a ping.';
  assert.strictEqual(cleanNudge(raw), '*PR #42* has waited 4 days for review — worth a ping.');
});

test('a message that is only reasoning becomes no message', () => {
  assert.strictEqual(cleanNudge('No pending goal, so skip that.\nNothing urgent, skipping.'), null);
});

test('keeps an ordinary nudge untouched', () => {
  const raw = 'You added *study fla for exam* four days ago and it has no reminder.\nWant one for tonight?';
  assert.strictEqual(cleanNudge(raw), raw);
});
