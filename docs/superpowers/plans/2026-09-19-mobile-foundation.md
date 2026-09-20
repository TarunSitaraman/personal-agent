# Mobile App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Expo app the primary interface: proactive messages reach the phone by push first (WhatsApp as fallback), every one is kept in an in-app thread, and the app authenticates safely from a real native build.

**Architecture:** All app traffic goes to the `/dashboard` Express router, which Vercel already serves as one function, so nothing new lands in `api/` and the 12-function cap is untouched. Proactive sends route through one `deliver()` in `src/scheduler/delivery.js`: try push, prune dead tokens, fall back to WhatsApp, then record the outcome in a new `inbox_messages` table. The app moves to an EAS build with the token held in `expo-secure-store` and sent as a Bearer header.

**Tech Stack:** Node 20+ CommonJS, Express, `pg`, built-in `node --test`; Expo SDK 54, React Native 0.81, `expo-notifications`, `expo-secure-store`, `expo-dev-client`, `expo-constants`, EAS Build, Firebase Cloud Messaging (FCM V1).

**Spec:** `docs/superpowers/specs/2026-09-19-mobile-foundation-design.md`

## Global Constraints

- **Never add a file under `api/`.** Every `.js` there is its own Vercel function and the project is at the Hobby 12-function cap (11 files + the Express app). New server routes go on the `/dashboard` router.
- **No new server npm dependencies.** Server tests use the built-in `node --test` runner, deliberately (CLAUDE.md → Conventions).
- **Mobile dependencies only via `npx expo install`**, so versions match SDK 54: `expo-secure-store`, `expo-dev-client`, `expo-constants`.
- **The repo is public.** Never commit a credential, `mobile/google-services.json`, or the FCM service-account key.
- **The app never puts a token in a URL.** Tokens travel in `Authorization: Bearer`.
- **Every query touching a user-owned table filters on `user_id`**, and **passes as many params as its highest `$N`**. Enforced by `test/schema.scoping.test.js` and `test/schema.params.test.js`.
- **No AI attribution in commits.** No `Co-Authored-By`, no session trailers, no tool mentions. Conventional commits only.
- **Run `npm test` before every commit.**
- **Never put `grep -n` (or any `-n`) in the same shell command as `git commit`.** The `block-no-verify` hook reads `-n` as `git commit --no-verify` and blocks the whole command. Use `grep --line-number`, or run the grep separately.
- **Database commands can time out because the network filters ports 5432/6543.** If `node src/migrate_db.js` or a DB query hits `ETIMEDOUT`, probe `portquiz.net:6543`. If that times out too, switch networks. It is not a code bug.
- **Deploying = pushing `master`.** Vercel deploys production from `master`. Every push needs Tarun's explicit go-ahead at the checkpoint that calls for it.
- **Work on the branch `feat/mobile-foundation`**, created from `master` before Task 1.

---

### Task 1: `/dashboard` auth accepts the Authorization header

**Files:**
- Modify: `src/agent/dashboardAuth.js` (add `dashboardTokenMiddleware`)
- Modify: `src/routes/dashboard.js:10-21` (use it instead of the local `tokenMiddleware`)
- Test: `test/dashboardAuth.test.js` (new)

**Interfaces:**
- Consumes: `tokenFrom(req)` (already in `src/agent/dashboardAuth.js`: Bearer header first, then `?token=`, `null` if neither); `memory.getUserByDashboardToken(token)`; `runAsUser(user, fn)` from `src/agent/context.js`.
- Produces: `dashboardTokenMiddleware(req, res, next) -> Promise|undefined`. It 401s (plain text `Unauthorized`, matching the router's existing response) when the token is missing or unknown; otherwise it sets `req.user` and calls `next()` inside `runAsUser(user)`.

This makes `tokenFrom` the single token-reading implementation, which the spec's "one auth implementation" asks for. One deviation from the spec: `src/agent/dashboardAuth.js` is **not** deleted in Task 12. Only `withDashboardUser` goes, because the router now depends on the rest.

- [ ] **Step 1: Write the failing tests**

Create `test/dashboardAuth.test.js`:

```js
// The /dashboard router's auth: the one check the mobile app, the web dashboard and every new
// app route depend on. The app sends its token in the Authorization header (never in the URL,
// where access logs record it); the web dashboard navigates by URL and sends ?token=.

const test = require('node:test');
const assert = require('node:assert');

const memory = require('../src/agent/memory');
const { currentUserId } = require('../src/agent/context');
const { dashboardTokenMiddleware } = require('../src/agent/dashboardAuth');

const ALICE = { id: 'aaaaaaaa-0000-0000-0000-000000000001', wa_number: '911', active: true };

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = code => { res.statusCode = code; return res; };
  res.send = body => { res.body = body; return res; };
  res.json = body => { res.body = body; return res; };
  return res;
}

test.afterEach(() => test.mock.restoreAll());

test('a header token lets the request through, inside the user scope', async () => {
  test.mock.method(memory, 'getUserByDashboardToken', async t => (t === 'alice-token' ? ALICE : null));
  const req = { headers: { authorization: 'Bearer alice-token' }, query: {} };
  let scopedAs = null;

  await dashboardTokenMiddleware(req, fakeRes(), () => { scopedAs = currentUserId(); });

  assert.strictEqual(scopedAs, ALICE.id);
  assert.strictEqual(req.user, ALICE);
});

test('a query token still works, for the web dashboard', async () => {
  test.mock.method(memory, 'getUserByDashboardToken', async () => ALICE);
  let called = false;

  await dashboardTokenMiddleware({ headers: {}, query: { token: 'alice-token' } }, fakeRes(), () => { called = true; });

  assert.strictEqual(called, true);
});

test('the header takes precedence over the query string', async () => {
  const seen = [];
  test.mock.method(memory, 'getUserByDashboardToken', async t => { seen.push(t); return ALICE; });

  await dashboardTokenMiddleware(
    { headers: { authorization: 'Bearer from-header' }, query: { token: 'from-query' } }, fakeRes(), () => {});

  assert.deepStrictEqual(seen, ['from-header']);
});

test('a missing token is a 401, decided before any lookup', async () => {
  const seen = [];
  test.mock.method(memory, 'getUserByDashboardToken', async t => { seen.push(t); return ALICE; });
  const res = fakeRes();
  let called = false;

  await dashboardTokenMiddleware({ headers: {}, query: {} }, res, () => { called = true; });

  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(called, false);
  assert.strictEqual(seen.length, 0);
});

test('an unknown token is a 401', async () => {
  test.mock.method(memory, 'getUserByDashboardToken', async () => null);
  const res = fakeRes();
  let called = false;

  await dashboardTokenMiddleware({ headers: { authorization: 'Bearer nope' }, query: {} }, res, () => { called = true; });

  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(called, false);
});

test('an empty Bearer value is treated as no token', async () => {
  test.mock.method(memory, 'getUserByDashboardToken', async () => ALICE);
  const res = fakeRes();

  await dashboardTokenMiddleware({ headers: { authorization: 'Bearer ' }, query: {} }, res, () => {});

  assert.strictEqual(res.statusCode, 401);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/dashboardAuth.test.js`
Expected: FAIL. `dashboardTokenMiddleware is not a function`.

- [ ] **Step 3: Add the middleware**

In `src/agent/dashboardAuth.js`, add before `module.exports`:

```js
// Express middleware for the /dashboard router, using the same token rules as withDashboardUser.
// One implementation of "which token is this request carrying", so the router and the handlers
// cannot drift apart the way api/todos.js and api/chat.js did from it. Answers with the router's
// existing plain-text 401, and calls next() inside the user's scope so every downstream handler
// inherits it. Returns the promise so tests can await it; Express ignores the return value.
function dashboardTokenMiddleware(req, res, next) {
  const token = tokenFrom(req);
  if (!token) return res.status(401).send('Unauthorized');
  return memory.getUserByDashboardToken(token).then(user => {
    if (!user) return res.status(401).send('Unauthorized');
    req.user = user;
    return runAsUser(user, () => next());
  }).catch(next);
}
```

Change the export line to:

```js
module.exports = { withDashboardUser, tokenFrom, dashboardTokenMiddleware };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/dashboardAuth.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Use it in the router**

In `src/routes/dashboard.js`, replace this block:

```js
// Resolve the authenticated user from the dashboard token query param.
// Replaces the shared DASHBOARD_TOKEN — each user has their own token stored in the database.
function tokenMiddleware(req, res, next) {
   const token = req.query.token;
   if (!token) return res.status(401).send('Unauthorized');
   getUserByDashboardToken(token).then(user => {
     if (!user) return res.status(401).send('Unauthorized');
     req.user = user;
     runAsUser(user, () => next());
   }).catch(next);
}

// Every route below reads or writes one person's data, so the whole router runs in scope.
router.use(tokenMiddleware);
```

with:

```js
// Per-user dashboard token, from the Authorization header (the app) or ?token= (the web
// dashboard, which navigates by URL). One implementation, shared: src/agent/dashboardAuth.js.
const { dashboardTokenMiddleware } = require('../agent/dashboardAuth');

// Every route below reads or writes one person's data, so the whole router runs in scope.
router.use(dashboardTokenMiddleware);
```

Then check whether that change orphaned two imports:

Run: `grep --line-number "runAsUser\|getUserByDashboardToken" src/routes/dashboard.js`
If `runAsUser` appears only on its `require` line, delete that line. If `getUserByDashboardToken` appears only inside the long `require('../agent/memory')` destructure, remove it from that list. Leave anything else alone.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/agent/dashboardAuth.js src/routes/dashboard.js test/dashboardAuth.test.js
git commit -m "feat: accept the dashboard token in an Authorization header"
```

---

### Task 2: `inbox_messages` table, and reading the chat thread

**Files:**
- Modify: `src/migrate_db.js` (step 11c after line 202; add to `OWNED`)
- Modify: `test/schema.scoping.test.js` (add to `OWNED`)
- Modify: `src/agent/memory.js` (two functions + exports)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `memory.saveInboxMessage({ kind, title, body, channel }) -> Promise<void>`. `channel` is `'push' | 'whatsapp' | 'failed'`.
  - `memory.getThread(before: string|null, limit: number) -> Promise<Array<{id, from: 'me'|'agent', kind: string, text: string, created_at: Date}>>`, newest first. `kind` is `'chat'` for conversation rows and the inbox `kind` otherwise.

- [ ] **Step 1: Write the failing test**

In `test/schema.scoping.test.js`, change the `OWNED` array to:

```js
const OWNED = [
  'todos', 'notes', 'events', 'learnings', 'knowledge', 'goals',
  'conversations', 'state', 'skills', 'user_insights',
  'pending_messages', 'entity_links', 'reminders', 'classifier_corrections',
  'inbox_messages',
];
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/schema.scoping.test.js`
Expected: FAIL on "the owned-table list matches what the migration actually stamps".

- [ ] **Step 3: Add the migration step**

In `src/migrate_db.js`, immediately after the line
`console.log('✔ classifier_corrections table and index created/verified');`, insert:

```js

    // 11c. Proactive messages as delivered — briefs, reminders, nudges — so the app can show them
    // in its chat thread whichever channel carried them. Created before the OWNED loop for the same
    // reason as 11b: that loop ALTERs every owned table. Kept out of `conversations` on purpose:
    // the classifier reads the last three rows there, and a long brief in that window would change
    // how the next message is classified.
    // See docs/superpowers/specs/2026-09-19-mobile-foundation-design.md.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind TEXT NOT NULL,
        title TEXT,
        body TEXT NOT NULL,
        channel TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox_messages (created_at DESC);
    `);
    console.log('✔ inbox_messages table and index created/verified');
