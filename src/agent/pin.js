// Six-digit PIN sign-in for the app: the rules, the hashing and the lockout, kept pure so they
// are tested without a database. The PIN is never stored — only a salted scrypt hash — and a
// correct PIN returns the account's existing dashboard token, so the rest of the app's auth is
// unchanged. Routes: src/routes/auth.js.
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const N = 16384; // scrypt cost; ~50 ms per check, which also slows guessing
const KEYLEN = 64;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

// A PIN that is one digit repeated, a straight run, or a repeated pair is the first thing anyone
// tries; refuse it at setup rather than protect it with a lockout.
function isObvious(pin) {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return true;
  if (/^(\d\d)\1\1$/.test(pin)) return true;
  return false;
}

function checkPin(pin) {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return { ok: false, error: 'A PIN is exactly six digits.' };
  if (isObvious(pin)) return { ok: false, error: 'That PIN is too easy to guess. Pick six digits without a pattern.' };
  return { ok: true };
}

async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pin, salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPin(pin, stored) {
  if (typeof pin !== 'string' || typeof stored !== 'string') return false;
  const m = /^scrypt\$(\d+)\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(stored);
  if (!m) return false;
  const expected = Buffer.from(m[3], 'hex');
  const actual = await scrypt(pin, Buffer.from(m[2], 'hex'), KEYLEN, { N: +m[1] });
  return crypto.timingSafeEqual(actual, expected);
}

// Matches how wa_number is stored: E.164 digits with no '+'. A bare ten-digit number is taken as
// Indian, since that is where every current user is; any other country needs its code.
function normalizeNumber(input) {
  if (typeof input !== 'string') return null;
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10) digits = '91' + digits;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

// The state after one more wrong PIN. The fifth starts a lock and resets the count, so the next
// window after the lock gets the full five tries again.
function afterFailure(failures, now = new Date()) {
  const n = (failures || 0) + 1;
  if (n >= MAX_FAILURES) return { failures: 0, lockedUntil: new Date(now.getTime() + LOCK_MS), justLocked: true };
  return { failures: n, lockedUntil: null, justLocked: false };
}

const isLocked = (lockedUntil, now = new Date()) => !!lockedUntil && new Date(lockedUntil) > now;

module.exports = { checkPin, hashPin, verifyPin, normalizeNumber, afterFailure, isLocked, MAX_FAILURES, LOCK_MS };
