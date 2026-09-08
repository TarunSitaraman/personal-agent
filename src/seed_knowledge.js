#!/usr/bin/env node
// Guided knowledge seeding.
//
// Blu has no hard-coded identity: everything it knows about Tarun comes from the knowledge table.
// Passive learning (brain.extractFactsFromExchange) fills that table over weeks of use, which is
// the right long-run mechanism but leaves the agent starting from nothing today. This walks
// through a handful of prompts, mines each free-text answer into atomic facts, and stores the
// ones you approve — so the agent begins informed instead of waiting to accumulate.
//
// Nothing is written without being shown first. A stored fact is retrieved and reasoned from for
// months and nothing ever prompts a review, so a wrong one is worse than a missing one.
//
//   node src/seed_knowledge.js                  interactive
//   node src/seed_knowledge.js --file notes.txt read a brain dump instead of prompting
//   node src/seed_knowledge.js --dry-run        extract and print, write nothing
//   node src/seed_knowledge.js --yes            skip the per-answer confirmation
//   node src/seed_knowledge.js --list           show what is already known, then exit

require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const memory = require('./agent/memory');
const { extractFactsFromText, storeFactIfNew } = require('./agent/brain');

const PROMPTS = [
  ['Work', 'What do you do, and where? Role, company, what your day actually involves.'],
  ['Projects', 'What are you building right now? For each: what it is, what stage it is at, and what the hard part is.'],
  ['People', 'Who do you work with regularly, and what does each of them own?'],
  ['Routines', 'How is your week shaped? When do you do focused work, and what recurs — standups, reviews, commitments?'],
  ['Stack', 'What do you build with? Languages, frameworks, services, anything you deliberately avoid.'],
  ['Preferences', 'How do you want Blu to help? What should it push you on, and what should it leave alone?'],
];

const args = process.argv.slice(2);
const has = flag => args.includes(flag);
const valueOf = flag => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};

const DRY_RUN = has('--dry-run');
const ASSUME_YES = has('--yes');

const rl = () => readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  const io = rl();
  return new Promise(resolve => io.question(question, answer => { io.close(); resolve(answer); }));
}

// Mines one block of text, shows what came out, and stores what survives review.
// Returns how many facts were actually written.
async function ingest(label, text) {
  if (!text || !text.trim()) return 0;

  process.stdout.write(`\n  extracting from "${label}"...\n`);
  const facts = await extractFactsFromText(text);

  if (!facts.length) {
    console.log('  nothing durable found in that answer.');
    return 0;
  }

  console.log('');
  facts.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

  if (!ASSUME_YES && !DRY_RUN) {
    const reply = await ask('\n  store these? [Y]es / [n]o / numbers to drop (e.g. 2,4): ');
    const answer = reply.trim().toLowerCase();
    if (answer === 'n' || answer === 'no') {
      console.log('  skipped.');
      return 0;
    }
    if (/^[\d,\s]+$/.test(answer) && answer) {
      const drop = new Set(answer.split(',').map(n => parseInt(n.trim(), 10)));
      for (let i = facts.length - 1; i >= 0; i--) {
        if (drop.has(i + 1)) facts.splice(i, 1);
      }
    }
  }

  if (DRY_RUN) {
    console.log(`  [dry run] would store ${facts.length}.`);
    return 0;
  }

  let stored = 0;
  for (const fact of facts) {
    // Returns null when something close enough is already known.
    const id = await storeFactIfNew(fact);
    if (id) stored++;
    else console.log(`  (already known: ${fact.slice(0, 55)}...)`);
  }
  console.log(`  stored ${stored}.`);
  return stored;
}

async function listKnown() {
  const facts = await memory.getAllKnowledge();
  console.log(`\nBlu currently knows ${facts.length} fact(s):\n`);
  facts.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  console.log('');
}

async function main() {
  if (has('--list')) return listKnown();

  const existing = await memory.getAllKnowledge();
  console.log(`\nSeeding Blu's knowledge. It currently knows ${existing.length} fact(s).`);
  if (DRY_RUN) console.log('Dry run — nothing will be written.');

  let total = 0;

  const file = valueOf('--file');
  if (file) {
    const text = fs.readFileSync(file, 'utf8');
    console.log(`\nReading ${file} (${text.length} chars).`);
    // A brain dump has no section boundaries, so mine it in one pass.
    total += await ingest('file', text);
  } else {
    console.log('Answer in plain prose. Press enter to skip any of them.\n');
    for (const [label, question] of PROMPTS) {
      console.log(`\n── ${label} ──────────────────────────────────────────`);
      console.log(question);
      const answer = await ask('\n> ');
      total += await ingest(label, answer);
    }
  }

  console.log(`\nDone. ${total} new fact(s) stored.`);
  if (total) console.log('Ask Blu "what do you know about me" on WhatsApp to check.');
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('\nSeeding failed:', err.message); process.exit(1); });
