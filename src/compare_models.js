#!/usr/bin/env node
// Compares candidate models on the one job where a wrong answer cascades: intent classification.
// The classifier picks the action, so a misread turns "did I finish X" into a new todo, or drops
// a reminder on the floor. Reply wording is recoverable; a wrong action is not.
//
// Everything Blu runs on is free tier. Before paying for a model, this shows whether it actually
// classifies better on the kind of message you send — measured, not assumed.
//
//   node src/compare_models.js
//   node src/compare_models.js nousresearch/hermes-4-70b nousresearch/hermes-4-405b
//
// Costs a few cents: one classification call per model per case.

require('dotenv').config();
const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// The free-tier model currently doing this job, as the baseline to beat.
const BASELINE = { id: 'openai/gpt-oss-20b', provider: 'groq' };

const candidates = process.argv.slice(2).length
  ? process.argv.slice(2).map(id => ({ id, provider: 'openrouter' }))
  : [{ id: 'nousresearch/hermes-4-70b', provider: 'openrouter' }];

// Cases chosen for where classification actually goes wrong: completion vs capture, questions
// that look like commands, compound requests, and plain conversation that should trigger nothing.
const CASES = [
  { msg: 'finished the dispatch refactor', expect: 'complete_todo' },
  { msg: 'did I finish the dispatch refactor?', expect: 'list_todos or none — a question, not a completion' },
  { msg: 'remind me about the demo at 4pm tomorrow', expect: 'set_reminder' },
  { msg: 'Rohan is taking over the biometric module', expect: 'learn_context' },
  { msg: 'what am I meant to be doing today', expect: 'list_todos or generate_brief' },
  { msg: 'book the standup for 9am every weekday', expect: 'add_event with recurrence weekdays' },
  { msg: 'I keep forgetting to check my todos', expect: 'none or learn_context — not a new todo' },
  { msg: 'add milk and also remind me to call the bank', expect: 'two actions' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Groq's free tier rate-limits well within a run of this size, and a 429 looks exactly like a
// model failure in the results table. Back off and retry so the comparison measures the model
// rather than the quota.
async function withRetry(fn, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = e.response?.status;
      if (status !== 429 || i === attempts - 1) throw e;
      const wait = Number(e.response?.headers?.['retry-after']) * 1000 || 4000 * (i + 1);
      await sleep(wait);
    }
  }
}

async function classify(model, userMessage) {
  const { CLASSIFIER_PROMPT } = require('./agent/brain');
  const messages = [
    { role: 'system', content: CLASSIFIER_PROMPT },
    { role: 'user', content: `User message: ${userMessage}` },
  ];

  const started = Date.now();
  const isGroq = model.provider === 'groq';
  const { data } = await withRetry(() => axios.post(
    isGroq ? GROQ_URL : OPENROUTER_URL,
    {
      model: model.id,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      // Without this OpenRouter reserves the model's full context window (131k on Hermes) and
      // refuses on credit balance before generating a token. A classification is a few dozen
      // tokens; reasoning models need headroom for a think block, not much more.
      max_tokens: 2000,
    },
    {
      headers: {
        Authorization: `Bearer ${isGroq ? process.env.GROQ_API_KEY : process.env.OPENROUTER_API_KEY}`,
        ...(isGroq ? {} : { 'HTTP-Referer': 'https://personal-agent', 'X-Title': 'Personal Agent' }),
      },
      timeout: 45000,
    }
  ));

  const content = data.choices?.[0]?.message?.content || '';
  // Reasoning models wrap the answer; strip before parsing.
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  let parsed = null;
  try { parsed = JSON.parse(cleaned); } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  }

  const actions = parsed?.actions
    ? parsed.actions.map(a => a.action)
    : parsed?.action ? [parsed.action] : [];

  return { actions, ms: Date.now() - started, ok: !!parsed };
}

async function main() {
  const models = [BASELINE, ...candidates];
  console.log(`\nClassifier comparison over ${CASES.length} cases.`);
  console.log(`Baseline: ${BASELINE.id} (free)`);
  console.log(`Candidates: ${candidates.map(c => c.id).join(', ')}\n`);

  const totals = new Map(models.map(m => [m.id, { ms: 0, failed: 0 }]));

  for (const c of CASES) {
    console.log(`\n"${c.msg}"`);
    console.log(`   expected: ${c.expect}`);
    for (const model of models) {
      try {
        await sleep(1200);
        const r = await classify(model, c.msg);
        const t = totals.get(model.id);
        t.ms += r.ms;
        if (!r.ok) t.failed++;
        const label = model.id === BASELINE.id ? 'baseline' : 'candidate';
        console.log(`   ${(r.actions.join(' + ') || '(unparseable)').padEnd(34)} ${String(r.ms + 'ms').padStart(7)}  ${label}  ${model.id}`);
      } catch (e) {
        totals.get(model.id).failed++;
        console.log(`   ERROR ${e.response?.status || ''} ${e.response?.data?.error?.message || e.message}`.slice(0, 110));
      }
    }
  }

  console.log('\n── totals ─────────────────────────────────');
  for (const [id, t] of totals) {
    console.log(`  ${id.padEnd(34)} avg ${Math.round(t.ms / CASES.length)}ms   unparseable/errors: ${t.failed}`);
  }
  console.log('\nJudge the actions, not the latency — a wrong action costs more than a slow one.');
  console.log('To adopt one: set CLASSIFIER_MODEL=<id> in Vercel and redeploy.\n');
}

main().catch(e => { console.error('Comparison failed:', e.message); process.exit(1); });
