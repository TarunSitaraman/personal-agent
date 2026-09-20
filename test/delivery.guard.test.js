// Every scheduled proactive send must go through deliver(): that is what routes it to the app
// first and records it in the inbox. A cron that calls WhatsApp or push directly would silently
// bypass both — the same drift that made three reminder paths disagree before delivery.js existed.
// Reads the source, like schema.scoping.test.js, because the crons have no unit tests.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CRON_DIR = path.join(ROOT, 'api', 'cron');
const SOURCES = [
  ...fs.readdirSync(CRON_DIR).filter(f => f.endsWith('.js')).map(f => path.join(CRON_DIR, f)),
  path.join(ROOT, 'src', 'scheduler', 'briefs.js'),
];

const DIRECT_SEND = /\b(sendMessage|sendButtonMessage|sendBriefPush|sendNudgePush|sendReminderPush)\s*\(/;

test('no scheduled send bypasses deliver()', () => {
  assert.ok(SOURCES.length >= 7, `expected the cron files, found ${SOURCES.length}`);
  const offenders = SOURCES.filter(f => DIRECT_SEND.test(fs.readFileSync(f, 'utf8')))
    .map(f => path.relative(ROOT, f));
  assert.deepStrictEqual(offenders, [], `send directly instead of via deliver(): ${offenders.join(', ')}`);
});
