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