```

Then change the `OWNED` declaration to:

```js
     const OWNED = ['todos', 'notes', 'events', 'learnings', 'knowledge', 'goals',
                   'conversations', 'state', 'skills', 'user_insights',
                   'pending_messages', 'entity_links', 'reminders',
                   'classifier_corrections', 'inbox_messages'];
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/schema.scoping.test.js`
Expected: PASS.

- [ ] **Step 5: Add the memory functions**

In `src/agent/memory.js`, immediately after `markCorrectionsExported` (added on 2026-09-17), insert:

```js

// Proactive messages from the agent, as delivered. The app's chat thread reads these alongside
// `conversations`. See migrate_db.js step 11c for why they are not in `conversations`.
async function saveInboxMessage({ kind, title = null, body, channel }) {
  await pool.query(
    `INSERT INTO inbox_messages (kind, title, body, channel, user_id) VALUES ($1, $2, $3, $4, $5)`,
    [kind, title, body, channel, currentUserId()]
  );
}

// The chat thread, newest first: the user's messages and the agent's replies, plus proactive
// messages. `before` (ISO string or null) pages backwards; the caller clamps `limit`
// (src/agent/thread.js). "sender", not "from": FROM is reserved in SQL.
async function getThread(before, limit) {
  const { rows } = await pool.query(
    `SELECT id, sender, kind, text, created_at FROM (
       SELECT id, CASE WHEN role = 'user' THEN 'me' ELSE 'agent' END AS sender,
              'chat' AS kind, content AS text, created_at
         FROM conversations
        WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
       UNION ALL
       SELECT id, 'agent' AS sender, kind, body AS text, created_at
         FROM inbox_messages
        WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
     ) thread
     ORDER BY created_at DESC
     LIMIT $3`,
    [currentUserId(), before, limit]
  );
  return rows.map(r => ({ id: r.id, from: r.sender, kind: r.kind, text: r.text, created_at: r.created_at }));
}
```

Add both to `module.exports`, on the line after the correction functions:

```js
  saveInboxMessage, getThread,
```

- [ ] **Step 6: Run the schema guards**

Run: `node --test test/schema.scoping.test.js test/schema.params.test.js`
Expected: PASS. Both new queries filter on `user_id`, and `getThread` passes 3 params for `$3`.

- [ ] **Step 7: Run the migration**

Run: `node src/migrate_db.js`
Expected: `✔ inbox_messages table and index created/verified`, then `✔ user_id added, backfilled and indexed on 15 tables`, then `Migrations completed successfully!`. Run it a second time; it must also complete cleanly.
If it hits `ETIMEDOUT`, see Global Constraints: this is the network, so switch networks and rerun.

- [ ] **Step 8: Verify `getThread` against the database**

Run:

```bash
node -e "require('dotenv').config();const m=require('./src/agent/memory');const{withOwner}=require('./src/agent/context');withOwner(async()=>{const t=await m.getThread(null,5);console.log(t.length,'rows; newest first:',t.map(x=>x.from+'/'+x.kind+' '+new Date(x.created_at).toISOString()).join(' | '))}).then(()=>process.exit(0)).catch(e=>{console.error('FAIL',e.code||e.message);process.exit(1)})"
```

Expected: `5 rows`, with timestamps in descending order and `from` values of `me` or `agent`.

- [ ] **Step 9: Full suite, then commit**

Run: `npm test`, expecting all to pass. Then:

```bash
git add src/migrate_db.js src/agent/memory.js test/schema.scoping.test.js
git commit -m "feat: inbox_messages table and the merged chat thread query"
```

---

### Task 3: Push sending reports what happened

**Files:**
- Modify: `src/push/push.js`
- Test: `test/push.test.js` (new)

**Interfaces:**
- Consumes: `memory.getPushTokens()`.
- Produces:
  - `sendPush(title, body, data) -> Promise<{ attempted: number, accepted: number, deadTokens: string[], failed: boolean }>`. It no longer returns `undefined`.
  - `isExpoPushToken(token) -> boolean`
  - `stripWhatsAppMarkup(text) -> string`
  - `toPushText(text) -> string` (markup stripped, whitespace collapsed, at most 180 characters, cut on a word boundary with `…`)

Deviation from the spec: `stripWhatsAppMarkup` strips `*bold*`/`**bold**` only, not `_italic_`. Stripping underscores would mangle identifiers that appear in PR briefs (`item_events`, `api_key`). The codebase only emits asterisk emphasis.

- [ ] **Step 1: Write the failing tests**

Create `test/push.test.js`:

```js
// Push sending must report what happened, because deliver() decides from the result whether to
// fall back to WhatsApp. It used to log ticket errors and return nothing.

const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

const memory = require('../src/agent/memory');
const { sendPush, isExpoPushToken, stripWhatsAppMarkup, toPushText } = require('../src/push/push');

const GOOD = 'ExponentPushToken[aaaa]';
const GOOD2 = 'ExponentPushToken[bbbb]';

test.afterEach(() => test.mock.restoreAll());

test('no registered tokens means nothing is attempted', async () => {
  test.mock.method(memory, 'getPushTokens', async () => []);
  const posts = [];
  test.mock.method(axios, 'post', async (...a) => { posts.push(a); return { data: { data: [] } }; });

  const r = await sendPush('t', 'b');

  assert.deepStrictEqual(r, { attempted: 0, accepted: 0, deadTokens: [], failed: false });
  assert.strictEqual(posts.length, 0);
});

test('a raw FCM token is never sent to the Expo push service', async () => {
  // The old app fell back to getDevicePushTokenAsync(), storing raw FCM tokens that Expo rejects.
  test.mock.method(memory, 'getPushTokens', async () => ['fcm-raw-token-123', GOOD]);
  let sent = null;
  test.mock.method(axios, 'post', async (url, messages) => { sent = messages; return { data: { data: [{ status: 'ok' }] } }; });

  const r = await sendPush('t', 'b');

  assert.strictEqual(r.attempted, 1);
  assert.deepStrictEqual(sent.map(m => m.to), [GOOD]);
});

test('accepted tickets are counted', async () => {
  test.mock.method(memory, 'getPushTokens', async () => [GOOD, GOOD2]);
  test.mock.method(axios, 'post', async () => ({ data: { data: [{ status: 'ok' }, { status: 'ok' }] } }));

  const r = await sendPush('t', 'b');

  assert.strictEqual(r.accepted, 2);
  assert.strictEqual(r.failed, false);
});

test('DeviceNotRegistered identifies the dead token by position', async () => {
  test.mock.method(memory, 'getPushTokens', async () => [GOOD, GOOD2]);
  test.mock.method(axios, 'post', async () => ({ data: { data: [
    { status: 'ok' },
    { status: 'error', details: { error: 'DeviceNotRegistered' } },
  ] } }));

  const r = await sendPush('t', 'b');

  assert.strictEqual(r.accepted, 1);
  assert.deepStrictEqual(r.deadTokens, [GOOD2]);
});

test('a failed request reports failure instead of throwing', async () => {
  test.mock.method(memory, 'getPushTokens', async () => [GOOD]);
  test.mock.method(axios, 'post', async () => { throw new Error('socket hang up'); });

  const r = await sendPush('t', 'b');

  assert.strictEqual(r.failed, true);
  assert.strictEqual(r.accepted, 0);
});

test('isExpoPushToken accepts both Expo token prefixes and nothing else', () => {
  assert.strictEqual(isExpoPushToken('ExponentPushToken[abc]'), true);
  assert.strictEqual(isExpoPushToken('ExpoPushToken[abc]'), true);
  assert.strictEqual(isExpoPushToken('fcm-raw-token'), false);
  assert.strictEqual(isExpoPushToken(''), false);
  assert.strictEqual(isExpoPushToken(undefined), false);
});

test('WhatsApp emphasis is removed, identifiers with underscores are not', () => {
  assert.strictEqual(stripWhatsAppMarkup('Starting: *Review* now'), 'Starting: Review now');
  assert.strictEqual(stripWhatsAppMarkup('the **One Big Thing**'), 'the One Big Thing');
  assert.strictEqual(stripWhatsAppMarkup('PR touches item_events and api_key'), 'PR touches item_events and api_key');
});

