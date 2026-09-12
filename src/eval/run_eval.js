#!/usr/bin/env node
// Classifier eval harness: replays messages through the production classifier (the real
// CLASSIFIER_PROMPT and callLLM 'classifier' route) and fails when the chosen action is wrong.
//
//   node src/eval/run_eval.js              assert every labeled case; exit 1 on any failure
//   node src/eval/run_eval.js --capture 30 classify your last 30 real messages and append them to
//                                          eval/captured.json for review
//
// Labeled cases live in two files:
//   eval/cases.json     hand-written, committed
//   eval/captured.json  real messages, gitignored (they're your actual WhatsApp text). A captured
//                       case is asserted only once you set "reviewed": true, after checking its
//                       "accept" list is what you actually wanted — otherwise the harness would
//                       just be asserting that today's classifier agrees with itself.
//
// Scope: classification only. The prefilter fast path (tryPrefilter) and executeAction are not
// exercised — prefilter can write to the DB, and executeAction has its own unit tests.

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { CLASSIFIER_PROMPT, callLLM, extractFirstJSON } = require('../agent/brain');
const { actionsFrom, scoreCase } = require('./scoring');

const ROOT = path.join(__dirname, '..', '..');
const CASES = path.join(ROOT, 'eval', 'cases.json');
const CAPTURED = path.join(ROOT, 'eval', 'captured.json');

// The free-tier ladder rate-limits quickly; spacing calls keeps failures about the model.
const GAP_MS = 1200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);

async function classify(msg) {
  const raw = await callLLM([
    { role: 'system', content: CLASSIFIER_PROMPT },
    { role: 'user', content: `User message: ${msg}` },
  ], true, 'classifier');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = extractFirstJSON(raw); }
  return actionsFrom(parsed);
}

async function capture(limit) {
  const { withOwner } = require('../agent/context');
  const memory = require('../agent/memory');
  const messages = await withOwner(() => memory.getRecentUserMessages(limit));

  const existing = readJson(CAPTURED);
  const seen = new Set(existing.map(c => c.msg));
  let added = 0;
  let failed = 0;
  fs.mkdirSync(path.dirname(CAPTURED), { recursive: true });

  for (const { content } of messages) {
    if (!content || seen.has(content)) continue;
    await sleep(GAP_MS);
    let actions;
    try {
      actions = await classify(content);
    } catch (e) {
      // The free ladder rate-limits mid-run. Skip and keep going; a later --capture picks it up.
      failed++;
      console.log(`  SKIPPED (${e.message})`.padEnd(31) + content.slice(0, 70));
      continue;
    }
    existing.push({ msg: content, accept: [actions], reviewed: false });
    seen.add(content);
    added++;
    // Saved per message: an abort after 8 of 30 must not throw away the 8.
    fs.writeFileSync(CAPTURED, JSON.stringify(existing, null, 2) + '\n');
    console.log(`  ${(actions.join(' + ') || '(none parsed)').padEnd(28)} ${content.slice(0, 70)}`);
  }

  console.log(`\nCaptured ${added} new message(s) into eval/captured.json` +
    (failed ? ` — ${failed} skipped on LLM errors, re-run --capture later to pick them up.` : '.'));
  console.log('Review each "accept" list, fix any that are wrong, then set "reviewed": true.');
}

async function assertAll() {
  const labeled = readJson(CASES);
  const captured = readJson(CAPTURED);
  const reviewed = captured.filter(c => c.reviewed);
  const cases = [...labeled, ...reviewed];

  console.log(`\nClassifier eval: ${labeled.length} labeled + ${reviewed.length} reviewed real messages` +
    (captured.length > reviewed.length ? ` (${captured.length - reviewed.length} captured, unreviewed, skipped)` : ''));

  const failures = [];
  for (const c of cases) {
    await sleep(GAP_MS);
    let actual;
    try {
      actual = await classify(c.msg);
    } catch (e) {
      actual = [`ERROR: ${e.message}`];
    }
    const pass = scoreCase(actual, c.accept);
    if (!pass) failures.push({ ...c, actual });
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${(actual.join(' + ') || '(none)').padEnd(28)} ${c.msg.slice(0, 60)}`);
  }

  console.log(`\n${cases.length - failures.length}/${cases.length} passed.`);
  for (const f of failures) {
    console.log(`  FAIL "${f.msg}"\n       got ${f.actual.join(' + ') || '(none)'}, accepted ${f.accept.map(a => a.join(' + ')).join(' | ')}`);
  }
  process.exitCode = failures.length ? 1 : 0;
}

const i = process.argv.indexOf('--capture');
const run = i !== -1 ? capture(Number(process.argv[i + 1]) || 30) : assertAll();
run.catch(e => { console.error('Eval failed:', e.message); process.exitCode = 1; });
