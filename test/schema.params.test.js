// Every parameterised query must pass at least as many values as its highest $N placeholder.
//
// This is the guard for a bug class that stays invisible until the query runs against Postgres:
// setTodoReminderByContent referenced $3 for user_id twice but passed only two values, so every
// "Tonight 9pm" / "Tomorrow 8am" button tap threw
//   bind message supplies 2 parameters, but prepared statement "" requires 3
// handleButtonAction caught that, returned false, and both webhooks fell through to the LLM with
// the button *title* as the message text — which the classifier saved as a todo literally named
// "Tonight 9pm". A crash inside a caught branch surfaced as a data bug three files away.
//
// Unit tests could not catch it: test/buttons.handler.test.js mocks setTodoReminderByContent, so
// the SQL never executes. Same reasoning as test/schema.scoping.test.js — assert the fact by
// reading the source rather than by round-tripping through a database that may not exist in CI.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', 'src', 'agent', 'memory.js');

const BACKSLASH = '\\';

// Advances past a string/template literal that starts at `i`, so a paren, bracket or comma inside
// SQL text is never mistaken for structure. Returns the index of the closing quote.
function skipString(src, i) {
  const quote = src[i];
  i++;
  while (i < src.length && src[i] !== quote) {
    if (src[i] === BACKSLASH) i++;
    i++;
  }
  return i;
}

function isQuote(ch) {
  return ch === "'" || ch === '"' || ch === '`';
}

// Walks from the opening paren of a query(...) call and returns the call's source text.
function callText(src, openParen) {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const ch = src[i];
    if (isQuote(ch)) {
      i = skipString(src, i);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return src.slice(openParen, i + 1);
    }
  }
  return null;
}

// Counts top-level elements of the params array literal — commas nested inside a call, an object,
// a nested array or a string do not separate parameters.
function countArrayElements(arrayText) {
  const body = arrayText.slice(1, -1).trim();
  if (!body) return 0;
  let depth = 0;
  let count = 1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (isQuote(ch)) {
      i = skipString(body, i);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

// Reads the leading string literal of a call's argument list, returning its body and length.
function leadingString(inner) {
  let i = 0;
  while (i < inner.length && /\s/.test(inner[i])) i++;
  if (i >= inner.length || !isQuote(inner[i])) return null;
  const start = i;
  const end = skipString(inner, i);
  if (end >= inner.length) return null;
  return { body: inner.slice(start + 1, end), consumed: end + 1 };
}

// Returns { sql, params } for each query(...) call whose second argument is a literal array.
// Calls that build their params dynamically (a spread, a named variable) are skipped — the count
// is not knowable from the source, so asserting on it would produce false failures.
function literalQueries(src) {
  const out = [];
  const re = /\b(?:pool|client|c)\.query\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const text = callText(src, re.lastIndex - 1);
    if (!text) continue;
    const inner = text.slice(1, -1);

    const sql = leadingString(inner);
    if (!sql) continue;

    const rest = inner.slice(sql.consumed).trim();
    if (!rest.startsWith(',')) continue;
    const afterComma = rest.slice(1).trim();
    if (!afterComma.startsWith('[')) continue;

    const arrayText = callText(afterComma, 0);
    if (!arrayText) continue;
    if (arrayText.includes('...')) continue;

    out.push({ sql: sql.body, params: countArrayElements(arrayText) });
  }
  return out;
}

function highestPlaceholder(sql) {
  const nums = [...sql.matchAll(/\$(\d+)/g)].map(n => parseInt(n[1], 10));
  return nums.length ? Math.max(...nums) : 0;
}

test('every query passes at least as many params as its highest $N placeholder', () => {
  const src = fs.readFileSync(SOURCE, 'utf8');
  const queries = literalQueries(src);

  // If the scanner stops matching (memory.js is refactored to build its queries elsewhere) this
  // test would pass vacuously while guarding nothing. Precedent: the double-quote blind spot
  // recorded in schema.scoping.test.js.
  assert.ok(queries.length > 50,
    `scanner only found ${queries.length} literal queries — it has probably stopped matching`);

  const offenders = queries
    .filter(q => highestPlaceholder(q.sql) > q.params)
    .map(q => `needs $${highestPlaceholder(q.sql)} but passes ${q.params}: ` +
      q.sql.replace(/\s+/g, ' ').trim().slice(0, 110));

  assert.deepStrictEqual(
    offenders, [],
    `${offenders.length} quer(ies) will throw "bind message supplies N parameters" at runtime:\n` +
    offenders.map(o => '  - ' + o).join('\n'));
});
