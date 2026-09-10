const { Pool } = require('pg');
const { occurrencesBetween } = require('./recurrence');
const { currentUserId } = require('./context');

// Timezone is set as a connection startup parameter rather than by a query on the `connect`
// event. The old version fired `client.query("SET timezone=...")` from the handler without
// awaiting it, so it overlapped the first application query on that client and emitted
// "Calling client.query() when the client is already executing a query" on every new connection.
// pg queues those FIFO today, so the timezone was in fact applied correctly — but the pattern is
// removed in pg@9, the un-caught promise was an unhandled rejection waiting to happen, and on
// serverless (a new connection per cold start) it produced hundreds of warnings that buried real
// errors in the runtime log. A startup parameter needs no query at all.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  options: '-c timezone=Asia/Kolkata',
});

// --- Todos ---

async function addTodo(content, tags = [], remindAt = null, embedding = null) {
  await pool.query(
    'INSERT INTO todos (content, tags, remind_at, embedding, user_id) VALUES ($1, $2, $3, $4, $5)',
    [content, tags, remindAt || null, embedding ? `[${embedding.join(',')}]` : null, currentUserId()]
  );
}

// Claims and returns reminders that are already overdue — the catch-up path for anything
// missed while the process was down. Future reminders are handled by scheduler/timers.
async function getDueTodoReminders() {
  const { rows } = await pool.query(
    `UPDATE todos SET reminded = true
     WHERE done = false AND reminded = false AND remind_at <= NOW() AND user_id = $1
     RETURNING *`,
    [currentUserId()]
  );
  return rows;
}

// Lookahead for the precise-timer scheduler. Deliberately does NOT claim: delivery claims
// via claimTodoReminder/claimEventReminder, so a crash between lookahead and fire loses nothing.
// Events fire EVENT_LEAD_MINUTES before start; todos fire at remind_at.
const EVENT_LEAD_MINUTES = 15;

async function getUpcomingReminders(minutes = 20) {
  const [todos, events, recurring] = await Promise.all([
    pool.query(
      `SELECT id, content, remind_at AS fire_at FROM todos
       WHERE done = false AND reminded = false AND remind_at IS NOT NULL
         AND remind_at > NOW() AND remind_at <= NOW() + ($1 || ' minutes')::interval
         AND user_id = $2
       ORDER BY remind_at LIMIT 50`,
      [minutes, currentUserId()]
    ),
    pool.query(
      `SELECT id, title, start_at, context,
              start_at - ($2 || ' minutes')::interval AS fire_at
       FROM events
       WHERE recurrence = 'none' AND reminded = false AND user_id = $3
         AND start_at - ($2 || ' minutes')::interval > NOW()
         AND start_at - ($2 || ' minutes')::interval <= NOW() + ($1 || ' minutes')::interval
       ORDER BY start_at LIMIT 50`,
      [minutes, EVENT_LEAD_MINUTES, currentUserId()]
    ),
    recurringOccurrencesIn(minutes),
  ]);
  return { todos: todos.rows, events: [...events.rows, ...recurring] };
}

// Recurring events can't be windowed in SQL — the next occurrence of "9am weekdays" is a walk,
// not a column. There are few enough of them on a personal agent to expand in JS, which also
// keeps the rule in one tested place rather than in an unreadable date_trunc expression.
//
// Returns the same shape as the one-shot query, plus `occurrence_at`: the specific instance this
// row represents. `fire_at` leads it by EVENT_LEAD_MINUTES, matching one-shot events.
async function recurringOccurrencesIn(minutes) {
  const { rows } = await pool.query(
    `SELECT id, title, start_at, context, recurrence, last_reminded_at
     FROM events WHERE recurrence <> 'none' AND user_id = $1 LIMIT 200`,
    [currentUserId()]
  );

  const now = Date.now();
  const from = new Date(now + EVENT_LEAD_MINUTES * 60000);
  const to = new Date(now + (minutes + EVENT_LEAD_MINUTES) * 60000);

  const out = [];
  for (const ev of rows) {
    for (const occurrence of occurrencesBetween(ev.recurrence, ev.start_at, from, to)) {
      // Cheap pre-filter only. The claim in claimEventReminder is what actually prevents a
      // double send when a timer and a sweep race.
      if (ev.last_reminded_at && new Date(ev.last_reminded_at) >= occurrence) continue;
      out.push({
        id: ev.id,
        title: ev.title,
        start_at: occurrence,
        context: ev.context,
        occurrence_at: occurrence,
        fire_at: new Date(occurrence.getTime() - EVENT_LEAD_MINUTES * 60000),
      });
    }
  }
  return out;
}

// Atomic single-row claims — the guard against double delivery when a timer and a
// catch-up sweep race for the same row. Returns null if someone else already sent it.
async function claimTodoReminder(id) {
  const { rows } = await pool.query(
    `UPDATE todos SET reminded = true
     WHERE id = $1 AND reminded = false AND done = false AND user_id = $2
     RETURNING id, content`,
    [id, currentUserId()]
  );
  return rows[0] || null;
}

// One-shot events claim by flipping `reminded`. Recurring events have no single "done" state, so
// they claim the *occurrence*: the update only wins if this instance is newer than the last one
// delivered. Passing occurrenceAt is what selects the recurring path.
//
// The returned `start_at` is the occurrence, not the pattern's original date — delivery formats
// the message from it, and a Tuesday standup must not announce itself as the June it was created.
async function claimEventReminder(id, occurrenceAt = null) {
  if (!occurrenceAt) {
    const { rows } = await pool.query(
      `UPDATE events SET reminded = true
       WHERE id = $1 AND reminded = false AND user_id = $2
       RETURNING id, title, start_at, context`,
      [id, currentUserId()]
    );
    return rows[0] || null;
  }

  const { rows } = await pool.query(
    `UPDATE events SET last_reminded_at = $2
     WHERE id = $1 AND (last_reminded_at IS NULL OR last_reminded_at < $2) AND user_id = $3
     RETURNING id, title, $2::timestamptz AS start_at, context`,
    [id, occurrenceAt, currentUserId()]
  );
  return rows[0] || null;
}

