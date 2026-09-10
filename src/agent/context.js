// Who the agent is currently acting for.
//
// memory.js holds 103 queries across 77 exports. Threading a userId parameter through all of them
// would mean editing every export and every call site in brain.js, dashboard.js, queueProcessor.js
// and seven crons — hundreds of mechanical edits, each one a chance to pass the wrong variable.
// Instead the entry points enter a scope once and the queries read it, which keeps the diff in
// the two places that actually know who is being served.
//
// AsyncLocalStorage isolates per async call chain, so this works identically on the always-on
// server (concurrent WhatsApp messages) and on serverless (one invocation per request).

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

// Enters the scope for the duration of fn, including everything it awaits.
function runAsUser(user, fn) {
  if (!user?.id) throw new Error('runAsUser requires a user with an id');
  return storage.run({ user }, fn);
}

function currentUser() {
  return storage.getStore()?.user || null;
}

// Deliberately throws rather than falling back to a default user.
//
// A query that runs without a scope is a query that would otherwise return, or overwrite, every
// user's rows. That has to be a loud crash at the point of the mistake — a silent fallback would
// turn a missing runAsUser into a cross-user data leak that looks exactly like working software.
function currentUserId() {
  const user = currentUser();
  if (!user) {
    throw new Error(
      'No user in scope: a database call ran outside runAsUser(). ' +
      'Every entry point — webhook, queue processor, cron, dashboard — must establish the user first.'
    );
  }
  return user.id;
}

// The user's own timezone, for anything that reasons about local time (brief scheduling, the
// recurrence walk). Falls back to the process zone, which is what the single-user era assumed.
function currentTz() {
  return currentUser()?.tz || process.env.TZ || 'Asia/Kolkata';
}

// Convenience for the entry points that have no sender to identify — the dashboard, and the crons
// until they fan out over every active user. Resolves the owner and enters the scope.
//
// memory is required lazily: memory.js requires this module for currentUserId(), so a top-level
// require here would close the cycle and hand one of them a half-built module object.
function withOwner(fn) {
  const memory = require('./memory');
  return memory.getOwner().then(owner => runAsUser(owner, fn));
}

// Wraps a whole request handler so its body runs with the owner in scope. Used by the crons and
// the dashboard, which have no sender to identify. Keeps the wiring to one line per entry point
// rather than re-indenting every handler body into a callback.
function asOwner(handler) {
  return (...args) => withOwner(() => handler(...args));
}

// Express middleware form. next() is invoked synchronously inside the scope, so every downstream
// handler — and everything it awaits — inherits it.
function ownerMiddleware(req, res, next) {
  withOwner(() => { next(); }).catch(next);
}

module.exports = {
  runAsUser, currentUser, currentUserId, currentTz,
  withOwner, asOwner, ownerMiddleware,
};
