// Every query against a user-owned table must name user_id.
//
// This is the guard for the multi-user refactor. memory.js holds ~103 queries; a single one that
// forgets its filter does not fail, it silently returns — or overwrites — every user's rows. That
// is not a bug a test of behaviour would catch, because with one user in the database the
// unscoped query and the correct one give identical answers. So this reads the source instead.
//
// Precedent: test/schema.tags.test.js already asserts schema facts by inspecting source rather
// than by round-tripping through a database that may not exist in CI.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', 'src', 'agent', 'memory.js');

// Tables whose rows belong to exactly one person. `users` is absent on purpose — it is how a
// person is identified in the first place, so those queries run before any scope exists.
// `dedup_messages` and `prompt_versions` are absent because they are genuinely global: a WhatsApp
// message id is unique worldwide, and prompt versions are agent configuration, not user data.
const OWNED = [
  'todos', 'notes', 'events', 'learnings', 'knowledge', 'goals',
  'conversations', 'state', 'skills', 'user_insights',
  'pending_messages', 'entity_links', 'reminders',
];

// Pulls the SQL-looking string literals out of the source: backtick templates, single-quoted and
// double-quoted strings. Good enough for a file where every query is a literal passed to
// pool.query.
//
// Double quotes are in the list because leaving them out already hid one: processMemoryDecay's
// UPDATE is double-quoted (it contains an apostrophe-free interval but a single-quoted '30 days'),
// so the first version of this scanner reported it clean while it was reading every user's
// knowledge rows. A guard with a blind spot is worse than no guard, because it is trusted.
function sqlLiterals(src) {
  const out = [];
  const re = /`([^`]*)`|'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
    if (/\b(select|insert|update|delete)\b/i.test(body)) out.push(body);
  }
  return out;
}

function ownedTablesIn(sql) {
  const found = new Set();
  const re = /\b(?:from|into|update|join)\s+(?:only\s+)?([a-z_][a-z0-9_]*)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const table = m[1].toLowerCase();
    if (OWNED.includes(table)) found.add(table);
  }
  return [...found];
}

test('every query touching a user-owned table filters on user_id', () => {
  const src = fs.readFileSync(SOURCE, 'utf8');
  const offenders = [];

  for (const sql of sqlLiterals(src)) {
    const tables = ownedTablesIn(sql);
    if (!tables.length) continue;
    if (/user_id/i.test(sql)) continue;
    offenders.push(`${tables.join(',')}: ${sql.replace(/\s+/g, ' ').trim().slice(0, 110)}`);
  }

  assert.deepStrictEqual(
    offenders, [],
    `${offenders.length} unscoped queries — each returns or overwrites every user's rows:\n` +
    offenders.map(o => '  - ' + o).join('\n')
  );
});

test('the owned-table list matches what the migration actually stamps', () => {
  // The two lists drifting apart is how a table quietly loses its guard: migrate_db.js adds the
  // column, this test never checks it. Same failure shape as the `tags` drift.
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'migrate_db.js'), 'utf8');

  const match = migration.match(/const OWNED = \[([\s\S]*?)\];/);
  assert.ok(match, 'migrate_db.js no longer declares an OWNED list');

  const declared = [...match[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
  assert.deepStrictEqual(declared, [...OWNED].sort());
});

test('the user lookups themselves are deliberately unscoped', () => {
  // getUserByNumber/getActiveUsers/getOwner run before a scope can exist. If one of them ever
  // grew a user_id filter it would be unresolvable — worth pinning so the rule above is not
  // applied to them by reflex.
  const src = fs.readFileSync(SOURCE, 'utf8');
  const userQueries = sqlLiterals(src).filter(s => /\bfrom\s+users\b/i.test(s));

  assert.ok(userQueries.length >= 2, 'expected the users lookups to still exist');
  for (const q of userQueries) {
    assert.ok(!/user_id/i.test(q), `users lookup should not filter on user_id: ${q.slice(0, 80)}`);
  }
});