test('push text is short, single-line and cut on a word boundary', () => {
  assert.strictEqual(toPushText('Reminder: *call* the bank'), 'Reminder: call the bank');
  assert.strictEqual(toPushText('line one\n\nline two'), 'line one line two');

  const long = toPushText('word '.repeat(100));
  assert.ok(long.length <= 180, `got ${long.length}`);
  assert.ok(long.endsWith('…'));
  assert.ok(!long.endsWith(' …'), 'cut at a word, not mid-space');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/push.test.js`
Expected: FAIL. `isExpoPushToken is not a function`, and `sendPush` returns `undefined`.

- [ ] **Step 3: Implement**

In `src/push/push.js`, replace the whole `sendPush` function (from the `// Send a push notification to all registered Expo devices.` comment through its closing brace) with:

```js
// Expo's push service only accepts Expo push tokens. The old app fell back to a raw FCM device
// token when it could not get an Expo one, and those can never be delivered through exp.host.
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;
function isExpoPushToken(token) {
  return typeof token === 'string' && EXPO_TOKEN.test(token);
}

// WhatsApp emphasis (*bold*, **bold**) renders literally in a notification and in the app.
// Underscores are deliberately left alone: stripping _italic_ would mangle identifiers such as
// item_events that appear in PR briefs, and the codebase only emits asterisk emphasis.
function stripWhatsAppMarkup(text) {
  return String(text).replace(/\*+([^*\n]+?)\*+/g, '$1');
}

const PUSH_BODY_MAX = 180;
// A notification shows a line or two. The full text is kept in the app's inbox (deliver()).
function toPushText(text) {
  const plain = stripWhatsAppMarkup(text).replace(/\s+/g, ' ').trim();
  if (plain.length <= PUSH_BODY_MAX) return plain;
  const cut = plain.slice(0, PUSH_BODY_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > PUSH_BODY_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

// Sends to every registered Expo device of the current user and reports the outcome, because
// deliver() decides from it whether to fall back to WhatsApp. Never throws on a send failure.
// Ticket order matches message order (Expo push API), which is how a DeviceNotRegistered ticket is
// mapped back to the token to prune.
async function sendPush(title, body, data = {}) {
  const tokens = (await memory.getPushTokens()).filter(isExpoPushToken);
  const result = { attempted: tokens.length, accepted: 0, deadTokens: [], failed: false };
  if (!tokens.length) return result;

  const messages = tokens.map(token => ({
    to: token,
    title,
    body,
    data,
    sound: 'default',
    priority: 'high',
    channelId: data.channelId || 'default',
  }));

  try {
    const res = await axios.post(EXPO_PUSH_URL, messages, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      // A hung request would stall the whole cron run; fall back to WhatsApp instead.
      timeout: 10000,
    });
    const tickets = res.data?.data || [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === 'ok') result.accepted++;
      else if (ticket.details?.error === 'DeviceNotRegistered') result.deadTokens.push(tokens[i]);
    });
    const errors = tickets.filter(t => t.status === 'error');
    if (errors.length) console.error('[Push] Delivery errors:', JSON.stringify(errors));
  } catch (err) {
    console.error('[Push] Failed to send:', err.response?.data || err.message);
    result.failed = true;
  }
  return result;
}
```

Change the export line to:

```js
module.exports = {
  sendPush, sendReminderPush, sendBriefPush, sendNudgePush,
  isExpoPushToken, stripWhatsAppMarkup, toPushText,
};
```

(`sendReminderPush`/`sendBriefPush`/`sendNudgePush` stay until Task 5 removes their last callers.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/push.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Full suite, then commit**

Run: `npm test`, expecting all to pass. Then:

```bash
git add src/push/push.js test/push.test.js
git commit -m "feat: push sending reports accepted, dead and failed sends"
```

---

### Task 4: `deliver()`: app first, WhatsApp as fallback, always recorded

**Files:**
- Modify: `src/scheduler/delivery.js`
- Modify: `test/delivery.test.js` (the `pushText` assertions)
- Test: `test/deliver.test.js` (new)

**Interfaces:**
- Consumes: `push.sendPush`, `push.toPushText`, `push.stripWhatsAppMarkup` (Task 3); `memory.saveInboxMessage` (Task 2); `memory.removePushToken`; `send.sendMessage(to, text)`, `send.sendButtonMessage(to, body, buttons)` from `src/whatsapp/send.js`; `currentNumber()` from `src/agent/context.js`.
- Produces:
  - `deliver({ kind, title?, text, whatsapp?: { text, buttons } }) -> Promise<'push'|'whatsapp'|'failed'>`, which must run inside a user scope.
  - `chooseChannel(pushResult) -> 'push'|'whatsapp'`, pure.
  - `deliverTodoReminder(todo)` and `deliverEventReminder(ev)`, now returning the channel.

`chooseChannel` takes the `sendPush` result, whose `attempted` field is the token count. That covers the spec's `{ tokenCount, pushResult }` pair with one argument. Every call from `delivery.js` to push and WhatsApp goes through the module objects (`push.x`, `send.x`) so the tests can substitute them; that's the repo's convention (see `src/whatsapp/buttons.js`).

- [ ] **Step 1: Write the failing tests**

Create `test/deliver.test.js`:

```js
// deliver() is where the move off WhatsApp happens: every proactive message tries the app first,
// falls back to WhatsApp, and is recorded in the inbox either way. Sending is mocked throughout.

const test = require('node:test');
const assert = require('node:assert');

const memory = require('../src/agent/memory');
const push = require('../src/push/push');
const send = require('../src/whatsapp/send');
const { runAsUser } = require('../src/agent/context');
const { deliver, chooseChannel } = require('../src/scheduler/delivery');

const ALICE = { id: 'aaaaaaaa-0000-0000-0000-000000000001', wa_number: '911' };
const asAlice = fn => runAsUser(ALICE, fn);

const pushed = (over = {}) => ({ attempted: 1, accepted: 1, deadTokens: [], failed: false, ...over });

function mockAll({ pushResult = pushed(), sendFails = false, inboxFails = false } = {}) {
  const calls = { push: [], message: [], buttons: [], inbox: [], removed: [] };
  test.mock.method(push, 'sendPush', async (...a) => { calls.push.push(a); return pushResult; });
  test.mock.method(send, 'sendMessage', async (...a) => { if (sendFails) throw new Error('meta down'); calls.message.push(a); });
  test.mock.method(send, 'sendButtonMessage', async (...a) => { if (sendFails) throw new Error('meta down'); calls.buttons.push(a); });
  test.mock.method(memory, 'saveInboxMessage', async row => { if (inboxFails) throw new Error('db down'); calls.inbox.push(row); });
  test.mock.method(memory, 'removePushToken', async t => { calls.removed.push(t); });
  return calls;
}

test.afterEach(() => test.mock.restoreAll());

// ── chooseChannel ────────────────────────────────────────────────────────────

test('chooseChannel: no registered device means WhatsApp', () => {
  assert.strictEqual(chooseChannel(pushed({ attempted: 0, accepted: 0 })), 'whatsapp');
});

test('chooseChannel: an accepted push means the app', () => {
  assert.strictEqual(chooseChannel(pushed()), 'push');
});

test('chooseChannel: every token dead means WhatsApp', () => {
  assert.strictEqual(chooseChannel(pushed({ accepted: 0, deadTokens: ['x'] })), 'whatsapp');
});

test('chooseChannel: a failed request means WhatsApp', () => {
  assert.strictEqual(chooseChannel(pushed({ accepted: 0, failed: true })), 'whatsapp');
});

// ── deliver ──────────────────────────────────────────────────────────────────

test('a message the app accepted does not also go to WhatsApp', async () => {
  const calls = mockAll();

  const channel = await asAlice(() => deliver({ kind: 'brief', text: 'Good morning' }));

  assert.strictEqual(channel, 'push');
  assert.strictEqual(calls.message.length + calls.buttons.length, 0, 'no duplicate on WhatsApp');
  assert.strictEqual(calls.inbox[0].channel, 'push');
});

test('with no registered device it falls back to WhatsApp', async () => {
  const calls = mockAll({ pushResult: pushed({ attempted: 0, accepted: 0 }) });

  const channel = await asAlice(() => deliver({ kind: 'nudge', text: 'hi' }));

  assert.strictEqual(channel, 'whatsapp');
  assert.deepStrictEqual(calls.message[0], ['911', 'hi']);
  assert.strictEqual(calls.inbox[0].channel, 'whatsapp');
});

test('dead tokens are pruned and the message falls back', async () => {
  const calls = mockAll({ pushResult: pushed({ accepted: 0, deadTokens: ['ExponentPushToken[dead]'] }) });

  const channel = await asAlice(() => deliver({ kind: 'reminder', text: 'x' }));

  assert.deepStrictEqual(calls.removed, ['ExponentPushToken[dead]']);
  assert.strictEqual(channel, 'whatsapp');
});

test('the WhatsApp fallback keeps its buttons', async () => {
  const calls = mockAll({ pushResult: pushed({ attempted: 0, accepted: 0 }) });
  const buttons = [{ id: 'rdone_1', title: 'Done' }];

  await asAlice(() => deliver({ kind: 'reminder', text: 'Reminder: x', whatsapp: { text: 'Reminder: x', buttons } }));

  assert.deepStrictEqual(calls.buttons[0], ['911', 'Reminder: x', buttons]);
});

test('when both channels fail the message is still recorded, as failed', async () => {
  const calls = mockAll({ pushResult: pushed({ accepted: 0, failed: true }), sendFails: true });

  const channel = await asAlice(() => deliver({ kind: 'weekly', text: 'review' }));

  assert.strictEqual(channel, 'failed');
  assert.strictEqual(calls.inbox[0].channel, 'failed');
});

test('an inbox write failure does not throw out of deliver', async () => {
  mockAll({ inboxFails: true });

  const channel = await asAlice(() => deliver({ kind: 'brief', text: 'x' }));

  assert.strictEqual(channel, 'push');
});

test('a push that throws still reaches WhatsApp', async () => {
  const calls = mockAll();
  test.mock.method(push, 'sendPush', async () => { throw new Error('getPushTokens failed'); });

  const channel = await asAlice(() => deliver({ kind: 'nudge', text: 'hi' }));

  assert.strictEqual(channel, 'whatsapp');
  assert.strictEqual(calls.message.length, 1);
});

test('the push is short and plain, the inbox keeps the full plain text', async () => {
  const calls = mockAll();
  const long = '*Morning* ' + 'detail '.repeat(60);

  await asAlice(() => deliver({ kind: 'brief', text: long }));

  const [, pushBody, data] = calls.push[0];
  assert.ok(pushBody.length <= 180);
  assert.ok(!pushBody.includes('*'));
  assert.strictEqual(data.type, 'brief');
  assert.strictEqual(data.channelId, 'briefs');
  assert.ok(!calls.inbox[0].body.includes('*'));
  assert.ok(calls.inbox[0].body.length > 180, 'the inbox keeps the whole message');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/deliver.test.js`
Expected: FAIL. `deliver is not a function`.

- [ ] **Step 3: Implement**

In `src/scheduler/delivery.js`, replace these three lines:

```js
const { sendButtonMessage } = require('../whatsapp/send');
const { sendReminderPush, sendNudgePush } = require('../push/push');
const { currentNumber } = require('../agent/context');
```

with:

```js
// Module objects, not destructured, so tests can substitute them (see src/whatsapp/buttons.js).
const send = require('../whatsapp/send');
const push = require('../push/push');
const { currentNumber } = require('../agent/context');

// The app creates these Android channels (mobile/App.js); a missing one falls back to 'default'.
const PUSH_CHANNEL = {
  reminder: 'reminders', event: 'reminders',
  brief: 'briefs', evening: 'briefs', pulse: 'briefs', weekly: 'briefs',
  nudge: 'nudges', goal: 'nudges',
};
const PUSH_TITLE = {
  reminder: 'Reminder', event: 'Starting soon', brief: 'Morning brief', evening: 'Evening brief',
  nudge: 'Blu', goal: 'One Big Thing', pulse: 'Tech pulse', weekly: 'Weekly review',
};

// Push when a registered device accepted it, otherwise WhatsApp. `attempted` is how many valid
// tokens the user had; zero accepted covers every token being dead as well as a failed request.
function chooseChannel(pushResult) {
  if (!pushResult || !pushResult.attempted) return 'whatsapp';
  if (pushResult.failed || pushResult.accepted === 0) return 'whatsapp';
  return 'push';
}

// Every proactive message goes through here: the app first, WhatsApp as the fallback, and the
// inbox always — written after sending, so it records the channel that actually delivered and a
// failed write can never delay a notification. Runs inside a user scope.
// See docs/superpowers/specs/2026-09-19-mobile-foundation-design.md.
async function deliver({ kind, title = null, text, whatsapp = null }) {
  const pushTitle = title || PUSH_TITLE[kind] || 'Blu';

  const pushResult = await push.sendPush(pushTitle, push.toPushText(text), {
    type: kind,
    channelId: PUSH_CHANNEL[kind] || 'default',
  }).catch(err => {
    console.error(`[Deliver] ${kind}: push threw:`, err.message);
    return { attempted: 0, accepted: 0, deadTokens: [], failed: true };
  });

  for (const token of pushResult.deadTokens) {
    await memory.removePushToken(token)
      .catch(err => console.error('[Deliver] token prune failed:', err.message));
  }

  let channel = chooseChannel(pushResult);
  if (channel === 'whatsapp') {
    const wa = whatsapp || { text };
    try {
      if (wa.buttons?.length) await send.sendButtonMessage(currentNumber(), wa.text, wa.buttons);
      else await send.sendMessage(currentNumber(), wa.text);
    } catch (err) {
      console.error(`[Deliver] ${kind}: no push and WhatsApp failed:`, err.message);
      channel = 'failed';
    }
  }

  await memory.saveInboxMessage({ kind, title: pushTitle, body: push.stripWhatsAppMarkup(text), channel })
    .catch(err => console.error('[Deliver] inbox write failed:', err.message));

  return channel;
}
```

Replace `deliverTodoReminder` and `deliverEventReminder` with:

```js
async function deliverTodoReminder(todo) {
  const { text, buttons } = formatTodoReminder(todo);
  return deliver({ kind: 'reminder', text, whatsapp: { text, buttons } });
}

async function deliverEventReminder(ev) {
  const { text, buttons } = formatEventReminder(ev);
  return deliver({ kind: 'event', text, whatsapp: { text, buttons } });
}
```

`formatEventReminder` returned a `pushText` field that is now unused, because `deliver()` derives the push copy. Remove its two lines:

```js
    // The push copy drops the WhatsApp bold markers, which would render literally.
    pushText: `Starting in ${minsAway} min: ${ev.title} at ${timeStr}`,
```

Add `deliver` and `chooseChannel` to the file's `module.exports` (keep every existing export).

- [ ] **Step 4: Update the `pushText` assertions**

In `test/delivery.test.js`, add near the other requires:

```js
const { toPushText } = require('../src/push/push');
```

and replace:

```js
  const { text, pushText } = formatEventReminder(ev, now);

  assert.ok(text.includes('*Review*'), 'WhatsApp copy keeps the emphasis');
  assert.ok(!pushText.includes('*'), 'push notifications render asterisks literally');
  assert.ok(pushText.includes('Review'));
```

with:

```js
  const { text } = formatEventReminder(ev, now);

  assert.ok(text.includes('*Review*'), 'WhatsApp copy keeps the emphasis');
  // The push copy is derived by deliver() (toPushText) rather than carried by the formatter.
  const pushed = toPushText(text);
  assert.ok(!pushed.includes('*'), 'push notifications render asterisks literally');
  assert.ok(pushed.includes('Review'));
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/deliver.test.js test/delivery.test.js`
Expected: PASS.

- [ ] **Step 6: Full suite, then commit**

Run: `npm test`, expecting all to pass. Then:

```bash
git add src/scheduler/delivery.js test/deliver.test.js test/delivery.test.js
git commit -m "feat: deliver proactive messages app-first with WhatsApp fallback"
```

---

### Task 5: Every cron and scheduled send goes through `deliver()`

**Files:**
- Modify: `api/cron/morning.js`, `evening.js`, `nudge.js`, `goal.js`, `pulse.js`, `weekly.js`
- Modify: `src/scheduler/briefs.js`
- Modify: `src/push/push.js` (remove the three now-unused wrappers)
- Test: `test/delivery.guard.test.js` (new)

**Interfaces:**
- Consumes: `deliver({ kind, title?, text, whatsapp? }) -> Promise<channel>` from `src/scheduler/delivery.js` (Task 4).
- Produces: cron responses now report the channel, e.g. `911: morning brief → push`. That's how production is checked in Task 11.

Message copy is unchanged, including goal.js's existing "Hermes checking in" wording.

- [ ] **Step 1: Write the failing guard test**

Create `test/delivery.guard.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/delivery.guard.test.js`
Expected: FAIL. It lists all six send crons and `src/scheduler/briefs.js`. (`reminder.js` already goes through `delivery.js`.)

- [ ] **Step 3: `api/cron/morning.js`**

Replace the import lines:

```js
const { forEachUser, currentNumber } = require('../../src/agent/context');
const { generateStandup, generateStaleAlert } = require('../../src/agent/brain');
const { sendMessage, sendButtonMessage } = require('../../src/whatsapp/send');
const { sendBriefPush } = require('../../src/push/push');
```

with:

```js
const { forEachUser } = require('../../src/agent/context');
const { generateStandup, generateStaleAlert } = require('../../src/agent/brain');
const { deliver } = require('../../src/scheduler/delivery');
```

Replace the body of `run` after the `skip` check (from `const myNumber = currentNumber();` to `return results;`) with:

```js
  const results = [];

  try {
    const standup = await generateStandup("generic");
    const channel = await deliver({ kind: 'brief', text: standup });
    results.push(`${user.wa_number}: morning brief → ${channel}`);
  } catch (err) {
    console.error('Morning brief error:', err.message);
    results.push(`${user.wa_number}: morning brief failed: ${err.message}`);
  }

  try {
    const alert = await generateStaleAlert();
    if (alert) {
      const channel = await deliver({
        kind: 'nudge', title: 'Stale todos', text: alert,
        whatsapp: { text: alert, buttons: [
          { id: 'stale_snooze', title: 'Snooze 2 days' },
          { id: 'stale_dismiss', title: 'Dismiss' },
        ] },
      });
      results.push(`${user.wa_number}: stale alert → ${channel}`);
    }
  } catch (err) {
    console.error('Stale alert error:', err.message);
    results.push(`${user.wa_number}: stale alert failed: ${err.message}`);
  }

  return results;
```

- [ ] **Step 4: `api/cron/evening.js`**

Replace the imports:

```js
const { forEachUser, currentNumber } = require('../../src/agent/context');
const { generateStandup } = require('../../src/agent/brain');
const { sendMessage, sendButtonMessage } = require('../../src/whatsapp/send');
```

with:

```js
const { forEachUser } = require('../../src/agent/context');
const { generateStandup } = require('../../src/agent/brain');
const { deliver } = require('../../src/scheduler/delivery');
```

Replace the body of `run` after the `skip` check (from `const myNumber = currentNumber();` to the `return`) with:

```js
  const standup = await generateStandup('smartresq');
  const channel = await deliver({ kind: 'evening', text: standup });

  const obt = "What's the *One Big Thing* you want to move tonight?";
  await deliver({
    kind: 'evening', title: 'One Big Thing', text: obt,
    whatsapp: { text: obt, buttons: [
      { id: 'obt_set', title: 'Set it now' },
      { id: 'obt_skip', title: 'Skip tonight' },
    ] },
  });
  return `${user.wa_number}: evening brief → ${channel}`;
```

- [ ] **Step 5: `api/cron/nudge.js`**

Replace the imports:

```js
const { forEachUser, currentNumber } = require('../../src/agent/context');
const { generateProactiveNudge } = require('../../src/agent/brain');
const { sendMessage } = require('../../src/whatsapp/send');
const { sendNudgePush } = require('../../src/push/push');
```

with:

```js
const { forEachUser } = require('../../src/agent/context');
const { generateProactiveNudge } = require('../../src/agent/brain');
const { deliver } = require('../../src/scheduler/delivery');
```

Replace:

```js
  await sendMessage(currentNumber(), nudge);
  await sendNudgePush(nudge.slice(0, 120));
  return `${user.wa_number}: nudge sent`;
```

with:

```js
  const channel = await deliver({ kind: 'nudge', text: nudge });
  return `${user.wa_number}: nudge → ${channel}`;
```

- [ ] **Step 6: `api/cron/goal.js`**

Replace the imports:

```js
const { forEachUser, currentNumber } = require('../../src/agent/context');
const memory = require('../../src/agent/memory');
const { sendMessage } = require('../../src/whatsapp/send');
```

with:

```js
const { forEachUser } = require('../../src/agent/context');
const memory = require('../../src/agent/memory');
const { deliver } = require('../../src/scheduler/delivery');
```

Replace:

```js
  await sendMessage(
    currentNumber(),
    `Hermes checking in: How's progress on the *One Big Thing*? (*${pendingGoal.content}*). Almost there?`
  );
  return `${user.wa_number}: goal nudge sent`;
```

with:

```js
  const channel = await deliver({
    kind: 'goal',
    text: `Hermes checking in: How's progress on the *One Big Thing*? (*${pendingGoal.content}*). Almost there?`,
  });
  return `${user.wa_number}: goal nudge → ${channel}`;
```

- [ ] **Step 7: `api/cron/pulse.js`**

Replace the imports:

```js
const { forEachUser, currentNumber } = require('../../src/agent/context');
const { generateTechPulse } = require('../../src/agent/brain');
const { sendMessage } = require('../../src/whatsapp/send');
```

with:

```js
const { forEachUser } = require('../../src/agent/context');
const { generateTechPulse } = require('../../src/agent/brain');
const { deliver } = require('../../src/scheduler/delivery');
```

Replace:

```js
  await sendMessage(currentNumber(), pulse);
  return `${user.wa_number}: pulse sent`;
```

with:

```js
  const channel = await deliver({ kind: 'pulse', text: pulse });
  return `${user.wa_number}: pulse → ${channel}`;
```

- [ ] **Step 8: `api/cron/weekly.js`**

Replace the imports:

```js
const { forEachUser, currentNumber } = require('../../src/agent/context');
const { generateWeeklyReview } = require('../../src/agent/brain');
const { sendMessage } = require('../../src/whatsapp/send');
```

with:

```js
const { forEachUser } = require('../../src/agent/context');
const { generateWeeklyReview } = require('../../src/agent/brain');
const { deliver } = require('../../src/scheduler/delivery');
```

Replace:

```js
  await sendMessage(currentNumber(), review);
  return `${user.wa_number}: weekly review sent`;
```

with:

```js
  const channel = await deliver({ kind: 'weekly', text: review });
  return `${user.wa_number}: weekly review → ${channel}`;
```

- [ ] **Step 9: `src/scheduler/briefs.js` (the Express path, kept in step with the crons)**

Change the import lines:

```js
const { sendMessage, sendButtonMessage, sendListMessage } = require('../whatsapp/send');
const { sendBriefPush, sendNudgePush } = require('../push/push');
```

to:

```js
const { sendListMessage } = require('../whatsapp/send');
```

and add `deliver` to the existing `require('./delivery')` line, so it reads:

```js
const { sweepDueReminders, deliver } = require('./delivery');
```

Then make these replacements:

Morning brief:

```js
      const standup = await generateStandup("generic");
      await sendMessage(currentNumber(), standup);
      await sendBriefPush('Morning Brief', 'Your day starts now. Tap to see context.');
```

becomes

```js
      const standup = await generateStandup("generic");
      await deliver({ kind: 'brief', text: standup });
```

Evening brief. The `setTimeout` only existed to order two WhatsApp messages, and sequential `await`s do that now:

```js
      const standup = await generateStandup("generic");
      await sendMessage(currentNumber(), standup);
      // Follow up with a goal-setting nudge after the brief arrives
      setTimeout(async () => {
        await sendButtonMessage(currentNumber(), "What's the *One Big Thing* you want to move tonight?", [
          { id: 'obt_set', title: "Set it now" },
          { id: 'obt_skip', title: "Skip tonight" },
        ]);
      }, 1500);
```

becomes

```js
      const standup = await generateStandup("generic");
      await deliver({ kind: 'evening', text: standup });
      const obt = "What's the *One Big Thing* you want to move tonight?";
      await deliver({
        kind: 'evening', title: 'One Big Thing', text: obt,
        whatsapp: { text: obt, buttons: [
          { id: 'obt_set', title: "Set it now" },
          { id: 'obt_skip', title: "Skip tonight" },
        ] },
      });
```

Stale alert:

```js
        await sendButtonMessage(currentNumber(), alert, [
          { id: 'stale_snooze', title: 'Snooze 2 days' },
          { id: 'stale_dismiss', title: 'Dismiss' },
        ]);
```

becomes

```js
        await deliver({
          kind: 'nudge', title: 'Stale todos', text: alert,
          whatsapp: { text: alert, buttons: [
            { id: 'stale_snooze', title: 'Snooze 2 days' },
            { id: 'stale_dismiss', title: 'Dismiss' },
          ] },
        });
```

Weekly review: `await sendMessage(currentNumber(), review);` becomes `await deliver({ kind: 'weekly', text: review });`

Nudge:

```js
        await sendMessage(currentNumber(), nudge);
        // Push a short version (notifications have limited space)
        await sendNudgePush(nudge.slice(0, 120));
```

becomes

```js
        await deliver({ kind: 'nudge', text: nudge });
```

Pulse: `if (pulse) await sendMessage(currentNumber(), pulse);` becomes `if (pulse) await deliver({ kind: 'pulse', text: pulse });`

Goal:

```js
        await sendMessage(currentNumber(), `Hermes checking in: How's progress on the **One Big Thing**? (*${pendingGoal.content}*). Almost there?`);
```

becomes

```js
        await deliver({ kind: 'goal', text: `Hermes checking in: How's progress on the **One Big Thing**? (*${pendingGoal.content}*). Almost there?` });
```

Then check for an orphaned import:

Run: `grep --line-number "currentNumber" src/scheduler/briefs.js`
If it appears only in its `require` line, remove `currentNumber` from that destructure (keep the others).

- [ ] **Step 10: Remove the push wrappers that no longer have callers**

Run: `grep -rn --include=*.js "sendReminderPush\|sendBriefPush\|sendNudgePush" src api`
Expected: matches only inside `src/push/push.js`. Then, in `src/push/push.js`, delete the functions `sendReminderPush`, `sendBriefPush` and `sendNudgePush` along with the `// Convenience wrappers for common notification types` comment above them, and change the export to:

```js
module.exports = { sendPush, isExpoPushToken, stripWhatsAppMarkup, toPushText };
```

- [ ] **Step 11: Run the guard and the full suite**

Run: `node --test test/delivery.guard.test.js`, expecting PASS.
Run: `npm test`, expecting all to pass.
Run: `node -e "for (const f of ['morning','evening','nudge','goal','pulse','weekly','reminder']) require('./api/cron/'+f); require('./src/scheduler/briefs'); console.log('all cron modules load')"`, expecting `all cron modules load`.

- [ ] **Step 12: Commit**

```bash
git add api/cron src/scheduler/briefs.js src/push/push.js test/delivery.guard.test.js
git commit -m "feat: route every scheduled message through deliver()"
```

---

### Task 6: App-facing routes: push registration, test push, chat thread

**Files:**
- Create: `src/agent/thread.js`
- Modify: `src/routes/dashboard.js` (three routes + imports)
- Test: `test/thread.test.js` (new)

**Interfaces:**
- Consumes: `memory.savePushToken(token)`, `memory.getThread(before, limit)` (Task 2); `isExpoPushToken`, `sendPush` from `src/push/push.js` (Task 3); `dashboardTokenMiddleware` (Task 1, already applied router-wide).
- Produces:
  - `parseThreadQuery(query) -> { before: string|null, limit: number }` (default 50, max 200, invalid → default/null)
  - `POST /dashboard/api/push/register` `{ token }` → `{ ok: true }`, or 400 if it isn't an Expo token
  - `POST /dashboard/api/push/test` → the `sendPush` result object
  - `GET /dashboard/api/messages?before=&limit=` → `{ messages: [{id, from, kind, text, created_at}] }`, newest first

**Where the spec's `/messages` tests live.** The spec asks for merge order, paging, the limit cap
and per-user scoping. Only the paging rules are pure, so only they get unit tests here. The rest
is SQL, which this repo covers the way it covers every other query rather than by standing up a
database in CI: merge order is checked against the real database in Task 2 Step 8, and scoping is
enforced for `getThread` by `test/schema.scoping.test.js`, which fails if the query does not
filter on `user_id`.

- [ ] **Step 1: Write the failing tests**

Create `test/thread.test.js`:

```js
// Query parsing for GET /dashboard/api/messages. The route is thin; this is the part with rules.

const test = require('node:test');
const assert = require('node:assert');
const { parseThreadQuery } = require('../src/agent/thread');

test('defaults to the 50 newest', () => {
  assert.deepStrictEqual(parseThreadQuery({}), { before: null, limit: 50 });
});

test('limit is capped at 200', () => {
  assert.strictEqual(parseThreadQuery({ limit: '5000' }).limit, 200);
});

test('a bad limit falls back to the default', () => {
  assert.strictEqual(parseThreadQuery({ limit: 'abc' }).limit, 50);
  assert.strictEqual(parseThreadQuery({ limit: '-3' }).limit, 50);
  assert.strictEqual(parseThreadQuery({ limit: '0' }).limit, 50);
});

test('before is normalised to ISO, and a bad date is ignored rather than sent to SQL', () => {
  assert.strictEqual(parseThreadQuery({ before: '2026-09-19T10:00:00Z' }).before, '2026-09-19T10:00:00.000Z');
  assert.strictEqual(parseThreadQuery({ before: 'not-a-date' }).before, null);
});

test('a missing query object is handled', () => {
  assert.deepStrictEqual(parseThreadQuery(undefined), { before: null, limit: 50 });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/thread.test.js`
Expected: FAIL. `Cannot find module '../src/agent/thread'`.

- [ ] **Step 3: Implement `src/agent/thread.js`**

```js
// Query parsing for the app's chat thread (GET /dashboard/api/messages). Pure, so the paging
// rules are tested without a database. The query itself is memory.getThread.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseThreadQuery(query = {}) {
  const q = query || {};
  const n = parseInt(q.limit, 10);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;

  const d = q.before ? new Date(q.before) : null;
  const before = d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;

  return { before, limit };
}

module.exports = { parseThreadQuery, DEFAULT_LIMIT, MAX_LIMIT };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/thread.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the routes**

In `src/routes/dashboard.js`, add `savePushToken, getThread` to the destructured `require('../agent/memory')` list, and add near the other requires:

```js
const { isExpoPushToken, sendPush } = require('../push/push');
const { parseThreadQuery } = require('../agent/thread');
```

Insert immediately after the closing `});` of the `router.get('/api/auth/verify', ...)` route:

```js

