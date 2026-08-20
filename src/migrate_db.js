require('dotenv').config();
const { Pool } = require('pg');

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

    // 2. Request Dedup Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dedup_messages (
        message_id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✔ dedup_messages table created/verified');

    // 3. Vector embedding for todos (pgvector extension should already be enabled)
    await pool.query(`
      ALTER TABLE todos ADD COLUMN IF NOT EXISTS embedding vector(1536);
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
    await pool.query(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS reminded BOOLEAN DEFAULT false;
    `);
    console.log('✔ events.reminded column added/verified');

    // 10. Tag columns on todos/events. The semantic-tagging refactor moved the code from a
    // single `context` string to `tags` arrays (notes already had them) but the schema was
    // never migrated, so every todo/event query referencing tags failed. Additive: `context`
    // is left in place for the queries still reading it, and existing rows are backfilled.
    await pool.query(`
      ALTER TABLE todos  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
      ALTER TABLE events ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
      UPDATE todos  SET tags = ARRAY[context]
        WHERE context IS NOT NULL AND (tags IS NULL OR cardinality(tags) = 0);
      UPDATE events SET tags = ARRAY[context]
        WHERE context IS NOT NULL AND (tags IS NULL OR cardinality(tags) = 0);
    `);
    console.log('✔ todos/events tags columns added and backfilled from context');

    console.log('Migrations completed successfully!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await pool.end();
  }
}

main();