async function getPendingTodos(tag = null) {
  const query = tag
    ? 'SELECT * FROM todos WHERE done = false AND user_id = $2 AND $1 = ANY(tags) ORDER BY created_at DESC LIMIT 10'
    : 'SELECT * FROM todos WHERE done = false AND user_id = $1 ORDER BY created_at DESC LIMIT 10';
  const params = tag ? [tag, currentUserId()] : [currentUserId()];
  const { rows } = await pool.query(query, params);
  return rows;
}

async function completeTodo(id) {
  await pool.query(
    'UPDATE todos SET done = true, completed_at = NOW() WHERE id = $1 AND user_id = $2',
    [id, currentUserId()]
  );
}

// `%` and `_` are wildcards inside ILIKE, so a keyword containing either matched far more than the
// user meant — and this statement marks todos done. "50%" would match every pending todo.
// Escaped with a backslash, declared via ESCAPE so the behaviour does not depend on
// standard_conforming_strings.
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, c => `\\${c}`);
}

async function completeTodoByContent(keyword) {
  const { rows } = await pool.query(
    `UPDATE todos SET done = true, completed_at = NOW()
     WHERE done = false AND content ILIKE $1 ESCAPE '\\' AND user_id = $2
     RETURNING content`,
    [`%${escapeLike(keyword)}%`, currentUserId()]
  );
  return rows;
}

// --- Notes ---

async function addNote(content, tags = [], embedding = null) {
  const { rows } = await pool.query(
    'INSERT INTO notes (content, tags, embedding, user_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [content, tags, embedding ? `[${embedding.join(',')}]` : null, currentUserId()]
  );
  return rows[0].id;
}

async function updateNoteTags(id, tags) {
  await pool.query('UPDATE notes SET tags = $1 WHERE id = $2 AND user_id = $3', [tags, id, currentUserId()]);
}

async function getRecentNotes(tag = null, limit = 5) {
  const query = tag
    ? 'SELECT * FROM notes WHERE $1 = ANY(tags) AND user_id = $3 ORDER BY created_at DESC LIMIT $2'
    : 'SELECT * FROM notes WHERE user_id = $2 ORDER BY created_at DESC LIMIT $1';
  const params = tag ? [tag, limit, currentUserId()] : [limit, currentUserId()];
  const { rows } = await pool.query(query, params);
  return rows;
}

// --- Learnings ---

async function addLearning(topic, content, source = null, embedding = null) {
  await pool.query(
    'INSERT INTO learnings (topic, content, source, embedding, user_id) VALUES ($1, $2, $3, $4, $5)',
    [topic, content, source, embedding ? `[${embedding.join(',')}]` : null, currentUserId()]
  );
}

async function getUnreviewedLearnings(limit = 5) {
  const { rows } = await pool.query(
    'SELECT * FROM learnings WHERE reviewed = false AND user_id = $2 ORDER BY created_at DESC LIMIT $1',
    [limit, currentUserId()]
  );
  return rows;
}

async function markLearningReviewed(id) {
  await pool.query(
    'UPDATE learnings SET reviewed = true, last_reviewed_at = NOW() WHERE id = $1 AND user_id = $2',
    [id, currentUserId()]
  );
}

// --- Permanent knowledge store ---

async function saveKnowledge(fact, embedding = null, tags = []) {
  const { rows } = await pool.query(
    'INSERT INTO knowledge (subject, fact, embedding, tags, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    ['general', fact, embedding ? `[${embedding.join(',')}]` : null, tags, currentUserId()]
  );
  return rows[0].id;
}

// Ranks knowledge by vector distance for prompt assembly, letting the HNSW index do the work
// rather than fetching every fact and scoring it in JS.
//
// Deliberately separate from searchMemory, because the two want opposite tuning. Search answers a
// question and should stay quiet when nothing really matches. Prompt context is better served by
// the best few facts even at moderate similarity — the alternative is the model reasoning with
// nothing, or worse, with whatever a word match happened to surface.
//
// Returns null when there is no embedding to rank by, so the caller can fall back.
async function getRelevantKnowledge(embedding, limit = 8, minScore = 0.3) {
  if (!embedding) return null;
  const { rows } = await pool.query(
    `SELECT fact, 1 - (embedding <=> $1) AS score
     FROM knowledge
     WHERE embedding IS NOT NULL AND user_id = $3
     ORDER BY embedding <=> $1
     LIMIT $2`,
    [`[${embedding.join(',')}]`, limit, currentUserId()]
  );
  return rows.filter(r => r.score >= minScore).map(r => r.fact);
}

async function getAllKnowledge() {
  const { rows } = await pool.query(
    'SELECT fact FROM knowledge WHERE user_id = $1 ORDER BY created_at ASC', [currentUserId()]);
  return rows.map(r => r.fact);
}

async function trimConversations(keep = 200) {
  await pool.query(`
    DELETE FROM conversations WHERE user_id = $2 AND id NOT IN (
      SELECT id FROM conversations WHERE user_id = $2 ORDER BY created_at DESC LIMIT $1
    )
  `, [keep, currentUserId()]);
}

// --- Conversation history ---

async function saveMessage(role, content, promptVersion = null, tokensInput = null, tokensOutput = null) {
  await pool.query(
    'INSERT INTO conversations (role, content, prompt_version, tokens_input, tokens_output, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
    [role, content, promptVersion, tokensInput, tokensOutput, currentUserId()]
  );
}

