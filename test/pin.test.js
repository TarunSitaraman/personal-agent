const test = require('node:test');
const assert = require('node:assert');
const { checkPin, hashPin, verifyPin, normalizeNumber, afterFailure, isLocked, MAX_FAILURES, LOCK_MS } = require('../src/agent/pin');

test('a PIN is exactly six digits and not an obvious one', () => {
  assert.strictEqual(checkPin('482915').ok, true);
  for (const bad of ['12345', '1234567', 'abcdef', '12 345', '', null, 482915]) {
    assert.strictEqual(checkPin(bad).ok, false, String(bad));
  }
  for (const weak of ['000000', '111111', '123456', '654321', '121212']) {
    const r = checkPin(weak);
    assert.strictEqual(r.ok, false, weak);
    assert.match(r.error, /easy to guess/);
  }
});

test('hashes are salted scrypt and verify only the right PIN', async () => {
  const a = await hashPin('482915');
  const b = await hashPin('482915');
  assert.match(a, /^scrypt\$\d+\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notStrictEqual(a, b, 'two hashes of one PIN must differ (random salt)');
  assert.strictEqual(await verifyPin('482915', a), true);
  assert.strictEqual(await verifyPin('482916', a), false);
});

test('verifyPin refuses anything that is not a stored hash', async () => {
  for (const stored of [null, '', 'plaintext', 'scrypt$x$y$z', 'bcrypt$1$aa$bb']) {
    assert.strictEqual(await verifyPin('482915', stored), false, String(stored));
  }
});

test('phone numbers normalise to E.164 digits without +, as wa_number stores them', () => {
  assert.strictEqual(normalizeNumber('+91 93247 91556'), '919324791556');
  assert.strictEqual(normalizeNumber('9324791556'), '919324791556'); // a bare Indian mobile
  assert.strictEqual(normalizeNumber('0091-9324791556'), '919324791556');
  assert.strictEqual(normalizeNumber('+1 (415) 555-0100'), '14155550100');
  assert.strictEqual(normalizeNumber('12345'), null);
  assert.strictEqual(normalizeNumber(''), null);
  assert.strictEqual(normalizeNumber(null), null);
});

test('five wrong PINs lock the account for fifteen minutes; success clears the count', () => {
  const now = new Date('2026-09-22T12:00:00Z');
  let st = { failures: 0, lockedUntil: null };
  for (let i = 1; i < MAX_FAILURES; i++) {
    st = afterFailure(st.failures, now);
    assert.strictEqual(st.failures, i);
    assert.strictEqual(st.lockedUntil, null);
  }
  st = afterFailure(st.failures, now);
  assert.strictEqual(st.failures, 0, 'the counter resets when the lock starts');
  assert.strictEqual(st.lockedUntil.getTime(), now.getTime() + LOCK_MS);
  assert.ok(st.justLocked);
  assert.ok(isLocked(st.lockedUntil, now));
  assert.ok(!isLocked(st.lockedUntil, new Date(now.getTime() + LOCK_MS + 1)));
  assert.ok(!isLocked(null, now));
});
