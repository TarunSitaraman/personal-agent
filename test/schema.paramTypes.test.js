// A placeholder concatenated as text ("($3 || ' days')::interval") must not also be used as a
// typed value in the same statement. Postgres infers one type per parameter, so
//   interval_days = $3, next_review_at = NOW() + ($3 || ' days')::interval
// fails every time with "inconsistent types deduced for parameter $3". That is exactly what
// reviewLearning did: every spaced-repetition review — dashboard and app — returned 500, and no
// unit test ran the SQL. Same approach as schema.params.test.js: read the source, not a database.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent', 'memory.js'), 'utf8');

// SQL lives in template literals and single-quoted strings; take any that look like SQL.
function sqlStrings(src) {
  const out = [];
  for (const re of [/`([^`]*)`/g, /'((?:[^'\\\n]|\\.)*)'/g]) {
    let m;
    while ((m = re.exec(src))) {
      if (/\b(SELECT|UPDATE|INSERT|DELETE)\b/.test(m[1]) && /\$\d/.test(m[1])) out.push(m[1]);
    }
  }
  return out;
}

function mixedParams(sql) {
  const concat = {};
  for (const m of sql.matchAll(/\$(\d+)\s*\|\|/g)) concat[m[1]] = (concat[m[1]] || 0) + 1;
  const bad = [];
  for (const n of Object.keys(concat)) {
    const all = (sql.match(new RegExp(`\\$${n}(?!\\d)`, 'g')) || []).length;
    if (all > concat[n]) bad.push(`$${n}`);
  }
  return bad;
}

test('the scanner finds the SQL it is meant to check (vacuity guard)', () => {
  const withConcat = sqlStrings(SOURCE).filter(s => /\$\d+\s*\|\|/.test(s));
  assert.ok(withConcat.length >= 5, `expected several interval concatenations, found ${withConcat.length}`);
  assert.deepStrictEqual(mixedParams("SET n = $3, at = NOW() + ($3 || ' days')::interval"), ['$3']);
  assert.deepStrictEqual(mixedParams("WHERE at < NOW() - ($1 || ' days')::interval AND user_id = $2"), []);
});

test('no parameter is used both as concatenated text and as a typed value', () => {
  const offenders = sqlStrings(SOURCE)
    .map(sql => ({ sql: sql.replace(/\s+/g, ' ').trim().slice(0, 120), params: mixedParams(sql) }))
    .filter(x => x.params.length);
  assert.deepStrictEqual(offenders, []);
});