// ── The mobile app ───────────────────────────────────────────────────────────
// These live on this router, not under api/, because Vercel serves this Express app as one
// function: routes here cost no slot under the 12-function cap. Auth is the router-wide
// dashboardTokenMiddleware. See docs/superpowers/specs/2026-09-19-mobile-foundation-design.md.

// Registers this device for push. Only Expo tokens are accepted: a raw FCM token can never be
// delivered through Expo's push service, which is what the app used to fall back to.
router.post('/api/push/register', express.json(), async (req, res) => {
  const token = req.body?.token;
  if (!isExpoPushToken(token)) return res.status(400).json({ error: 'An Expo push token is required' });
  try {
    await savePushToken(token);
    res.json({ ok: true });
  } catch (err) {
    console.error('Push register error:', err.message);
    res.status(500).json({ error: 'Failed to register' });
  }
});

// Sends a test notification to the caller's devices and reports the outcome. Deliberately not
// via deliver(): a setup check must not quietly fall back to WhatsApp.
router.post('/api/push/test', async (req, res) => {
  try {
    res.json(await sendPush('Blu', 'Push notifications are working.', { type: 'test' }));
  } catch (err) {
    console.error('Push test error:', err.message);
    res.status(500).json({ error: 'Failed to send' });
  }
});

