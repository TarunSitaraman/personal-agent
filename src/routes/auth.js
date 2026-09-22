// App sign-in and sign-up with a phone number and a six-digit PIN. Mounted at /auth, outside the
// /dashboard router, because everything there requires a token and these routes are how you get
// one. A correct PIN returns the account's existing dashboard token, so the rest of the app's
// auth is unchanged. Rules, hashing and lockout live in src/agent/pin.js.
//
// Deliberate choices:
//  - Wrong PIN, unknown number and "no PIN set yet" get one identical answer, so the endpoint
//    cannot be used to find out which numbers have accounts.
//  - Five wrong PINs lock the account for fifteen minutes and tell its owner.
//  - Sign-up is invite-only through the same isAllowed() policy as WhatsApp registration, and
//    never takes over an existing account (that needs the key, then Settings -> PIN).
const express = require('express');
const pin = require('../agent/pin');

const WRONG = { error: 'Wrong number or PIN.' };

function makeAuthRouter({ memory, isAllowed, runAsUser, deliver }) {
  const router = express.Router();

  router.post('/pin/signin', async (req, res) => {
    const number = pin.normalizeNumber(req.body?.number);
    const code = req.body?.pin;
    if (!number || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter your phone number and six-digit PIN.' });
    }
    try {
      const user = await memory.getUserAuthByNumber(number);
      if (!user || !user.active || !user.pin_hash) return res.status(401).json(WRONG);
      if (pin.isLocked(user.pin_locked_until)) {
        return res.status(423).json({ error: 'Too many wrong PINs. Sign-in is locked for 15 minutes.', lockedUntil: user.pin_locked_until });
      }
      if (await pin.verifyPin(code, user.pin_hash)) {
        if (user.pin_failures) await memory.recordPinAttempt(user.id, 0, null);
        return res.json({ token: user.dashboard_token, name: user.name || null });
      }
      const next = pin.afterFailure(user.pin_failures);
      await memory.recordPinAttempt(user.id, next.failures, next.lockedUntil);
      if (next.justLocked) {
        runAsUser(user, () => deliver({
          kind: 'security',
          title: 'Blu sign-in locked',
          text: 'Someone entered 5 wrong PINs for your Blu account. Sign-in is locked for 15 minutes. If it wasn\'t you, change your PIN in Settings.',
        })).catch(err => console.error('[Auth] lock alert failed:', err.message));
        return res.status(423).json({ error: 'Too many wrong PINs. Sign-in is locked for 15 minutes.', lockedUntil: next.lockedUntil });
      }
      return res.status(401).json(WRONG);
    } catch (err) {
      console.error('[Auth] sign-in error:', err.message);
      return res.status(500).json({ error: 'Sign-in failed. Try again.' });
    }
  });

  router.post('/pin/signup', async (req, res) => {
    const number = pin.normalizeNumber(req.body?.number);
    if (!number) return res.status(400).json({ error: 'Enter your phone number, with the country code if outside India.' });
    const valid = pin.checkPin(req.body?.pin);
    if (!valid.ok) return res.status(400).json({ error: valid.error });
    try {
      const existing = await memory.getUserAuthByNumber(number);
      if (existing) return res.status(409).json({ error: 'This number already has an account. Sign in instead.' });
      if (!isAllowed(number)) return res.status(403).json({ error: 'Sign-up is invite-only for now. Ask Tarun to add your number.' });
      const user = await memory.createUser(number);
      await memory.setUserPinHash(user.id, await pin.hashPin(req.body.pin));
      return res.status(201).json({ token: user.dashboard_token, name: user.name || null });
    } catch (err) {
      console.error('[Auth] sign-up error:', err.message);
      return res.status(500).json({ error: 'Sign-up failed. Try again.' });
    }
  });

  return router;
}

module.exports = { makeAuthRouter };
