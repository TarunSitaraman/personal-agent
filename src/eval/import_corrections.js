// Exports captured classifier misroutes from Postgres into eval/captured.json.
//
// Production writes corrections to the database because Vercel's filesystem is read-only, so this
// runs locally, against the same database, to bring them into the eval set. A correction enters
// as a negative case — {rejected, accept: null} — which run_eval asserts as "must not classify as
// this" with no labeling effort. It stays reviewed:false, so nothing is asserted until reviewed.
//
// See docs/superpowers/specs/2026-09-17-correction-capture-design.md.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const memory = require('../agent/memory');
const { withOwner } = require('../agent/context');

const CAPTURED = path.join(__dirname, '..', '..', 'eval', 'captured.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

async function main() {
  await withOwner(async () => {
    const rows = await memory.getUnexportedCorrections();
    if (!rows.length) {
      console.log('No new corrections to export.');
      return;
    }

    const existing = readJson(CAPTURED);
    const seen = new Set(existing.map(c => c.msg));

    let added = 0;
    for (const row of rows) {
      // Idempotent on re-run, and a message already labeled by hand is never overwritten by an
      // inferred negative.
      if (seen.has(row.message)) continue;
      existing.push({
        msg: row.message,
        rejected: row.rejected_action,
        accept: null,
        reviewed: false,
        signal: row.signal,
      });
      seen.add(row.message);
      added++;
    }

    fs.writeFileSync(CAPTURED, JSON.stringify(existing, null, 2) + '\n');
    await memory.markCorrectionsExported(rows.map(r => r.id));

    console.log(`Exported ${added} new correction(s) into eval/captured.json` +
      (rows.length - added ? `, skipped ${rows.length - added} already present` : '') + '.');
    console.log('Each asserts "must not classify as X" once you set "reviewed": true.');
    console.log('Optionally fill in "accept" to upgrade it to a positive case.');
  });
  process.exit(0);
}

// pg surfaces a connection failure as an AggregateError — one inner error per resolved address of
// the pooler — whose own .message is empty. Printing err.message alone showed "Export failed:"
// with nothing after it, hiding an ETIMEDOUT that was the whole story.
function describeError(err) {
  const inner = Array.isArray(err?.errors) ? err.errors : [];
  if (inner.length) {
    return inner.map(e => `${e.code || e.name}: ${e.message}`).join('\n  ');
  }
  return err?.message || err?.code || String(err);
}

main().catch(err => {
  console.error(`Export failed:\n  ${describeError(err)}`);
  if (err?.code === 'ETIMEDOUT' || err?.errors?.some(e => e.code === 'ETIMEDOUT')) {
    console.error('The database did not answer. If other sites load, the network you are on is ' +
      'probably blocking outbound ports 5432/6543 — try another network or a hotspot.');
  }
  process.exit(1);
});