async function getRecentHistory(limit = 20) {
  const { rows } = await pool.query(
    `SELECT role, content FROM (
      SELECT * FROM conversations WHERE user_id = $2 ORDER BY created_at DESC LIMIT $1
    ) sub ORDER BY created_at ASC`,
    [limit, currentUserId()]
  );
  return rows;
}

// --- Analytics ---

async function getAnalytics() {
  const uid = currentUserId();
  const [
    todoStats, contextBreakdown, weeklyTodos,
    weeklyLearnings, recentActivity, totalNotes, totalLearnings
  ] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE done = false) AS open,
        COUNT(*) FILTER (WHERE done = true) AS completed,
        COUNT(*) FILTER (WHERE done = true AND completed_at >= NOW() - INTERVAL '7 days') AS completed_this_week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS added_this_week
      FROM todos WHERE user_id = $1
    `, [uid]),
    pool.query(`
      SELECT unnest(tags) as tag,
        COUNT(*) FILTER (WHERE done = false) AS open,
        COUNT(*) FILTER (WHERE done = true) AS done
      FROM todos WHERE user_id = $1 GROUP BY tag
    `, [uid]),
    pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('week', created_at), 'Mon DD') AS week,
        COUNT(*) AS added,
        COUNT(*) FILTER (WHERE done = true) AS completed
      FROM todos
      WHERE created_at >= NOW() - INTERVAL '8 weeks' AND user_id = $1
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY DATE_TRUNC('week', created_at)
    `, [uid]),
    pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('week', created_at), 'Mon DD') AS week,
        COUNT(*) AS count
      FROM learnings
      WHERE created_at >= NOW() - INTERVAL '8 weeks' AND user_id = $1
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY DATE_TRUNC('week', created_at)
    `, [uid]),
    pool.query(`
      SELECT * FROM (
        SELECT 'todo' AS type, content, tags, created_at FROM todos WHERE done = false AND user_id = $1 ORDER BY created_at DESC LIMIT 5
      ) t
      UNION ALL
      SELECT * FROM (
        SELECT 'note' AS type, content, tags, created_at FROM notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5
      ) n
      UNION ALL
      SELECT * FROM (
        -- null::text[], not bare null: an untyped null is text, and UNION ALL against the
        -- text[] tags column of the other two branches is a hard type error. Pre-existing - this
        -- whole query has been failing, taking every dashboard analytic down with it.
        SELECT 'learning' AS type, topic AS content, null::text[] AS tags, created_at FROM learnings WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5
      ) l
      ORDER BY created_at DESC LIMIT 15
    `, [uid]),
    pool.query('SELECT COUNT(*) AS count FROM notes WHERE user_id = $1', [uid]),
    pool.query('SELECT COUNT(*) AS count FROM learnings WHERE user_id = $1', [uid]),
  ]);

  return {
    todoStats: todoStats.rows[0],
    tagBreakdown: contextBreakdown.rows,
    weeklyTodos: weeklyTodos.rows,
    weeklyLearnings: weeklyLearnings.rows,
    recentActivity: recentActivity.rows,
    totalNotes: parseInt(totalNotes.rows[0].count),
    totalLearnings: parseInt(totalLearnings.rows[0].count),
  };
}

// --- Knowledge connections ---

async function getRecentContent(limit = 30) {
  const [notes, learnings] = await Promise.all([
    pool.query(`SELECT id, 'note' AS type, content, tags FROM notes WHERE user_id = $2 ORDER BY created_at DESC LIMIT $1`, [limit, currentUserId()]),
    pool.query(`SELECT id, 'learning' AS type, topic AS content, null AS tags FROM learnings WHERE user_id = $2 ORDER BY created_at DESC LIMIT $1`, [limit, currentUserId()]),
  ]);
  return [...notes.rows, ...learnings.rows];
}

// --- Events / Calendar ---

async function addEvent(title, startAt, endAt, tags = [], recurrence = 'none') {
  await pool.query(
    'INSERT INTO events (title, start_at, end_at, tags, recurrence, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
    [title, startAt, endAt || null, tags, recurrence, currentUserId()]
  );
}

async function getWeekEvents(weekStart, weekEnd) {
  const { rows } = await pool.query(
    `SELECT id, title, start_at, end_at, tags, recurrence, source
     FROM events
     WHERE user_id = $3
       AND ((recurrence = 'none' AND start_at >= $1 AND start_at < $2)
         OR recurrence IN ('daily', 'weekdays', 'weekly'))
     ORDER BY start_at`,
    [weekStart, weekEnd, currentUserId()]
  );
  return rows;
}

async function getUpcomingEvents(hours = 24) {
  const [events, todos, recurring] = await Promise.all([
    pool.query(
      `SELECT title, start_at, tags, 'event' as type FROM events
       WHERE recurrence = 'none' AND user_id = $2
         AND start_at >= NOW() AND start_at <= NOW() + ($1 || ' hours')::interval
       ORDER BY start_at LIMIT 5`,
      [hours, currentUserId()]
    ),
    pool.query(
      `SELECT content as title, remind_at as start_at, tags, 'todo' as type FROM todos
       WHERE done = false AND user_id = $2 AND remind_at IS NOT NULL
         AND remind_at >= NOW() AND remind_at <= NOW() + ($1 || ' hours')::interval
       ORDER BY remind_at LIMIT 5`,
      [hours, currentUserId()]
    ),
    recurringEventsIn(hours),
  ]);

  return [...events.rows, ...todos.rows, ...recurring]
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    .slice(0, 5);
}

// The briefs' view of recurring events. Same expansion as the reminder path, but reported as
// occurrences the user is about to have rather than rows to claim — a standup every weekday
// belongs in the 10am brief just as much as a one-off meeting does.
async function recurringEventsIn(hours) {
  const { rows } = await pool.query(
    `SELECT title, start_at, tags, recurrence FROM events WHERE recurrence <> 'none' AND user_id = $1 LIMIT 200`,
    [currentUserId()]
  );

  const now = Date.now();
  const to = new Date(now + hours * 3600000);
  const out = [];
  for (const ev of rows) {
    for (const occurrence of occurrencesBetween(ev.recurrence, ev.start_at, new Date(now), to)) {
      out.push({ title: ev.title, start_at: occurrence, tags: ev.tags, type: 'event' });
    }
  }
  return out;
}

async function listEvents(context = null, limit = 10) {
  const eventQuery = context
    ? `SELECT id, title, start_at, end_at, tags, recurrence, 'event' as type FROM events WHERE context = $1 AND user_id = $3 ORDER BY start_at LIMIT $2`
    : `SELECT id, title, start_at, end_at, tags, recurrence, 'event' as type FROM events WHERE user_id = $2 ORDER BY start_at LIMIT $1`;
  
  const todoQuery = context
    ? `SELECT id, content as title, remind_at as start_at, NULL as end_at, context, 'none' as recurrence, 'todo' as type FROM todos WHERE done = false AND remind_at IS NOT NULL AND context = $1 AND user_id = $3 ORDER BY remind_at LIMIT $2`
    : `SELECT id, content as title, remind_at as start_at, NULL as end_at, context, 'none' as recurrence, 'todo' as type FROM todos WHERE done = false AND remind_at IS NOT NULL AND user_id = $2 ORDER BY remind_at LIMIT $1`;

  const params = context ? [context, limit, currentUserId()] : [limit, currentUserId()];
  
  const [events, todos] = await Promise.all([
    pool.query(eventQuery, params),
    pool.query(todoQuery, params)
  ]);

  return [...events.rows, ...todos.rows]
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    .slice(0, limit);
}

async function findEventByTitle(keyword) {
  const { rows } = await pool.query(
    `SELECT id, title, start_at, end_at, tags, recurrence FROM events WHERE title ILIKE $1 AND user_id = $2 ORDER BY start_at LIMIT 3`,
    [`%${keyword}%`, currentUserId()]
  );
  return rows;
}

async function deleteEvent(id) {
  await pool.query('DELETE FROM events WHERE id = $1 AND user_id = $2', [id, currentUserId()]);
}

async function updateEvent(id, updates) {
  const fields = [];
  const values = [];
  let idx = 1;
  if (updates.title !== undefined) { fields.push(`title = $${idx++}`); values.push(updates.title); }
  // Moving an event re-arms its reminder — otherwise a rescheduled event stays claimed.
  if (updates.start_at !== undefined) { fields.push(`start_at = $${idx++}`, 'reminded = false'); values.push(updates.start_at); }
  if (updates.end_at !== undefined) { fields.push(`end_at = $${idx++}`); values.push(updates.end_at); }
  if (updates.recurrence !== undefined) { fields.push(`recurrence = $${idx++}`); values.push(updates.recurrence); }
  if (!fields.length) return;
  values.push(id, currentUserId());
  await pool.query(
    `UPDATE events SET ${fields.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1}`, values);
}

// Claims the rows it returns by flipping `reminded`, so a wider window can't double-fire
// and callers don't need their own dedup state. Window defaults cover a 15-min sweep.
async function getEventsStartingSoon(minutesFrom = 5, minutesTo = 20) {
  // The `reminded = false` on the outer UPDATE is what makes this a claim rather than a read.
  // Without it the subquery and the update are evaluated separately under READ COMMITTED, so two
  // sweeps running at once — the Express cron and the serverless cron both fire every 15 minutes —
  // can each match the row and each send the reminder. Mirrors claimTodoReminder/claimEventReminder.
  const { rows } = await pool.query(
    `UPDATE events SET reminded = true
     WHERE reminded = false AND user_id = $3
       AND id IN (
         SELECT id FROM events
         WHERE recurrence = 'none'
           AND reminded = false
           AND user_id = $3
           AND start_at >= NOW() + ($1 || ' minutes')::interval
           AND start_at < NOW() + ($2 || ' minutes')::interval
       )
     RETURNING id, title, start_at, context`,
    [minutesFrom, minutesTo, currentUserId()]
  );

  // Recurring events can't be claimed by that UPDATE — `reminded` has no per-occurrence meaning.
  // Expand them, then claim each occurrence individually; claimEventReminder returns null when
  // another sweep or a timer got there first, so the race is still settled in the DB.
  const now = Date.now();
  const { rows: patterns } = await pool.query(
    `SELECT id, title, start_at, context, recurrence, last_reminded_at
     FROM events WHERE recurrence <> 'none' AND user_id = $1 LIMIT 200`,
    [currentUserId()]
  );

  const claimed = [];
  for (const ev of patterns) {
    const due = occurrencesBetween(
      ev.recurrence, ev.start_at,
      new Date(now + minutesFrom * 60000),
      new Date(now + minutesTo * 60000)
    );
    for (const occurrence of due) {
      if (ev.last_reminded_at && new Date(ev.last_reminded_at) >= occurrence) continue;
      const row = await claimEventReminder(ev.id, occurrence);
      if (row) claimed.push(row);
    }
  }

  return [...rows, ...claimed];
}

async function deleteNote(id) {
  await pool.query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [id, currentUserId()]);
}

async function getLastCreatedItem() {
  const { rows } = await pool.query(`
    SELECT type, id, content, created_at FROM (
      -- Each branch is parenthesised. Postgres reads a bare ORDER BY / LIMIT before UNION ALL as
      -- belonging to the whole union, so this statement was a syntax error - it has been throwing
      -- since it was written, which means undo_last never worked. Pre-existing; found because
      -- scoping the query made it run for the first time.
      (SELECT 'todo' AS type, id, content, created_at FROM todos WHERE done = false AND user_id = $1 ORDER BY created_at DESC LIMIT 1)
      UNION ALL
      (SELECT 'note' AS type, id, content, created_at FROM notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)
      UNION ALL
      (SELECT 'event' AS type, id, title AS content, created_at FROM events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)
    ) sub ORDER BY created_at DESC LIMIT 1
  `, [currentUserId()]);
  return rows[0] || null;
}

// --- Stale todos ---

async function getStaleTodos(days = 5) {
  // Parameterised. This was the one interpolated interval in the file — `INTERVAL '${days} days'`
  // put a caller-supplied value straight into the statement text.
  const { rows } = await pool.query(
    `SELECT * FROM todos
     WHERE done = false AND user_id = $2 AND created_at < NOW() - ($1 || ' days')::interval
     ORDER BY created_at ASC`,
    [days, currentUserId()]
  );
  return rows;
}

// --- Weekly activity ---

async function getWeeklyActivity() {
  const uid = currentUserId();
  const [completedTodos, addedTodos, newLearnings, newNotes] = await Promise.all([
    pool.query(
      `SELECT content, tags FROM todos WHERE done = true AND user_id = $1 AND completed_at >= NOW() - INTERVAL '7 days' ORDER BY completed_at DESC`,
      [uid]
    ),
    pool.query(
      `SELECT content, tags FROM todos WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days' ORDER BY created_at DESC`,
      [uid]
    ),
    pool.query(
      `SELECT topic, content FROM learnings WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days' ORDER BY created_at DESC`,
      [uid]
    ),
    pool.query(
      `SELECT content, tags FROM notes WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days' ORDER BY created_at DESC`,
      [uid]
    ),
  ]);
  return {
    completedTodos: completedTodos.rows,
    addedTodos: addedTodos.rows,
    newLearnings: newLearnings.rows,
    newNotes: newNotes.rows,
  };
}