// The chat thread: conversation plus proactive messages, newest first.
router.get('/api/messages', async (req, res) => {
  const { before, limit } = parseThreadQuery(req.query);
  try {
    res.json({ messages: await getThread(before, limit) });
  } catch (err) {
    console.error('Thread error:', err.message);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});
```

- [ ] **Step 6: Full suite, and check the router still loads**

Run: `npm test`, expecting all to pass.
Run: `node -e "require('./src/routes/dashboard'); console.log('dashboard router loads')"`, expecting `dashboard router loads`.

- [ ] **Step 7: Commit**

```bash
git add src/agent/thread.js src/routes/dashboard.js test/thread.test.js
git commit -m "feat: app routes for push registration, test push and the chat thread"
```

- [ ] **Step 8: CHECKPOINT: deploy the server side**

Stop and ask Tarun before continuing: "Server side of A is done and tested. OK to merge `feat/mobile-foundation` into `master` and push, which deploys it?"

Why this is safe before the app exists: no device has a registered token, so `deliver()` falls back to WhatsApp for everything. The one visible change is that proactive messages are now also recorded in `inbox_messages`.

On approval:

```bash
git checkout master
git merge --no-ff feat/mobile-foundation -m "merge: server side of the mobile app foundation"
git push origin master
git checkout feat/mobile-foundation
```

Then wait for the deploy and verify in production, polling in the background until the anonymous request returns 401:

```bash
B=https://personal-agent-blond-beta.vercel.app
curl -s -o /dev/null -w "%{http_code}\n" "$B/dashboard/api/messages"          # expect 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$B/dashboard/api/push/register"  # expect 401
```

Then, authenticated, reading the owner's token from the database without printing it:

```bash
node -e "require('dotenv').config();const m=require('./src/agent/memory');m.rawQuery('SELECT dashboard_token FROM users WHERE wa_number=\$1',[process.env.MY_WHATSAPP_NUMBER]).then(async r=>{const t=r[0].dashboard_token;const B='https://personal-agent-blond-beta.vercel.app';const h={Authorization:'Bearer '+t};const a=await fetch(B+'/dashboard/api/messages?limit=3',{headers:h});console.log('messages',a.status,(await a.json()).messages?.length);const b=await fetch(B+'/dashboard/api/push/register',{method:'POST',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify({token:'not-an-expo-token'})});console.log('register(bad token)',b.status);process.exit(0)})"
```

Expected: `messages 200 3`, and `register(bad token) 400`.

---

### Task 7: A real app build: EAS project, Android package, Firebase

**Files:**
- Modify: `mobile/package.json` (via `npx expo install`)
- Modify: `mobile/app.json`
- Create: `mobile/app.config.js`
- Create: `mobile/eas.json`
- Modify: `.gitignore` (root)

**Interfaces:**
- Consumes: nothing from server tasks.
- Produces: an EAS project whose `projectId` is in `app.json` (`expo.extra.eas.projectId`, written by `eas init`), readable at runtime as `Constants.expoConfig.extra.eas.projectId` (Task 9); Android package `com.tarunsitaraman.blu`; build profiles `development` and `preview`.

- [ ] **Step 1: Install the native dependencies**

Run (from the repo root): `cd mobile && npx expo install expo-secure-store expo-dev-client expo-constants`
Expected: all three added to `mobile/package.json` with SDK 54-compatible versions.

- [ ] **Step 2: Set the Android package and remove the placeholder project id**

In `mobile/app.json`, delete the whole placeholder block (`eas init` writes the real one):

```json
    "extra": {
      "eas": {
        "projectId": "blu-mobile-local"
      }
    },
```

and add `"package": "com.tarunsitaraman.blu",` as the first key inside `"android": { ... }`.

- [ ] **Step 3: Keep `google-services.json` out of the public repo**

Create `mobile/app.config.js`:

```js
// google-services.json configures Firebase Cloud Messaging for this app. It stays out of git
// because the repository is public. EAS cloud builds receive it as a secret file environment
// variable (GOOGLE_SERVICES_JSON); local runs read the gitignored file beside this one.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
```

Append to the root `.gitignore`:

```
# Firebase config and the FCM service-account key — the repo is public (mobile foundation spec)
mobile/google-services.json
*firebase-adminsdk*.json
```

- [ ] **Step 4: Build profiles**

Create `mobile/eas.json`:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_BASE": "https://personal-agent-blond-beta.vercel.app" }
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_BASE": "https://personal-agent-blond-beta.vercel.app" }
    }
  }
}
```

The base URL is set here because EAS uploads the project without the gitignored `mobile/.env`, so a cloud build would otherwise have no base URL. It isn't a secret.

- [ ] **Step 5: CHECKPOINT (Tarun): sign in and create the EAS project**

Ask Tarun to run these himself with the `!` prefix, so the browser sign-in happens in his session:

1. Optional but recommended: `! npm install -g eas-cli` (the installed version is behind 24.3.0)
2. `! cd mobile && eas login --browser` opens expo.dev in the browser; sign in with Google.
3. `! cd mobile && eas init` creates the project and writes `expo.extra.eas.projectId` and `expo.owner` into `mobile/app.json`.

Then verify:

Run: `cd mobile && npx expo config --type public`
Expected: the output shows `package: 'com.tarunsitaraman.blu'`, a UUID `projectId` under `extra.eas`, and `googleServicesFile`.

- [ ] **Step 6: CHECKPOINT (Tarun): Firebase for push**

Ask Tarun to:
1. At console.firebase.google.com, create a project, then *Add app → Android* with package `com.tarunsitaraman.blu`, and download `google-services.json` into `mobile/`.
2. `! cd mobile && eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret --environment preview --environment development`
3. In Firebase: *Project settings → Service accounts → Generate new private key*. Then `! cd mobile && eas credentials`, choose *Android → Google Service Account → Manage your Google Service Account Key for Push Notifications (FCM V1)*, and upload that JSON. Keep the key file out of the repo (it's gitignored by pattern), and ideally delete it afterwards.

Verify the secret files are not tracked:

Run: `git status --short mobile/`
Expected: `google-services.json` does not appear.

- [ ] **Step 7: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json mobile/app.config.js mobile/eas.json .gitignore
git commit -m "feat: EAS build setup for the app, with Firebase config kept out of git"
```

---

### Task 8: App auth: token in secure storage, sent as a header

**Files:**
- Create: `mobile/auth.js`
- Create: `mobile/screens/TokenScreen.js`
- Modify: `mobile/api.js` (everything above `export const CTX_COLOR`)
- Modify: `mobile/App.js` (gate on sign-in)
- Modify: `mobile/.env.example`

**Interfaces:**
- Consumes: `GET /dashboard/api/auth/verify` (returns `{ ok: true, name }` or 401); Task 6's routes.
- Produces:
  - `auth.js`: `getToken() -> Promise<string|null>`, `setToken(token) -> Promise<void>`, `clearToken() -> Promise<void>`, `onSignedOut(fn) -> unsubscribe`
  - `api.js`: `verifyToken(token)`, `getStatus()`, `getTodos(context?)`, `completeTodo(content)`, `getEvents(context?)`, `getNotes(context?)`, `getLearnings()`, `chat(message) -> {reply}`, `getMessages(before?) -> Array<{id, from, kind, text, created_at}>` (newest first), `registerPushToken(token)`. The existing screens keep calling the same names.

`mobile/` has no test runner and adding one is out of scope (spec → Testing). Each app task is verified by bundling for Android, which catches import and syntax errors, and the final behaviour is checked on the device in Task 11.

- [ ] **Step 1: `mobile/auth.js`**

```js
// The dashboard token, held in Android's encrypted storage (expo-secure-store) instead of being
// compiled into the bundle. EXPO_PUBLIC_* values are inlined at build time, so a token read from
// one would ship inside the APK. See docs/superpowers/specs/2026-09-19-mobile-foundation-design.md.
import * as SecureStore from 'expo-secure-store';

const KEY = 'dashboard_token';
let cached;                    // undefined = not read yet; '' = none stored
const signedOutListeners = new Set();

export async function getToken() {
  if (cached === undefined) cached = (await SecureStore.getItemAsync(KEY)) || '';
  return cached || null;
}

export async function setToken(token) {
  await SecureStore.setItemAsync(KEY, token);
  cached = token;
}

// Called on a 401: the token was rotated or revoked. Listeners return the app to the token screen.
export async function clearToken() {
  await SecureStore.deleteItemAsync(KEY);
  cached = '';
  signedOutListeners.forEach(fn => fn());
}

export function onSignedOut(fn) {
  signedOutListeners.add(fn);
  return () => signedOutListeners.delete(fn);
}
```

- [ ] **Step 2: Replace the top of `mobile/api.js`**

Replace everything in `mobile/api.js` **above** the line `export const CTX_COLOR` with the following. Keep `CTX_COLOR`, `fmtTime`, `relTime` and everything after them unchanged.

```js
// Every request goes to the /dashboard router with the token in an Authorization header — never
// in the URL, where access logs record it. The token comes from secure storage (./auth), not from
// the build. EXPO_PUBLIC_API_BASE is only the server address, which is not a secret.
import { getToken, clearToken } from './auth';

const BASE = process.env.EXPO_PUBLIC_API_BASE;

if (!BASE) {
  // Fail loudly at import rather than sending requests to "undefined/dashboard/..." that look
  // like a server problem. Set it in mobile/.env locally; eas.json sets it for cloud builds.
  throw new Error('Missing EXPO_PUBLIC_API_BASE. Set it in mobile/.env (see mobile/.env.example).');
}

// `token` is passed explicitly only when checking a candidate on the token screen; then a 401
// just means "wrong token" and must not sign anyone out.
async function request(path, { method = 'GET', body, token } = {}) {
  const t = token || await getToken();
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && !token) {
    await clearToken();
    throw new Error('Signed out — the token was rejected');
  }
  if (!r.ok) throw new Error(`${method} ${path} failed (${r.status})`);
  return r.json();
}

const withContext = (path, context) => (context ? `${path}?context=${encodeURIComponent(context)}` : path);

export async function verifyToken(token) {
  return request('/dashboard/api/auth/verify', { token });
}

export async function getStatus() {
  return request('/dashboard/api/status');
}

export async function getTodos(context = null) {
  const d = await request(withContext('/dashboard/api/todos', context));
  return Array.isArray(d) ? d : (d.pending || []);
}

export async function completeTodo(content) {
  return request('/dashboard/api/complete-todo', { method: 'POST', body: { content } });
}

export async function getEvents(context = null) {
  return request(withContext('/dashboard/api/events', context));
}

export async function getNotes(context = null) {
  return request(withContext('/dashboard/api/notes', context));
}

export async function getLearnings() {
  return request('/dashboard/api/learnings');
}

export async function chat(message) {
  return request('/dashboard/chat', { method: 'POST', body: { message } });
}

// The chat thread, newest first: conversation plus proactive messages (briefs, reminders…).
export async function getMessages(before = null) {
  const d = await request(before
    ? `/dashboard/api/messages?before=${encodeURIComponent(before)}`
    : '/dashboard/api/messages');
  return d.messages || [];
}

export async function registerPushToken(token) {
  return request('/dashboard/api/push/register', { method: 'POST', body: { token } });
}

```

- [ ] **Step 3: `mobile/screens/TokenScreen.js`**

```js
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { verifyToken } from '../api';
import { setToken } from '../auth';
import { C, FONT } from '../theme';

// First launch, and whenever the server rejects the stored token. The token is checked against
// the server before it is stored, so a typo never gets saved.
export default function TokenScreen({ onSignedIn }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const connect = async () => {
    const token = value.trim();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyToken(token);
      await setToken(token);
      onSignedIn();
    } catch {
      setError("That token wasn't accepted. Check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.root}>
      <View style={s.body}>
        <Text style={s.title}>Connect to Blu</Text>
        <Text style={s.hint}>Paste your dashboard token. It is stored encrypted on this phone.</Text>
        <TextInput
          style={s.input}
          value={value}
          onChangeText={setValue}
          placeholder="Dashboard token"
          placeholderTextColor={C.t3}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          onSubmitEditing={connect}
        />
        {error ? <Text style={s.error}>{error}</Text> : null}
        <TouchableOpacity style={[s.btn, (!value.trim() || busy) && s.btnDisabled]} onPress={connect} disabled={!value.trim() || busy}>
          {busy ? <ActivityIndicator color="#000" /> : <Text style={s.btnText}>Connect</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 22, ...FONT.bold, color: C.t1 },
  hint: { fontSize: 13, ...FONT.regular, color: C.t2, lineHeight: 19 },
  input: {
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, color: C.t1, fontSize: 14, ...FONT.regular,
  },
  error: { fontSize: 13, ...FONT.medium, color: '#ff6b6b' },
  btn: { backgroundColor: C.hex, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontSize: 15, ...FONT.bold, color: '#000' },
});
```

- [ ] **Step 4: Gate the app on sign-in**

In `mobile/App.js`:

Change the React import to `import React, { useEffect, useRef, useState } from 'react';` and add below the other local imports:

```js
import TokenScreen from './screens/TokenScreen';
import { getToken, onSignedOut } from './auth';
```

Inside `export default function App() {`, before the existing `useEffect`, add:

```js
  // 'loading' until secure storage is read; the token screen until a valid token is stored.
  const [authState, setAuthState] = useState('loading');

  useEffect(() => {
    getToken().then(t => setAuthState(t ? 'signedIn' : 'signedOut'));
    return onSignedOut(() => setAuthState('signedOut'));
  }, []);
```

In the existing `useEffect`, remove the `setupPushNotifications();` line (Task 9 moves it so it runs only once signed in). Directly before `return (`, add:

```js
  if (authState === 'loading') return null;
  if (authState === 'signedOut') {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <TokenScreen onSignedIn={() => setAuthState('signedIn')} />
      </SafeAreaProvider>
    );
  }
```

- [ ] **Step 5: Update `mobile/.env.example`**

Replace its contents with:

```
# Copy to mobile/.env for local development. mobile/.env is gitignored.
# Expo inlines EXPO_PUBLIC_* into the bundle at build time, so restart the dev server after edits.
# Only the server address belongs here. The dashboard token is entered in the app on first launch
# and stored encrypted on the phone; anything EXPO_PUBLIC_ ships inside the APK.

# Production API base, no trailing slash. Cloud builds get it from eas.json instead.
EXPO_PUBLIC_API_BASE=https://personal-agent-blond-beta.vercel.app
```

- [ ] **Step 6: Verify the bundle builds and carries no token**

Run: `cd mobile && npx expo export --platform android --output-dir <scratchpad>/expo-export`, with `<scratchpad>` set to the session's scratchpad directory.
Expected: the export completes with no module-resolution errors.

Then confirm no credential is in it:

Run: `grep -rl "EXPO_PUBLIC_API_TOKEN" <scratchpad>/expo-export || echo "no token reference in bundle"`
Expected: `no token reference in bundle`.
If `mobile/.env` still has an `EXPO_PUBLIC_API_TOKEN=` value, also check that value doesn't appear in the bundle (grep for its first 12 characters), then tell Tarun he can delete that line from `mobile/.env`.

- [ ] **Step 7: Commit**

```bash
git add mobile/auth.js mobile/api.js mobile/screens/TokenScreen.js mobile/App.js mobile/.env.example
git commit -m "feat: app keeps its token in secure storage and sends it as a header"
```

---

### Task 9: Push registration that can actually deliver, and tapping opens Chat

**Files:**
- Modify: `mobile/App.js`

**Interfaces:**
- Consumes: `registerPushToken(token)` (Task 8); `Constants.expoConfig.extra.eas.projectId` (Task 7); the `authState` gate (Task 8).
- Produces: a device registered with an Expo push token after sign-in. A notification tap opens the Chat tab, both when the app is running and on a cold start.

- [ ] **Step 1: Replace the push setup**

In `mobile/App.js`, add the imports:

```js
import Constants from 'expo-constants';
import { createNavigationContainerRef } from '@react-navigation/native';
```

Replace the `Notifications.setNotificationHandler({...})` call with the current field names:

```js
// Show notifications as banners even when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const navigationRef = createNavigationContainerRef();

// Any notification tap opens the thread, where the full message is. The newest message is at the
// bottom and Chat scrolls there on load, so a just-delivered one is what you land on.
function openChat() {
  if (navigationRef.isReady()) navigationRef.navigate('Chat');
}
```

In `setupPushNotifications`, replace:

```js
  const tokenData = await Notifications.getExpoPushTokenAsync().catch(() =>
    Notifications.getDevicePushTokenAsync()
  );
  const token = tokenData?.data;
  if (token) await registerPushToken(token).catch(e => console.warn('[Push] Register failed:', e.message));
```

with:

```js
  // The Expo push service needs an Expo token, which needs the EAS project id. The old code
  // called this without one and fell back to a raw FCM device token that Expo can never deliver to.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn('[Push] No EAS projectId — run `eas init` in mobile/');
    return;
  }
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushToken(token);
  } catch (e) {
    console.warn('[Push] Registration failed:', e.message);
  }
```

- [ ] **Step 2: Register once signed in; handle taps**

In `App()`, replace the existing `useEffect` (the one adding the two notification listeners) with:

```js
  // Register for push once signed in; re-registering on each launch is harmless (idempotent).
  useEffect(() => {
    if (authState === 'signedIn') setupPushNotifications();
  }, [authState]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(n => {
      console.log('[Push] Received:', n.request.content.title);
    });
    const tapped = Notifications.addNotificationResponseReceivedListener(() => openChat());
    return () => {
      received.remove();
      tapped.remove();
    };
  }, []);
