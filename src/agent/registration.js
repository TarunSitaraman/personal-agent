// Who is allowed to talk to this agent, and what happens the first time they do.
//
// Until now the answer was a string comparison against MY_WHATSAPP_NUMBER: one number passed,
// everyone else was dropped. That was the auth check. Replacing it with "look the sender up in
// the users table" alone would be wrong in the other direction — the WhatsApp number is public,
// so anything that registers unknown senders on sight is an open bot on a metered Meta number
// and a metered LLM. Registration is therefore allowlist-gated: a number has to be named in
// ALLOWED_NUMBERS before first contact creates an account.
//
// The owner is always allowed, so the deployment cannot lock its own operator out by way of a
// mistyped env var.

const memory = require('./memory');

// ALLOWED_NUMBERS is a comma-separated list of E.164 numbers without the leading '+',
// matching the format WhatsApp sends and MY_WHATSAPP_NUMBER already uses (e.g. 919324791556).
function parseAllowlist(raw) {
  return String(raw || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

// Pure, so the policy can be asserted without a database. `env` is injected rather than read
// from process.env directly for the same reason.
function isAllowed(waNumber, env = process.env) {
  if (!waNumber) return false;
  if (waNumber === env.MY_WHATSAPP_NUMBER) return true;
  return parseAllowlist(env.ALLOWED_NUMBERS).includes(waNumber);
}

// The greeting a newly registered person gets. Kept here next to the policy that admits them.
const WELCOME =
  "I'm Blu — your notes, todos, reminders and calendar, over WhatsApp.\n\n" +
  "Just talk normally. \"remind me to call the bank at 6\", \"note: the API key rotates monthly\", " +
  "\"what's on today?\". I'll work out what you meant.\n\n" +
  "You'll get a brief in the morning and one in the evening.";

// Resolves the sender to a user, registering them on first contact when the allowlist permits.
//
// Returns { user, isNew } — or null when the number should be ignored entirely, which the
// callers treat exactly as the old number mismatch did: drop it, answer WhatsApp 200, say
// nothing. Staying silent matters; replying "you are not authorised" to an unknown number
// confirms the agent exists and invites more traffic.
async function resolveSender(waNumber) {
  const existing = await memory.getUserByNumber(waNumber);
  if (existing) return existing.active ? { user: existing, isNew: false } : null;

  if (!isAllowed(waNumber)) return null;

  const user = await memory.createUser(waNumber);
  return { user, isNew: true };
}

module.exports = { parseAllowlist, isAllowed, resolveSender, WELCOME };