// --- Skills (The Toolbox) ---

async function getAllSkills() {
  const { rows } = await pool.query(
    'SELECT name, description, instructions FROM skills WHERE user_id = $1 ORDER BY name ASC',
    [currentUserId()]);
  return rows;
}

async function saveSkill(name, description, instructions) {
  await pool.query(
    `INSERT INTO skills (name, description, instructions, user_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, name) DO UPDATE SET description = $2, instructions = $3`,
    [name, description, instructions, currentUserId()]
  );
}

async function searchMemory(query, embedding = null) {
  const uid = currentUserId();
  if (embedding) {
    const vectorStr = `[${embedding.join(',')}]`;
    // Every query filters `embedding IS NOT NULL`. Without it, rows with no embedding come back
    // with a NULL score, and the JS filter below admitted those unconditionally — so whenever
    // embeddings were unavailable (a retired model, a missing key: both have happened here for
    // months at a time) unrelated rows were injected into every search result.
    //
    // Ordering is by `embedding <=> $1` everywhere. The knowledge query used to order by the
    // output alias `score`, which pgvector cannot answer from the HNSW index — it forced a full
    // scan of the table on every search.
    const [todos, notes, learnings, knowledge] = await Promise.all([
      pool.query(
        `SELECT 'todo' as type, id, content, tags, 1 - (embedding <=> $1) as score FROM todos
         WHERE done = false AND embedding IS NOT NULL AND user_id = $2 ORDER BY embedding <=> $1 LIMIT 3`,
        [vectorStr, uid]
      ),
      pool.query(
        `SELECT 'note' as type, id, content, tags, 1 - (embedding <=> $1) as score FROM notes
         WHERE embedding IS NOT NULL AND user_id = $2 ORDER BY embedding <=> $1 LIMIT 5`,
        [vectorStr, uid]
      ),
      pool.query(
        `SELECT 'learning' as type, id, topic as content, tags, 1 - (embedding <=> $1) as score FROM learnings
         WHERE embedding IS NOT NULL AND user_id = $2 ORDER BY embedding <=> $1 LIMIT 5`,
        [vectorStr, uid]
      ),
      pool.query(
        `SELECT 'knowledge' as type, id, fact as content, tags, 1 - (embedding <=> $1) as score FROM knowledge
         WHERE embedding IS NOT NULL AND user_id = $2 ORDER BY embedding <=> $1 LIMIT 5`,
        [vectorStr, uid]
      ),
    ]);

    // Update last_referenced_at for returned knowledge facts
    const returnedKnowledge = knowledge.rows.filter(r => r.score > 0.6);
    if (returnedKnowledge.length) {
      const ids = returnedKnowledge.map(r => r.id);
      updateKnowledgeLastReferenced(ids).catch(err => console.error('Error updating knowledge referenced time:', err));
    }

    // Every row now carries a real score, so relevance is a straight threshold.
    return [...todos.rows, ...notes.rows, ...learnings.rows, ...knowledge.rows]
      .filter(r => r.score > 0.6)
      .sort((a, b) => b.score - a.score);
  }

  // Fallback to basic ILIKE
  const [todos, notes, learnings] = await Promise.all([
    pool.query(
      `SELECT 'todo' as type, content, tags FROM todos WHERE content ILIKE $1 AND done = false AND user_id = $2 LIMIT 5`,
      [`%${query}%`, uid]
    ),
    pool.query(
      `SELECT 'note' as type, content, tags FROM notes WHERE content ILIKE $1 AND user_id = $2 LIMIT 5`,
      [`%${query}%`, uid]
    ),
    pool.query(
      `SELECT 'learning' as type, topic as content, tags FROM learnings WHERE (topic ILIKE $1 OR content ILIKE $1) AND user_id = $2 LIMIT 5`,
      [`%${query}%`, uid]
    ),
  ]);
  return [...todos.rows, ...notes.rows, ...learnings.rows];
}