```

Remove the now-unused `const notifListener = useRef();` and `const responseListener = useRef();` lines. If `useRef` is then unused, remove it from the React import.

Give the `NavigationContainer` the ref, and handle a tap that launched the app from a cold start:

```jsx
      <NavigationContainer
        theme={NAV_THEME}
        ref={navigationRef}
        onReady={() => {
          Notifications.getLastNotificationResponseAsync()
            .then(r => { if (r) openChat(); })
            .catch(() => {});
        }}
      >
```

- [ ] **Step 3: Verify the bundle**

Run: `cd mobile && npx expo export --platform android --output-dir <scratchpad>/expo-export`
Expected: completes without errors. (Actually receiving a push is verified on the device in Task 11.)

- [ ] **Step 4: Commit**

```bash
git add mobile/App.js
git commit -m "feat: register a deliverable Expo push token and open Chat on tap"
```

---

### Task 10: The chat thread shows history, including proactive messages

**Files:**
- Modify: `mobile/screens/ChatScreen.js`

**Interfaces:**
- Consumes: `getMessages()` → newest-first `{id, from, kind, text, created_at}`; `chat(message)` → `{ reply }` (Task 8).
- Produces: the Chat screen loads the thread whenever it gains focus (so a notification tap shows the new message), shows each message's own time, and marks proactive messages visually.

- [ ] **Step 1: Load and render the thread**

In `mobile/screens/ChatScreen.js`:

Change the React import to add `useEffect`:
`import React, { useState, useRef, useCallback, useEffect } from 'react';`

Add:

```js
import { useFocusEffect } from '@react-navigation/native';
```

Change `import { chat } from '../api';` to `import { chat, getMessages } from '../api';`

Replace `const INITIAL = [...]` with:

```js
const GREETING = { id: 'greeting', role: 'blu', kind: 'chat', text: "Hey, I'm Blu. What's on your mind?", created_at: null };

