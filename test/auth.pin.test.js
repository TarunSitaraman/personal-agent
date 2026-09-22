const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { makeAuthRouter } = require('../src/routes/auth');
const { hashPin } = require('../src/agent/pin');

const NUMBER = '919324791556';

async function harness({ user, allowed = [NUMBER] } = {}) {
  const users = new Map();
  if (user) users.set(user.wa_number, { pin_failures: 0, pin_locked_until: null, active: true, ...user });
  const alerts = [];
  const deps = {
    memory: {
      getUserAuthByNumber: async n => (users.has(n) ? { ...users.get(n) } : null),
      recordPinAttempt: async (id, failures, lockedUntil) => {
        for (const u of users.values()) if (u.id === id) Object.assign(u, { pin_failures: failures, pin_locked_until: lockedUntil });
      },
      setUserPinHash: async (id, h) => { for (const u of users.values()) if (u.id === id) u.pin_hash = h; },
      createUser: async n => {
        const u = { id: 'u-new', wa_number: n, name: null, active: true, dashboard_token: 'tok-new', pin_failures: 0, pin_locked_until: null };
        users.set(n, u);
        return u;
      },
    },
    isAllowed: n => allowed.includes(n),
    runAsUser: (u, fn) => fn(),
    deliver: async msg => { alerts.push(msg); },
  };
  const app = express();
  app.use(express.json());
  app.use('/auth', makeAuthRouter(deps));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { post, users, alerts, close: () => server.close() };
}

test('the right number and PIN return the account token', async () => {
  const h = await harness({ user: { id: 'u1', wa_number: NUMBER, name: 'Tarun', dashboard_token: 'tok-1', pin_hash: await hashPin('482915') } });
  try {
    const r = await h.post('/auth/pin/signin', { number: '93247 91556', pin: '482915' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body, { token: 'tok-1', name: 'Tarun' });
  } finally { h.close(); }
});

test('wrong PIN, unknown number and no-PIN-yet all get the same answer', async () => {
  const h = await harness({ user: { id: 'u1', wa_number: NUMBER, dashboard_token: 'tok-1', pin_hash: await hashPin('482915') } });
  try {
    const wrong = await h.post('/auth/pin/signin', { number: NUMBER, pin: '482916' });
    const unknown = await h.post('/auth/pin/signin', { number: '919999999999', pin: '482915' });
    assert.strictEqual(wrong.status, 401);
    assert.strictEqual(unknown.status, 401);
    assert.deepStrictEqual(wrong.body, unknown.body);
    h.users.get(NUMBER).pin_hash = null;
    const noPin = await h.post('/auth/pin/signin', { number: NUMBER, pin: '482915' });
    assert.deepStrictEqual(noPin.body, unknown.body);
  } finally { h.close(); }
});

test('the fifth wrong PIN locks the account, alerts its owner, and refuses even the right PIN', async () => {
  const h = await harness({ user: { id: 'u1', wa_number: NUMBER, dashboard_token: 'tok-1', pin_hash: await hashPin('482915') } });
  try {
    for (let i = 0; i < 5; i++) await h.post('/auth/pin/signin', { number: NUMBER, pin: '000001' });
    assert.ok(h.users.get(NUMBER).pin_locked_until, 'locked');
    assert.strictEqual(h.alerts.length, 1);
    assert.match(h.alerts[0].text, /5 wrong PINs/);
    const r = await h.post('/auth/pin/signin', { number: NUMBER, pin: '482915' });
    assert.strictEqual(r.status, 423);
    assert.match(r.body.error, /locked/i);
  } finally { h.close(); }
});

test('a correct PIN clears earlier failures', async () => {
  const h = await harness({ user: { id: 'u1', wa_number: NUMBER, dashboard_token: 'tok-1', pin_hash: await hashPin('482915') } });
  try {
    await h.post('/auth/pin/signin', { number: NUMBER, pin: '000001' });
    assert.strictEqual(h.users.get(NUMBER).pin_failures, 1);
    await h.post('/auth/pin/signin', { number: NUMBER, pin: '482915' });
    assert.strictEqual(h.users.get(NUMBER).pin_failures, 0);
  } finally { h.close(); }
});

test('sign-up is invite-only: an allowed new number gets an account and a PIN', async () => {
  const h = await harness({ allowed: ['918888888888'] });
  try {
    const denied = await h.post('/auth/pin/signup', { number: '917777777777', pin: '482915' });
    assert.strictEqual(denied.status, 403);
    assert.match(denied.body.error, /invite-only/);
    const ok = await h.post('/auth/pin/signup', { number: '8888888888', pin: '482915' });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual(ok.body.token, 'tok-new');
    assert.ok(h.users.get('918888888888').pin_hash.startsWith('scrypt$'));
  } finally { h.close(); }
});

test('sign-up never takes over an existing account, and refuses weak PINs', async () => {
  const h = await harness({ user: { id: 'u1', wa_number: NUMBER, dashboard_token: 'tok-1', pin_hash: null } });
  try {
    const taken = await h.post('/auth/pin/signup', { number: NUMBER, pin: '482915' });
    assert.strictEqual(taken.status, 409);
    assert.strictEqual(h.users.get(NUMBER).pin_hash, null, 'existing account untouched');
    const weak = await h.post('/auth/pin/signup', { number: NUMBER, pin: '123456' });
    assert.strictEqual(weak.status, 400);
  } finally { h.close(); }
});

test('malformed requests are rejected before any lookup', async () => {
  const h = await harness();
  try {
    assert.strictEqual((await h.post('/auth/pin/signin', { number: 'abc', pin: '482915' })).status, 400);
    assert.strictEqual((await h.post('/auth/pin/signin', { number: NUMBER, pin: '12' })).status, 400);
  } finally { h.close(); }
});