// --- Standup data ---

async function getYesterdayActivity() {
  const uid = currentUserId();
  const [completed, notes] = await Promise.all([
    pool.query(
      `SELECT content FROM todos WHERE done = true AND user_id = $1 AND completed_at >= NOW() - INTERVAL '24 hours' ORDER BY completed_at DESC LIMIT 10`,
      [uid]
    ),
    pool.query(
      `SELECT content FROM notes WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 5`,
      [uid]
    ),
  ]);
  return { completed: completed.rows, notes: notes.rows };
}

// --- Rolling context summary (stored in state table, 24h TTL) ---

async function saveContextSummary(summary) {
  await pool.query(
    `INSERT INTO state (key, value, expires_at, user_id)
     VALUES ('context_summary', $1, NOW() + INTERVAL '24 hours', $2)
     ON CONFLICT (user_id, key) DO UPDATE SET value = $1, expires_at = NOW() + INTERVAL '24 hours'`,
    [summary, currentUserId()]
  );
}

async function getContextSummary() {
  const { rows } = await pool.query(
    `SELECT value FROM state WHERE key = 'context_summary' AND expires_at > NOW() AND user_id = $1`,
    [currentUserId()]
  );
  return rows[0]?.value || null;
}

// --- Push tokens (stored as JSON array in state, no expiry) ---