// Labels for proactive messages, which render distinctly from replies.
const KIND_LABEL = {
  reminder: 'Reminder', event: 'Starting soon', brief: 'Morning brief', evening: 'Evening brief',
  nudge: 'Nudge', goal: 'One Big Thing', pulse: 'Tech pulse', weekly: 'Weekly review',
};

// Server rows are newest-first; the list renders oldest-first like any chat.
function toItems(rows) {
  return rows.slice().reverse().map(r => ({
    id: r.id,
    role: r.from === 'me' ? 'user' : 'blu',
    kind: r.kind,
    text: r.text,
    created_at: r.created_at,
  }));
}
```

Change `useState(INITIAL)` to `useState([GREETING])`, and add after the `listRef` line:

```js
  // Reload on every focus: a notification tap lands here, and the message it announced must be
  // in the list. The newest message is at the bottom, so scroll there once loaded.
  useFocusEffect(useCallback(() => {
    let alive = true;
    getMessages()
      .then(rows => {
        if (!alive) return;
        setMessages(rows.length ? toItems(rows) : [GREETING]);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
      })
      .catch(() => {}); // keep whatever is on screen; a transient failure should not blank it
    return () => { alive = false; };
  }, []));
```

In `send`, give the new messages timestamps. Change:

```js
    const userMsg = { id: Date.now().toString(), role: 'user', text };
```

to:

```js
    const userMsg = { id: Date.now().toString(), role: 'user', kind: 'chat', text, created_at: new Date().toISOString() };
```

and:

```js
      const bluMsg = { id: (Date.now() + 1).toString(), role: 'blu', text: d.reply || '…' };
```

to:

```js
      const bluMsg = { id: (Date.now() + 1).toString(), role: 'blu', kind: 'chat', text: d.reply || '…', created_at: new Date().toISOString() };
