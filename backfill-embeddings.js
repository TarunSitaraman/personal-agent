// Verifies the Gemini key, confirms which embedding model is live, and backfills every row
// that was written while embeddings were broken.
//
//   node backfill-embeddings.js --check     # verify key + model only, write nothing
//   node backfill-embeddings.js             # backfill all NULL embeddings
//
// Safe to re-run: only rows with a NULL embedding are touched.
require('dotenv').config();
const { Client } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const checkOnly = process.argv.includes('--check');
const KEY = process.env.GEMINI_API_KEY;

// vector(768) columns — a model with a different output dimension needs a schema change.
const EXPECTED_DIMS = 768;
const CANDIDATES = [process.env.EMBEDDING_MODEL, 'gemini-embedding-001', 'text-embedding-004']
  .filter(Boolean);

// content column differs per table
const TABLES = [
  { name: 'todos', text: 'content' },
  { name: 'notes', text: 'content' },
  { name: 'knowledge', text: 'fact' },
  { name: 'learnings', text: "topic || ': ' || content" },
];

// Truncated Matryoshka vectors are not unit length; renormalise as Google recommends.
function normalize(v) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n > 0 ? v.map(x => x / n) : v;
}

async function embedOnce(model, text) {
  const r = await model.embedContent({
    content: { parts: [{ text }] },
    outputDimensionality: EXPECTED_DIMS,
  });
  return normalize(r.embedding.values);
}

async function pickModel(genAI) {
  for (const id of CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({ model: id });
      const r = await embedOnce(model, 'dimension probe');
      const dims = r.length;
      console.log(`  ${id}: ok, ${dims} dimensions${dims === EXPECTED_DIMS ? '' : '  <-- MISMATCH'}`);
      if (dims === EXPECTED_DIMS) return { id, dims };
    } catch (err) {
      console.log(`  ${id}: ${err.message.slice(0, 90)}`);
    }
  }
  return null;
}

(async () => {
  if (!KEY) {
    console.error('GEMINI_API_KEY is not set in .env — get one at https://aistudio.google.com/apikey');
    process.exit(1);
  }
  console.log('key present, length', KEY.length);

  const genAI = new GoogleGenerativeAI(KEY);
  console.log('\nprobing embedding models:');
  const model = await pickModel(genAI);
  if (!model) {
    console.error(`\nNo candidate model returned ${EXPECTED_DIMS} dimensions. Either the key is ` +
      'invalid, or the model line has changed and the vector columns need migrating.');
    process.exit(1);
  }
  console.log(`\nusing ${model.id}`);
  if (checkOnly) { console.log('--check: nothing written'); return; }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const embed = genAI.getGenerativeModel({ model: model.id });

  let total = 0, failed = 0;
  for (const t of TABLES) {
    const { rows } = await client.query(
      `SELECT id, ${t.text} AS text FROM ${t.name} WHERE embedding IS NULL AND ${t.text} IS NOT NULL`
    );
    if (!rows.length) { console.log(`  ${t.name}: nothing to backfill`); continue; }

    let done = 0;
    for (const row of rows) {
      try {
        const values = await embedOnce(embed, row.text);
        await client.query(
          `UPDATE ${t.name} SET embedding = $1 WHERE id = $2`,
          [`[${values.join(',')}]`, row.id]
        );
        done++;
      } catch (err) {
        failed++;
        console.log(`    ${t.name} ${row.id}: ${err.message.slice(0, 70)}`);
      }
    }
    total += done;
    console.log(`  ${t.name}: ${done}/${rows.length} embedded`);
  }

  console.log('\n--- remaining NULL embeddings ---');
  for (const t of TABLES) {
    const [{ n }] = (await client.query(`SELECT count(*)::int n FROM ${t.name} WHERE embedding IS NULL`)).rows;
    console.log(`  ${t.name.padEnd(12)} ${n}`);
  }
  console.log(`\nbackfilled ${total} rows${failed ? `, ${failed} failed` : ''}`);
  await client.end();
})().catch(e => { console.error('failed:', e.message); process.exitCode = 1; });