async function savePushToken(token) {
  const existing = await getPushTokens();
  if (!existing.includes(token)) {
    const updated = [...existing, token];
    await pool.query(
      `INSERT INTO state (key, value, expires_at, user_id)
       VALUES ('push_tokens', $1, NOW() + INTERVAL '10 years', $2)
       ON CONFLICT (user_id, key) DO UPDATE SET value = $1, expires_at = NOW() + INTERVAL '10 years'`,
      [JSON.stringify(updated), currentUserId()]
    );
  }
}

async function getPushTokens() {
  const { rows } = await pool.query(
    `SELECT value FROM state WHERE key = 'push_tokens' AND user_id = $1`, [currentUserId()]);
  try { return JSON.parse(rows[0]?.value || '[]'); } catch { return []; }
}

async function removePushToken(token) {
  const existing = await getPushTokens();
  const updated = existing.filter(t => t !== token);
  await pool.query(
    `INSERT INTO state (key, value, expires_at, user_id)
     VALUES ('push_tokens', $1, NOW() + INTERVAL '10 years', $2)
     ON CONFLICT (user_id, key) DO UPDATE SET value = $1, expires_at = NOW() + INTERVAL '10 years'`,
    [JSON.stringify(updated), currentUserId()]
  );
}


// --- Reminders ---

async function addReminder(content, remindAt) {
  await pool.query(
    'INSERT INTO reminders (content, remind_at, user_id) VALUES ($1, $2, $3)',
    [content, remindAt, currentUserId()]
  );
}

async function getDueReminders() {
  const { rows } = await pool.query(
    `UPDATE reminders SET sent = true
     WHERE sent = false AND remind_at <= NOW() AND user_id = $1
     RETURNING *`,
    [currentUserId()]
  );
  return rows;
}

// --- User insights ---

async function saveInsight(insight) {
  await pool.query('INSERT INTO user_insights (insight, user_id) VALUES ($1, $2)', [insight, currentUserId()]);
}

async function getRecentInsights(limit = 10) {
  const { rows } = await pool.query(
    'SELECT insight FROM user_insights WHERE user_id = $2 ORDER BY created_at DESC LIMIT $1',
    [limit, currentUserId()]
  );
  return rows.map(r => r.insight);
}

async function getMessageCount() {
  const { rows } = await pool.query(
    'SELECT COUNT(*) as count FROM conversations WHERE user_id = $1', [currentUserId()]);
  return parseInt(rows[0].count);
}

// --- Summary stats (for briefs) ---

// --- Goals (One Big Thing) ---

async function saveGoal(content, tags = []) {
  await pool.query(
    'INSERT INTO goals (content, tags, user_id) VALUES ($1, $2, $3)',
    [content, tags, currentUserId()]
  );
}

async function getPendingGoal() {
  const { rows } = await pool.query(
    "SELECT * FROM goals WHERE done = false AND created_at >= CURRENT_DATE AND user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [currentUserId()]
  );
  return rows[0] || null;
}

async function completeGoal(id) {
  await pool.query('UPDATE goals SET done = true, completed_at = NOW() WHERE id = $1 AND user_id = $2', [id, currentUserId()]);
}

async function getSummaryStats() {
  const [pendingTodos, unreviewed] = await Promise.all([
    getPendingTodos(),
    getUnreviewedLearnings(),
  ]);
  return { pendingTodos, unreviewed };
}

async function updateTodoReminder(id, remindAt) {
  await pool.query(
    'UPDATE todos SET remind_at = $1, reminded = false WHERE id = $2 AND user_id = $3',
    [remindAt, id, currentUserId()]
  );
}

// Returns the row it actually updated, or null when the keyword matched nothing. Without
// RETURNING the caller could not tell "reminder set" from "no todo matched" and confirmed either
// way — the same silent-success shape as the complete_todo bug fixed in dfe0288.
async function setTodoReminderByContent(keyword, remindAt) {
  const { rows } = await pool.query(
    `UPDATE todos SET remind_at = $1, reminded = false
     WHERE user_id = $3 AND id = (
       SELECT id FROM todos
       WHERE done = false AND content ILIKE $2 ESCAPE '\\' AND user_id = $3
       ORDER BY created_at DESC LIMIT 1
     )
     RETURNING id, content`,
    [remindAt, `%${escapeLike(keyword)}%`]
  );
  return rows[0] || null;
}

async function getEventById(id) {
  const { rows } = await pool.query('SELECT * FROM events WHERE id = $1 AND user_id = $2', [id, currentUserId()]);
  return rows[0] || null;
}