```

Replace `renderItem` with:

```js
  const renderItem = ({ item }) => {
    const isUser = item.role === 'user';
    const proactive = !isUser && item.kind && item.kind !== 'chat';
    // Each message's own time; the old code rendered new Date() for every message.
    const time = item.created_at
      ? new Date(item.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : '';
    return (
      <View style={[s.msgWrap, isUser ? s.msgRight : s.msgLeft]}>
        {proactive ? <Text style={s.kindLabel}>{KIND_LABEL[item.kind] || 'Update'}</Text> : null}
        <View style={[s.bubble, isUser ? s.bubbleUser : s.bubbleBlu, proactive && s.bubbleProactive]}>
          <Text style={[s.bubbleText, isUser && s.bubbleTextUser]}>{item.text}</Text>
        </View>
        {time ? <Text style={[s.msgTime, isUser && { textAlign: 'right' }]}>{time}</Text> : null}
      </View>
    );
  };
```

Add two entries to the `StyleSheet.create({ ... })` object:

```js
  kindLabel: { fontSize: 10, ...FONT.bold, color: C.per, letterSpacing: 0.5, textTransform: 'uppercase', paddingHorizontal: 2 },
  bubbleProactive: { borderColor: C.per },
```

If `useEffect` ends up unused after these edits, remove it from the React import.

- [ ] **Step 2: Verify the bundle**

Run: `cd mobile && npx expo export --platform android --output-dir <scratchpad>/expo-export`
Expected: completes without errors.

- [ ] **Step 3: Commit**

```bash
git add mobile/screens/ChatScreen.js
git commit -m "feat: chat shows the full thread, including briefs and reminders"
```

---

### Task 11: Build, install, and verify on the phone

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything above, deployed (Task 6 checkpoint) and built.
- Produces: evidence for each success criterion in the spec.

- [ ] **Step 1: Check Android 16 targeting and edge-to-edge support**

Run: `cd mobile && npx expo prebuild --platform android --no-install --clean`
Then: `grep --line-number "targetSdkVersion\|compileSdkVersion" mobile/android/build.gradle mobile/android/gradle.properties`
Expected: `targetSdkVersion` is 36 (Android 16). If it's lower, stop and report: the fix is `expo-build-properties` with `android.targetSdkVersion: 36`, and that needs Tarun's decision.
Then remove the generated folder, since this stays a managed-workflow app: `rm -rf mobile/android`, and confirm `git status --short mobile/` shows no `android/`.

- [ ] **Step 2: CHECKPOINT (Tarun): build and install**

Ask Tarun to run `! cd mobile && eas build --profile preview --platform android`, and when it finishes, install the APK from the link or QR code EAS prints. Open the app, paste the dashboard token, and allow notifications.

If he needs the token, print it for him, since it's his own credential:

```bash
node -e "require('dotenv').config();const m=require('./src/agent/memory');m.rawQuery('SELECT dashboard_token FROM users WHERE wa_number=\$1',[process.env.MY_WHATSAPP_NUMBER]).then(r=>{console.log(r[0].dashboard_token);process.exit(0)})"
```

- [ ] **Step 3: The device registered**

```bash
node -e "require('dotenv').config();const m=require('./src/agent/memory');const{withOwner}=require('./src/agent/context');const{isExpoPushToken}=require('./src/push/push');withOwner(async()=>{const t=await m.getPushTokens();console.log('tokens:',t.length,'valid Expo tokens:',t.filter(isExpoPushToken).length)}).then(()=>process.exit(0))"
```

Expected: at least one valid Expo token.

- [ ] **Step 4: A test push arrives**

Call `POST /dashboard/api/push/test` with the owner token (same method as the Task 6 checkpoint). Expected response: `{"attempted":1,"accepted":1,"deadTokens":[],"failed":false}` or similar, and the notification "Push notifications are working." appears on the phone.

- [ ] **Step 5: A reminder arrives in the app and not on WhatsApp**

Ask Tarun to send in the app's Chat: "remind me to test the app in 1 minute". After 70 seconds, trigger the reminder sweep (it normally runs every 15 minutes):

```bash
node -e "require('dotenv').config();fetch('https://personal-agent-blond-beta.vercel.app/api/cron/reminder',{headers:{Authorization:'Bearer '+process.env.CRON_SECRET}}).then(async r=>{console.log(r.status,JSON.stringify(await r.json()))})"
```

(If `CRON_SECRET` isn't in the local `.env`, ask Tarun for it or to add it.)
Expected: the phone shows a "Reminder" notification, **no** WhatsApp message arrives, and tapping it opens Chat with the reminder labelled in the thread. Confirm the recorded channel:

```bash
node -e "require('dotenv').config();const m=require('./src/agent/memory');const{withOwner}=require('./src/agent/context');withOwner(async()=>{const r=await m.rawQuery('SELECT kind,channel,created_at FROM inbox_messages WHERE user_id=\$1 ORDER BY created_at DESC LIMIT 3',[require('./src/agent/context').currentUserId()]);console.table(r)}).then(()=>process.exit(0))"
```

Expected: the newest row is `reminder | push`.

- [ ] **Step 6: The full brief is readable in the app**

With Tarun's OK (it sends him a brief now), trigger the morning cron:

```bash
node -e "require('dotenv').config();fetch('https://personal-agent-blond-beta.vercel.app/api/cron/morning',{headers:{Authorization:'Bearer '+process.env.CRON_SECRET}}).then(async r=>console.log(r.status,JSON.stringify(await r.json())))"
```

Expected: the response contains `morning brief → push`, the notification shows the start of the actual brief (not "Tap to see context"), and the full brief is in the Chat thread.

- [ ] **Step 7: Screens respect the system bars**

Ask Tarun to check each tab: headers and the tab bar must not sit under the status bar or the gesture bar. Report any screen that does.

- [ ] **Step 8: Fallback after uninstall**

Ask Tarun to uninstall the app, then repeat Step 5's reminder with the sweep trigger. Expected: once Expo reports the token as `DeviceNotRegistered`, the reminder arrives on **WhatsApp** and the token count from Step 3 drops. This may take more than one send: Expo sometimes reports an uninstall only in the delayed receipts, not the first ticket (the spec's accepted risk). Report which send it took. Then reinstall the APK.

- [ ] **Step 9: Eval unchanged**

Run: `npm run eval`
Expected: 23/23. Nothing in A touches classification.

Record the results of Steps 3–9 for the Task 12 documentation.

---

### Task 12: Retire the duplicate endpoints; update the docs

**Files:**
- Delete: `api/chat.js`, `api/todos.js`, `test/api.auth.test.js`
- Modify: `src/agent/dashboardAuth.js` (remove `withDashboardUser`)
- Modify: `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: Task 11's verification that the app works on `/dashboard`.
- Produces: 9 function files in `api/` (down from 11).

- [ ] **Step 1: Confirm nothing else calls the old endpoints**

Run: `grep -rn --include=*.js "/api/chat\|/api/todos" src mobile public 2>/dev/null`
Expected: no matches. (The new app uses `/dashboard/chat` and `/dashboard/api/todos`.) If there are matches, stop and report them.

- [ ] **Step 2: Remove them**

```bash
git rm api/chat.js api/todos.js test/api.auth.test.js
```

In `src/agent/dashboardAuth.js`, delete the `withDashboardUser` function and its comment block, and change the export to:

```js
module.exports = { tokenFrom, dashboardTokenMiddleware };
```

Update the file's header comment so it describes `dashboardTokenMiddleware` as the single auth for the `/dashboard` router, and drop the references to `api/todos.js` and `api/chat.js`. Keep the paragraph recording the `undefined === undefined` bypass, because that lesson still applies.

If `runAsUser` is still used (by `dashboardTokenMiddleware`), keep its require.

- [ ] **Step 3: Tests and function count**

Run: `npm test`, expecting all to pass. `test/dashboardAuth.test.js` keeps covering the header, query, missing and unknown-token cases that `api.auth.test.js` covered.
Run: `ls api/*.js api/cron/*.js | wc -l`, expecting `9`.

- [ ] **Step 4: Correct `CLAUDE.md`**

In the Architecture section, replace:

```
An always-on Express variant (`src/server.js` + node-cron) implements the same agent and is
still maintained in-tree. It is not currently deployed, but it is the only path that delivers
reminders to the second (`src/scheduler/timers.js`).
```

with:

```
The Express app (`src/server.js`) is ALSO deployed: `vercel.json` sets `"framework": "express"`,
so Vercel builds it as one function and serves it for every path outside `/api` — `/dashboard/*`
is live, and it is the mobile app's entire API. Express routes mounted under `/api` are shadowed
by the `api/` directory and 404. What is not deployed is the always-on process around it
(node-cron, `src/scheduler/timers.js`), which is still the only path that delivers reminders to
the second.
```

Under `## Known issues / in flight`, immediately before `### Ops`, insert a `### Resolved 2026-09-19 (mobile app foundation)` entry. It records: proactive messages now go app-first through `deliver()` with WhatsApp as the fallback and every one in `inbox_messages`; the app authenticates with a header token from secure storage; the app's routes live on `/dashboard`; `api/chat.js` and `api/todos.js` were retired (9 functions now); and the Task 11 results, including which send the uninstall fallback took. Link the spec and this plan.

- [ ] **Step 5: README**

Add a `### Mobile app` section under Operations covering: EAS setup (`eas login --browser`, `eas init`), the Firebase steps from Task 7, `eas build --profile preview --platform android`, entering the token in the app, and checking push with `POST /dashboard/api/push/test`.

- [ ] **Step 6: Commit**

```bash
git add -A api src/agent/dashboardAuth.js CLAUDE.md README.md
git commit -m "chore: retire /api/chat and /api/todos now the app uses /dashboard"
```

- [ ] **Step 7: CHECKPOINT: merge and deploy**

Ask Tarun before merging `feat/mobile-foundation` into `master` and pushing. After deploy, verify:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://personal-agent-blond-beta.vercel.app/api/chat    # expect 404
```

and that the installed app still loads Chat and Todos.

---

## Verification Checklist (all tasks complete)

- [ ] `npm test`: all pass
- [ ] `npm run eval`: 23/23
- [ ] `ls api/*.js api/cron/*.js | wc -l` → 9
- [ ] `git status`: clean; `mobile/google-services.json` and `mobile/android/` not tracked
- [ ] A reminder arrives as an app notification, not on WhatsApp, and is in the Chat thread
- [ ] The morning brief's full text is readable in the app
- [ ] After uninstalling, a reminder falls back to WhatsApp and the dead token is removed
- [ ] The app bundle contains no token
