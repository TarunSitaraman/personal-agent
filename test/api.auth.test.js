// The Vercel data endpoints must reject anyone without a valid per-user dashboard token.
//
// Regression: api/todos.js and api/chat.js compared the request token against the retired shared
// DASHBOARD_TOKEN. Production no longer sets that variable, so a request with no token at all
// compared undefined === undefined and passed. Found 2026-09-19: an anonymous GET /api/todos
// returned the owner's todos, and /api/chat — which runs the full agent as the owner — was open
// the same way. Invisible locally, because the local .env still set the old token.
//
// These tests unset DASHBOARD_TOKEN to reproduce the production environment.

const test = require('node:test');
const assert = require('node:assert');

const memory = require('../src/agent/memory');
const brain = require('../src/agent/brain');
const { currentUserId } = require('../src/agent/context');

const todosHandler = require('../api/todos');
const chatHandler = require('../api/chat');

const ALICE = { id: 'aaaaaaaa-0000-0000-0000-000000000001', wa_number: '911', active: true };

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  res.sendStatus = code => { res.statusCode = code; return res; };
  return res;
}

const savedToken = process.env.DASHBOARD_TOKEN;
test.beforeEach(() => { delete process.env.DASHBOARD_TOKEN; });
test.afterEach(() => {
  test.mock.restoreAll();
  if (savedToken !== undefined) process.env.DASHBOARD_TOKEN = savedToken;
});

// ── The bypass itself ────────────────────────────────────────────────────────

test('todos rejects a request with no token when DASHBOARD_TOKEN is unset', async () => {
  const reads = [];
  test.mock.method(memory, 'getPendingTodos', async () => { reads.push(1); return []; });
  const res = fakeRes();

  await todosHandler({ method: 'GET', headers: {}, query: {} }, res);

  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(reads.length, 0, 'no data may be read without a token');
});

test('chat rejects a request with no token when DASHBOARD_TOKEN is unset', async () => {
  const calls = [];
  test.mock.method(brain, 'handleIncoming', async () => { calls.push(1); return 'hi'; });
  const res = fakeRes();

  await chatHandler({ method: 'POST', headers: {}, query: {}, body: { message: 'list my todos' } }, res);

  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(calls.length, 0, 'the agent must not run for an anonymous request');
});

// ── Per-user tokens ──────────────────────────────────────────────────────────

test('a token that matches no user is rejected', async () => {
  test.mock.method(memory, 'getUserByDashboardToken', async () => null);
  const res = fakeRes();

  await todosHandler({ method: 'GET', headers: { authorization: 'Bearer nope' }, query: {} }, res);

  assert.strictEqual(res.statusCode, 401);
});

test('the retired shared token no longer grants access', async () => {
  // If a leftover DASHBOARD_TOKEN value leaked anywhere, it must not still open the endpoints.
  process.env.DASHBOARD_TOKEN = 'old-shared-token';
  test.mock.method(memory, 'getUserByDashboardToken', async () => null);
  const res = fakeRes();

  await todosHandler({ method: 'GET', headers: { authorization: 'Bearer old-shared-token' }, query: {} }, res);

  assert.strictEqual(res.statusCode, 401);
});

test('a valid header token serves that user, inside their scope', async () => {
  test.mock.method(memory, 'getUserByDashboardToken', async t => (t === 'alice-token' ? ALICE : null));
  let scopedAs = null;
  test.mock.method(memory, 'getPendingTodos', async () => { scopedAs = currentUserId(); return []; });
  const res = fakeRes();

  await todosHandler({ method: 'GET', headers: { authorization: 'Bearer alice-token' }, query: {} }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(scopedAs, ALICE.id, 'data must be read as the token holder');
});

test('chat runs the agent as the token holder', async () => {
  test.mock.method(memory, 'getUserByDashboardToken', async () => ALICE);
  let scopedAs = null;
  test.mock.method(brain, 'handleIncoming', async () => { scopedAs = currentUserId(); return 'ok'; });
  const res = fakeRes();

  await chatHandler({ method: 'POST', headers: { authorization: 'Bearer alice-token' }, query: {}, body: { message: 'hi' } }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { reply: 'ok' });
  assert.strictEqual(scopedAs, ALICE.id);
});

test('the query-string token still works, for the current mobile app', async () => {
  // mobile/api.js sends ?token= on its data paths. Kept so the fix does not break the app; moving
  // the app to the Authorization header is the follow-up (query strings land in access logs).
  test.mock.method(memory, 'getUserByDashboardToken', async () => ALICE);
  test.mock.method(memory, 'getPendingTodos', async () => []);
  const res = fakeRes();

  await todosHandler({ method: 'GET', headers: {}, query: { token: 'alice-token' } }, res);

  assert.strictEqual(res.statusCode, 200);
});