async function updateKnowledgeLastReferenced(ids) {
  if (!ids || !ids.length) return;
  await pool.query(
    'UPDATE knowledge SET last_referenced_at = NOW() WHERE id = ANY($1::uuid[]) AND user_id = $2',
    [ids, currentUserId()]);
}

async function processMemoryDecay() {
  const { rowCount } = await pool.query(
    "UPDATE knowledge SET flagged_for_review = true WHERE last_referenced_at < NOW() - INTERVAL '30 days' AND flagged_for_review = false AND user_id = $1",
    [currentUserId()]
  );
  const { rowCount: prunedCount } = await pool.query(
    "DELETE FROM knowledge WHERE flagged_for_review = true AND last_referenced_at < NOW() - INTERVAL '60 days' AND user_id = $1",
    [currentUserId()]
  );
  return { flagged: rowCount, pruned: prunedCount };
}

async function isDuplicateRequest(messageId) {
  if (!messageId) return false;
  await pool.query("DELETE FROM dedup_messages WHERE created_at < NOW() - INTERVAL '5 minutes'");
  try {
    await pool.query('INSERT INTO dedup_messages (message_id) VALUES ($1)', [messageId]);
    return false;
  } catch (err) {
    if (err.code === '23505') {
      return true;
    }
    throw err;
  }
}

async function queueIncomingMessage(messageId, fromNumber, messageRaw) {
  const { rows } = await pool.query(
    `INSERT INTO pending_messages (message_id, from_number, message_raw, status, user_id)
     VALUES ($1, $2, $3, 'pending', $4)
     RETURNING id`,
    [messageId, fromNumber, JSON.stringify(messageRaw), currentUserId()]
  );
  return rows[0].id;
}

// How long a claim can be held before it is assumed dead. Serverless caps a function at 60s, so
// anything still 'processing' after this lost its worker.
const STALE_CLAIM_MINUTES = 10;

async function getNextPendingMessages(limit = 10) {
  const { rows } = await pool.query(
    `SELECT * FROM pending_messages
     WHERE user_id = $3
       AND (status = 'pending'
        OR (status = 'failed' AND attempts < 3)
        OR (status = 'processing' AND attempts < 3
            AND claimed_at < NOW() - ($2 || ' minutes')::interval))
     ORDER BY created_at ASC
     LIMIT $1`,
     [limit, STALE_CLAIM_MINUTES]
  );
  return rows;
}

// Claims a message, returning true only if this caller won it. The status guard is what makes it
// a claim: without it, the webhook's immediate processQueue and the 15-minute sweep could both
// pick up the same row and answer it twice. Returns false when someone else got there first.
//
// `attempts` is incremented here rather than on failure, so a message that crashes the process
// mid-flight still counts as tried and cannot loop forever.
async function markMessageProcessing(id) {
  const { rows } = await pool.query(
    `UPDATE pending_messages
     SET status = 'processing', attempts = attempts + 1, claimed_at = NOW()
     WHERE id = $1 AND user_id = $3
       AND (status <> 'processing'
            OR claimed_at IS NULL
            OR claimed_at < NOW() - ($2 || ' minutes')::interval)
     RETURNING id`,
    [id, STALE_CLAIM_MINUTES]
  );
  return rows.length > 0;
}

async function markMessageCompleted(id, tokensInput = null, tokensOutput = null) {
  await pool.query(
    `UPDATE pending_messages
     SET status = 'completed', processed_at = NOW(), tokens_input = $2, tokens_output = $3
     WHERE id = $1 AND user_id = $4`,
    [id, tokensInput, tokensOutput, currentUserId()]
  );
}

async function markMessageFailed(id, errorMessage) {
  await pool.query(
    `UPDATE pending_messages
     SET status = 'failed', error_message = $2
     WHERE id = $1 AND user_id = $3`,
    [id, errorMessage, currentUserId()]
  );
}

async function savePromptVersion(version, promptText) {
  await pool.query(
    'INSERT INTO prompt_versions (version, prompt_text) VALUES ($1, $2) ON CONFLICT (version) DO UPDATE SET prompt_text = $2',
    [version, promptText]
  );
}

async function getPromptText(version) {
  const { rows } = await pool.query('SELECT prompt_text FROM prompt_versions WHERE version = $1', [version]);
  return rows[0]?.prompt_text || null;
}

async function linkEntityToKnowledge(entityName, entityType, knowledgeId) {
  await pool.query(
    `INSERT INTO entity_links (entity_name, entity_type, knowledge_id, user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (entity_name, knowledge_id) DO UPDATE SET entity_type = $2`,
    [entityName.toLowerCase().trim(), entityType, knowledgeId, currentUserId()]
  );
}

async function getKnowledgeByEntity(entityName) {
  const { rows } = await pool.query(
    `SELECT k.* FROM knowledge k
     JOIN entity_links el ON k.id = el.knowledge_id
     WHERE el.entity_name = $1 AND k.user_id = $2 AND el.user_id = $2
     ORDER BY k.created_at DESC`,
    [entityName.toLowerCase().trim(), currentUserId()]
  );
  return rows;
}

async function reviewLearning(id, gotRight = true) {
  const { rows } = await pool.query(
    'SELECT interval_days, review_count FROM learnings WHERE id = $1 AND user_id = $2', [id, currentUserId()]);
  if (!rows.length) return;
  const currentInterval = rows[0].interval_days || 1;
  const currentCount = rows[0].review_count || 0;
  
  let nextInterval = 1;
  if (gotRight) {
    if (currentInterval === 1) nextInterval = 3;
    else if (currentInterval === 3) nextInterval = 7;
    else if (currentInterval === 7) nextInterval = 14;
    else if (currentInterval === 14) nextInterval = 30;
    else nextInterval = Math.min(currentInterval * 2, 90);
  }
  
  await pool.query(
    `UPDATE learnings
     SET reviewed = true,
         last_reviewed_at = NOW(),
         review_count = $2 + 1,
         interval_days = $3,
         next_review_at = NOW() + ($3 || ' days')::interval
     WHERE id = $1 AND user_id = $4`,
    [id, currentCount, nextInterval, currentUserId()]
  );
}

