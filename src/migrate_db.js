require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  try {
    console.log('Running migrations...');

    // 1. Message Queue Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id TEXT UNIQUE,
        from_number TEXT NOT NULL,
        message_raw JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        tokens_input INTEGER,
        tokens_output INTEGER
      );
    `);
    console.log('✔ pending_messages table created/verified');

    // 1b. When a worker claims a message. Without this, a process that died mid-message left the
    // row in 'processing' forever: the retry filter only looked at 'pending' and 'failed', so the
    // message was never answered and nothing reported it. claimed_at lets a stale claim be
    // reclaimed. Serverless caps a function at 60s, so anything held for minutes is dead.
    await pool.query(`
      ALTER TABLE pending_messages ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
    `);
    console.log('✔ pending_messages.claimed_at column added/verified');

    // 2. Request Dedup Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dedup_messages (
        message_id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✔ dedup_messages table created/verified');

    // 3. Vector embedding for todos (pgvector extension should already be enabled).
    // 768 dimensions, matching EMBEDDING_DIMS in brain.js and every other embedding column in
    // migration-export/01_schema.sql. This said vector(1536), which was inert on the existing
    // database because IF NOT EXISTS made it a no-op — but on a fresh one it created a column of
    // the wrong width and every todo embedding insert failed on a dimension mismatch.
    await pool.query(`
      ALTER TABLE todos ADD COLUMN IF NOT EXISTS embedding vector(768);
    `);
    console.log('✔ todos embedding column added/verified');

    // 4. Memory decay columns on knowledge table
    await pool.query(`
      ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS last_referenced_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS flagged_for_review BOOLEAN DEFAULT FALSE;
    `);
    console.log('✔ knowledge decay columns added/verified');

    // 5. Entity graph tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS entity_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_name TEXT NOT NULL,
        entity_type TEXT,
        knowledge_id UUID REFERENCES knowledge(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_knowledge ON entity_links(entity_name, knowledge_id);
    `);
    console.log('✔ entity_links table and index created/verified');

    // 6. Spaced repetition columns on learnings table
    await pool.query(`
      ALTER TABLE learnings ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
      ALTER TABLE learnings ADD COLUMN IF NOT EXISTS next_review_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE learnings ADD COLUMN IF NOT EXISTS interval_days INTEGER DEFAULT 1;
    `);
    console.log('✔ learnings spaced repetition columns added/verified');

    // 7. Prompt versioning and token tracking columns on conversations table
    await pool.query(`
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS prompt_version TEXT;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_satisfaction INTEGER;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tokens_input INTEGER;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tokens_output INTEGER;
    `);
    console.log('✔ conversations version and tracking columns added/verified');

    // 8. Prompt versions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prompt_versions (
        version TEXT PRIMARY KEY,
        prompt_text TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✔ prompt_versions table created/verified');

    // 9. Reminder-fired flag on events — lets the reminder sweep claim rows atomically
    // instead of relying on a narrow time window plus an in-process dedup Set.
    // `reminded` is a boolean, which can say "this event was reminded" but not "this event was
    // reminded for Tuesday" — so it cannot claim a recurring event, which fires many times.
    // `last_reminded_at` holds the occurrence claimed, making the guard per-occurrence.
    await pool.query(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS reminded BOOLEAN DEFAULT false;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;
    `);
    console.log('✔ events.reminded / events.last_reminded_at columns added/verified');

    // 10. Tag columns. The semantic-tagging refactor moved the code from a single `context`
    // string to `tags` arrays (notes already had them) but the schema was never migrated, so
    // every query referencing tags failed. Additive: `context` is left in place for the queries
    // still reading it, and existing rows are backfilled.
    //
    // knowledge, goals and learnings were missed the first time round. The code writes `tags` to
    // knowledge and goals, and searchMemory SELECTs `tags` from learnings — so every semantic
    // search threw `column "tags" does not exist` and the whole pgvector feature was dead.
    // Every learn_context and set_goal therefore failed with `column "tags" does not exist` —
    // silently, because executeAction used to answer with the optimistic confirmation on error.
    // The live effect was that Blu could not learn a single fact about Tarun and no One Big Thing
    // was ever stored (goals held zero rows). See test/schema.tags.test.js, which fails if the
    // code writes tags to a table this migration does not cover.
    await pool.query(`
      ALTER TABLE todos     ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
      ALTER TABLE events    ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
      ALTER TABLE notes     ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
      ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
      ALTER TABLE goals     ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
      ALTER TABLE learnings ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
      UPDATE todos     SET tags = ARRAY[context]
        WHERE context IS NOT NULL AND (tags IS NULL OR cardinality(tags) = 0);
      UPDATE events    SET tags = ARRAY[context]
        WHERE context IS NOT NULL AND (tags IS NULL OR cardinality(tags) = 0);
      UPDATE knowledge SET tags = ARRAY[context]
        WHERE context IS NOT NULL AND (tags IS NULL OR cardinality(tags) = 0);
      UPDATE goals     SET tags = ARRAY[context]
        WHERE context IS NOT NULL AND (tags IS NULL OR cardinality(tags) = 0);
    `);
    console.log('✔ tags columns added and backfilled on todos/events/notes/knowledge/goals');

    // 11. Ownership. Every row in every table has belonged implicitly to one person, because
    // there has only ever been one person: MY_WHATSAPP_NUMBER served as both the auth check and
    // the send destination. This gives that person a row, and every other row an owner.
    //
    // dedup_messages and prompt_versions are deliberately left global — a WhatsApp message id is
    // unique across the world, and prompt versions are agent configuration, not user data.
await pool.query(`
       CREATE TABLE IF NOT EXISTS users (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         wa_number text UNIQUE NOT NULL,
         name text,
         tz text DEFAULT 'Asia/Kolkata',
         active boolean DEFAULT true,
         dashboard_token text UNIQUE,
         created_at timestamptz DEFAULT NOW()
       );
     `);

// Ensure the dashboard_token column exists on existing databases.
     await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dashboard_token text UNIQUE`);
     console.log('✔ users.dashboard_token column added/verified');

     // The seed has to exist before the backfill can point at it. Without a number configured
     // there is nobody to attribute the existing rows to, so stop rather than invent an owner.
     const myNumber = process.env.MY_WHATSAPP_NUMBER;
     if (!myNumber) throw new Error('MY_WHATSAPP_NUMBER is not set — cannot seed the owner of existing rows');

     const { rows: seeded } = await pool.query(
       `INSERT INTO users (wa_number, name, dashboard_token) VALUES ($1, $2, $3)
        ON CONFLICT (wa_number) DO NOTHING
        RETURNING id`,
       [myNumber, 'Tarun', crypto.randomUUID()]
     );
     const ownerId = seeded?.[0]?.id
       || (await pool.query(`SELECT id FROM users WHERE wa_number = $1`, [myNumber])).rows[0].id;
     console.log(`✔ users table created/verified, owner seeded (${ownerId})`);

    const OWNED = ['todos', 'notes', 'events', 'learnings', 'knowledge', 'goals',
                   'conversations', 'state', 'skills', 'user_insights',
                   'pending_messages', 'entity_links', 'reminders'];

    for (const table of OWNED) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id)`);
      await pool.query(`UPDATE ${table} SET user_id = $1 WHERE user_id IS NULL`, [ownerId]);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_${table}_user ON ${table} (user_id)`);
    }
    console.log(`✔ user_id added, backfilled and indexed on ${OWNED.length} tables`);

    // Two uniqueness constraints are scoped to one person's world and collide the moment there
    // are two: state.key — "context_summary" is per-person — and skills.name. The composite
    // replacements are created here so they exist before anything needs them.
    //
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS state_user_key ON state (user_id, key);
      CREATE UNIQUE INDEX IF NOT EXISTS skills_user_name ON skills (user_id, name);
    `);
    console.log('✔ composite uniqueness added for state(user_id,key) and skills(user_id,name)');

    // 12. The single-column uniqueness the composites replace. Dropped only now, because until
    // the queries were scoped four statements still named these as ON CONFLICT targets
    // (saveState, saveContextSummary, savePushToken/removePushToken, saveSkill) and dropping the
    // index out from under them would have broken exactly those writes in production.
    await pool.query(`
      ALTER TABLE state  DROP CONSTRAINT IF EXISTS state_pkey;
      DROP INDEX IF EXISTS state_pkey;
      ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_name_key;
      DROP INDEX IF EXISTS skills_name_key;
    `);
    console.log('✔ single-user uniqueness on state.key and skills.name removed');

    // 13. Ownership is now mandatory. Every write path sets user_id, so an unowned row can only
    // arrive from a query that forgot its scope — which is precisely what must not be allowed to
    // land quietly. Guarded: enforce only once the table is genuinely clean.
    for (const table of OWNED) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS orphans FROM ${table} WHERE user_id IS NULL`);
      if (rows[0].orphans > 0) {
        console.warn(`  ! ${table} still has ${rows[0].orphans} unowned rows — leaving it nullable`);
        continue;
      }
      await pool.query(`ALTER TABLE ${table} ALTER COLUMN user_id SET NOT NULL`);
    }
    console.log('✔ user_id is NOT NULL wherever the table was clean');

    console.log('Migrations completed successfully!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await pool.end();
  }
}

main();
