// Guards the code-versus-schema agreement that broke Blu in production.
//
// The semantic-tagging refactor changed every INSERT to write a `tags` array, but the migration
// only added the column to todos and events. knowledge and goals were missed, so every
// learn_context and set_goal failed with `column "tags" does not exist` — and because
// executeAction answered with the optimistic confirmation on error, it failed silently for weeks.
// Blu could not learn a single fact, and the goals table held zero rows.
//
// A static check, so it runs with no database: every table the code writes `tags` to must be a
// table the migration guarantees a `tags` column on.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const memorySrc = fs.readFileSync(path.join(root, 'src/agent/memory.js'), 'utf8');
const migrateSrc = fs.readFileSync(path.join(root, 'src/migrate_db.js'), 'utf8');

// Tables the code inserts a `tags` column into.
function tablesWrittenWithTags(src) {
  const found = new Set();
  // INSERT INTO <table> (<columns>) — columns may wrap across lines.
  for (const m of src.matchAll(/INSERT INTO\s+([a-z_]+)\s*\(([^)]*)\)/gis)) {
    const [, table, columns] = m;
    if (/\btags\b/.test(columns)) found.add(table);
  }
  return found;
}

// Tables the migration guarantees a tags column on.
function tablesMigratedForTags(src) {
  const found = new Set();
  for (const m of src.matchAll(/ALTER TABLE\s+([a-z_]+)\s+ADD COLUMN IF NOT EXISTS\s+tags/gi)) {
    found.add(m[1]);
  }
  return found;
}

test('every table the code tags is covered by the migration', () => {
  const written = tablesWrittenWithTags(memorySrc);
  const migrated = tablesMigratedForTags(migrateSrc);

  assert.ok(written.size > 0, 'sanity: expected to find tagged INSERTs');

  const missing = [...written].filter(t => !migrated.has(t));
  assert.deepStrictEqual(
    missing,
    [],
    `these tables are written with tags but no migration adds the column: ${missing.join(', ')}. ` +
    'Every INSERT into them will fail at runtime with `column "tags" does not exist`.'
  );
});

test('the tables that broke in production are both covered', () => {
  const migrated = tablesMigratedForTags(migrateSrc);
  // Named explicitly: these are the two that were missed and caused the outage.
  assert.ok(migrated.has('knowledge'), 'knowledge.tags — learn_context fails without it');
  assert.ok(migrated.has('goals'), 'goals.tags — set_goal fails without it');
});

test('saveGoal passes its own parameter, not an undefined global', () => {
  // The refactor renamed the parameter to `tags` but left the call site passing `context`,
  // which is not in scope — so set_goal threw a ReferenceError before it ever reached the DB.
  const body = memorySrc.match(/async function saveGoal\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(body, 'saveGoal not found');
  assert.doesNotMatch(
    body[0],
    /\[\s*content\s*,\s*context\s*\]/,
    'saveGoal passes `context`, which is not a parameter — it will throw at runtime'
  );
});