async function getDueLearnings(limit = 5) {
  const { rows } = await pool.query(
    `SELECT * FROM learnings
     WHERE next_review_at <= NOW() AND user_id = $2
     ORDER BY next_review_at ASC, created_at DESC
     LIMIT $1`,
    [limit, currentUserId()]
  );
  return rows;
}

async function updateNoteContent(id, content, embedding = null) {
  await pool.query(
    'UPDATE notes SET content = $1, embedding = $2 WHERE id = $3 AND user_id = $4',
    [content, embedding ? `[${embedding.join(',')}]` : null, id, currentUserId()]
  );
}

async function saveState(key, value, ttlMinutes = 5) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const uid = currentUserId();
  await pool.query('DELETE FROM state WHERE key = $1 AND user_id = $2', [key, uid]);
  await pool.query(
    `INSERT INTO state (key, value, expires_at, user_id) VALUES ($1, $2, $3, $4)`,
    [key, JSON.stringify(value), expiresAt, uid]
  );
}

async function getState(key) {
  const { rows } = await pool.query(
    `SELECT value FROM state WHERE key = $1 AND expires_at > NOW() AND user_id = $2`,
    [key, currentUserId()]
  );
  if (!rows[0]) return null;

  // The `state` table has two writers with different encodings: saveState stores JSON, while
  // saveContextSummary stores a bare string under 'context_summary'. Reading the latter through
  // here used to throw a SyntaxError and take down whatever was asking. Fall back to the raw
  // value instead — a caller that wanted a string gets its string.
  try {
    return JSON.parse(rows[0].value);
  } catch {
    return rows[0].value;
  }
}

async function deleteState(key) {
  await pool.query('DELETE FROM state WHERE key = $1 AND user_id = $2', [key, currentUserId()]);
}

// Escape hatch for one-off maintenance scripts. Not for application code — use a named
// function so the query lives next to the schema it depends on.
async function rawQuery(text, params = []) {
  const { rows } = await pool.query(text, params);
  return rows;
}

async function getOldNotes(days = 30) {
  const { rows } = await pool.query(
    `SELECT * FROM notes WHERE created_at < NOW() - ($1 || ' days')::interval AND user_id = $2`,
    [days, currentUserId()]
  );
  return rows;
}

async function getConversationsLastWeek() {
  const { rows } = await pool.query(
    `SELECT role, content, created_at FROM conversations
     WHERE created_at >= NOW() - INTERVAL '7 days' AND user_id = $1
     ORDER BY created_at ASC`,
    [currentUserId()]
  );
  return rows;
}

// --- Users ---
//
// The one group of queries that must NOT be user-scoped: these are how a user is identified in
// the first place, so they run before any scope exists.

async function getUserByNumber(waNumber) {
  const { rows } = await pool.query(
    'SELECT id, wa_number, name, tz, active FROM users WHERE wa_number = $1',
    [waNumber]
  );
  return rows[0] || null;
}

async function getActiveUsers() {
  const { rows } = await pool.query(
    'SELECT id, wa_number, name, tz, active FROM users WHERE active = true ORDER BY created_at'
  );
  return rows;
}

// The owner — the person the single-user era belonged to. Entry points that have no sender to
// look up (the dashboard, a cron before fan-out lands) resolve through here.
async function getOwner() {
  const number = process.env.MY_WHATSAPP_NUMBER;
  if (!number) throw new Error('MY_WHATSAPP_NUMBER is not set — cannot resolve the owner');
  const user = await getUserByNumber(number);
  if (!user) throw new Error(`No users row for ${number} — run node src/migrate_db.js`);
  return user;
}

module.exports = {
  getUserByNumber, getActiveUsers, getOwner,
  addTodo, getPendingTodos, completeTodo, completeTodoByContent,
  addNote, updateNoteTags, getRecentNotes, deleteNote, getLastCreatedItem,
  addLearning, getUnreviewedLearnings, markLearningReviewed,
  saveMessage, getRecentHistory,
  addReminder, getDueReminders, getDueTodoReminders,
  saveInsight, getRecentInsights, getMessageCount,
  saveKnowledge, getAllKnowledge, getRelevantKnowledge, trimConversations,
  saveContextSummary, getContextSummary,
  
  addEvent, getWeekEvents, getUpcomingEvents,
  listEvents, findEventByTitle, deleteEvent, updateEvent, getEventsStartingSoon,
  searchMemory, getYesterdayActivity,
  getStaleTodos, getWeeklyActivity,
  getAnalytics, getRecentContent,
  getSummaryStats,
  getAllSkills, saveSkill,
  saveGoal, getPendingGoal, completeGoal,
  updateTodoReminder, setTodoReminderByContent, getEventById,
  getUpcomingReminders, claimTodoReminder, claimEventReminder, EVENT_LEAD_MINUTES,
  savePushToken, getPushTokens, removePushToken,
  
  // New functions exported
  updateKnowledgeLastReferenced, processMemoryDecay,
  isDuplicateRequest, queueIncomingMessage, getNextPendingMessages,
  markMessageProcessing, markMessageCompleted, markMessageFailed,
  savePromptVersion, getPromptText,
  linkEntityToKnowledge, getKnowledgeByEntity,
  reviewLearning, getDueLearnings,
  updateNoteContent, saveState, getState, deleteState,
  getOldNotes, getConversationsLastWeek,
  rawQuery,
};
