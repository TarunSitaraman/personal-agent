const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on('connect', client => {
  client.query("SET timezone='Asia/Kolkata'");
});

// --- Todos ---

async function addTodo(content, context, remindAt = null) {
  await pool.query(
    'INSERT INTO todos (content, context, remind_at) VALUES ($1, $2, $3)',
    [content, context, remindAt || null]
  );
}

async function getDueTodoReminders() {
  const { rows } = await pool.query(
    `UPDATE todos SET reminded = true
     WHERE done = false AND reminded = false AND remind_at <= NOW()
     RETURNING *`
  );
  return rows;
}

async function getPendingTodos(context = null) {
  const query = context
    ? 'SELECT * FROM todos WHERE done = false AND context = $1 ORDER BY created_at DESC LIMIT 10'
    : 'SELECT * FROM todos WHERE done = false ORDER BY created_at DESC LIMIT 10';
  const params = context ? [context] : [];
  const { rows } = await pool.query(query, params);
  return rows;
}

async function completeTodo(id) {
  await pool.query(
    'UPDATE todos SET done = true, completed_at = NOW() WHERE id = $1',
    [id]
  );
}

async function completeTodoByContent(keyword) {
  const { rows } = await pool.query(
    `UPDATE todos SET done = true, completed_at = NOW()
     WHERE done = false AND content ILIKE $1
     RETURNING content`,
    [`%${keyword}%`]
  );
  return rows;
}

// --- Notes ---

async function addNote(content, context, tags = [], embedding = null) {
  const { rows } = await pool.query(
    'INSERT INTO notes (content, context, tags, embedding) VALUES ($1, $2, $3, $4) RETURNING id',
    [content, context, tags, embedding ? `[${embedding.join(',')}]` : null]
  );
  return rows[0].id;
}

async function updateNoteTags(id, tags) {
  await pool.query('UPDATE notes SET tags = $1 WHERE id = $2', [tags, id]);
}

async function getRecentNotes(context = null, limit = 5) {
  const query = context
    ? 'SELECT * FROM notes WHERE context = $1 ORDER BY created_at DESC LIMIT $2'
    : 'SELECT * FROM notes ORDER BY created_at DESC LIMIT $1';
  const params = context ? [context, limit] : [limit];
  const { rows } = await pool.query(query, params);
  return rows;
}

// --- Learnings ---

async function addLearning(topic, content, source = null, embedding = null) {
  await pool.query(
    'INSERT INTO learnings (topic, content, source, embedding) VALUES ($1, $2, $3, $4)',
    [topic, content, source, embedding ? `[${embedding.join(',')}]` : null]
  );
}

async function getUnreviewedLearnings(limit = 5) {
  const { rows } = await pool.query(
    'SELECT * FROM learnings WHERE reviewed = false ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows;
}

async function markLearningReviewed(id) {
  await pool.query(
    'UPDATE learnings SET reviewed = true, last_reviewed_at = NOW() WHERE id = $1',
    [id]
  );
}

// --- Permanent knowledge store ---

async function saveKnowledge(fact, embedding = null, context = 'personal') {
  await pool.query(
    'INSERT INTO knowledge (subject, fact, embedding, context) VALUES ($1, $2, $3, $4)',
    ['general', fact, embedding ? `[${embedding.join(',')}]` : null, context]
  );
}

async function getAllKnowledge() {
  const { rows } = await pool.query('SELECT fact FROM knowledge ORDER BY created_at ASC');
  return rows.map(r => r.fact);
}

async function trimConversations(keep = 200) {
  await pool.query(`
    DELETE FROM conversations WHERE id NOT IN (
      SELECT id FROM conversations ORDER BY created_at DESC LIMIT $1
    )
  `, [keep]);
}

// --- Conversation history ---

async function saveMessage(role, content) {
  await pool.query(
    'INSERT INTO conversations (role, content) VALUES ($1, $2)',
    [role, content]
  );
}

async function getRecentHistory(limit = 20) {
  const { rows } = await pool.query(
    `SELECT role, content FROM (
      SELECT * FROM conversations ORDER BY created_at DESC LIMIT $1
    ) sub ORDER BY created_at ASC`,
    [limit]
  );
  return rows;
}

// --- Analytics ---

async function getAnalytics() {
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
      FROM todos
    `),
    pool.query(`
      SELECT context,
        COUNT(*) FILTER (WHERE done = false) AS open,
        COUNT(*) FILTER (WHERE done = true) AS done
      FROM todos GROUP BY context
    `),
    pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('week', created_at), 'Mon DD') AS week,
        COUNT(*) AS added,
        COUNT(*) FILTER (WHERE done = true) AS completed
      FROM todos
      WHERE created_at >= NOW() - INTERVAL '8 weeks'
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY DATE_TRUNC('week', created_at)
    `),
    pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('week', created_at), 'Mon DD') AS week,
        COUNT(*) AS count
      FROM learnings
      WHERE created_at >= NOW() - INTERVAL '8 weeks'
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY DATE_TRUNC('week', created_at)
    `),
    pool.query(`
      SELECT * FROM (
        SELECT 'todo' AS type, content, context, created_at FROM todos ORDER BY created_at DESC LIMIT 5
      ) t
      UNION ALL
      SELECT * FROM (
        SELECT 'note' AS type, content, context, created_at FROM notes ORDER BY created_at DESC LIMIT 5
      ) n
      UNION ALL
      SELECT * FROM (
        SELECT 'learning' AS type, topic AS content, null AS context, created_at FROM learnings ORDER BY created_at DESC LIMIT 5
      ) l
      ORDER BY created_at DESC LIMIT 15
    `),
    pool.query('SELECT COUNT(*) AS count FROM notes'),
    pool.query('SELECT COUNT(*) AS count FROM learnings'),
  ]);

  return {
    todoStats: todoStats.rows[0],
    contextBreakdown: contextBreakdown.rows,
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
    pool.query(`SELECT id, 'note' AS type, content, tags FROM notes ORDER BY created_at DESC LIMIT $1`, [limit]),
    pool.query(`SELECT id, 'learning' AS type, topic AS content, null AS tags FROM learnings ORDER BY created_at DESC LIMIT $1`, [limit]),
  ]);
  return [...notes.rows, ...learnings.rows];
}

// --- Events / Calendar ---

async function addEvent(title, startAt, endAt, context, recurrence = 'none') {
  await pool.query(
    'INSERT INTO events (title, start_at, end_at, context, recurrence) VALUES ($1, $2, $3, $4, $5)',
    [title, startAt, endAt || null, context, recurrence]
  );
}

async function getWeekEvents(weekStart, weekEnd) {
  const { rows } = await pool.query(
    `SELECT id, title, start_at, end_at, context, recurrence, source
     FROM events
     WHERE (recurrence = 'none' AND start_at >= $1 AND start_at < $2)
        OR recurrence IN ('daily', 'weekdays', 'weekly')
     ORDER BY start_at`,
    [weekStart, weekEnd]
  );
  return rows;
}

async function getUpcomingEvents(hours = 24) {
  const { rows } = await pool.query(
    `SELECT title, start_at, context FROM events
     WHERE recurrence = 'none' AND start_at >= NOW() AND start_at <= NOW() + ($1 || ' hours')::interval
     ORDER BY start_at LIMIT 5`,
    [hours]
  );
  return rows;
}

async function listEvents(context = null, limit = 10) {
  const query = context
    ? `SELECT id, title, start_at, end_at, context, recurrence FROM events WHERE context = $1 ORDER BY start_at LIMIT $2`
    : `SELECT id, title, start_at, end_at, context, recurrence FROM events ORDER BY start_at LIMIT $1`;
  const params = context ? [context, limit] : [limit];
  const { rows } = await pool.query(query, params);
  return rows;
}

async function findEventByTitle(keyword) {
  const { rows } = await pool.query(
    `SELECT id, title, start_at, end_at, context, recurrence FROM events WHERE title ILIKE $1 ORDER BY start_at LIMIT 3`,
    [`%${keyword}%`]
  );
  return rows;
}

async function deleteEvent(id) {
  await pool.query('DELETE FROM events WHERE id = $1', [id]);
}

async function updateEvent(id, updates) {
  const fields = [];
  const values = [];
  let idx = 1;
  if (updates.title !== undefined) { fields.push(`title = $${idx++}`); values.push(updates.title); }
  if (updates.start_at !== undefined) { fields.push(`start_at = $${idx++}`); values.push(updates.start_at); }
  if (updates.end_at !== undefined) { fields.push(`end_at = $${idx++}`); values.push(updates.end_at); }
  if (updates.recurrence !== undefined) { fields.push(`recurrence = $${idx++}`); values.push(updates.recurrence); }
  if (!fields.length) return;
  values.push(id);
  await pool.query(`UPDATE events SET ${fields.join(', ')} WHERE id = $${idx}`, values);
}

async function getEventsStartingSoon(minutesFrom = 14, minutesTo = 16) {
  const { rows } = await pool.query(
    `SELECT id, title, start_at, context FROM events
     WHERE recurrence = 'none'
       AND start_at >= NOW() + ($1 || ' minutes')::interval
       AND start_at < NOW() + ($2 || ' minutes')::interval
     ORDER BY start_at`,
    [minutesFrom, minutesTo]
  );
  return rows;
}

async function deleteNote(id) {
  await pool.query('DELETE FROM notes WHERE id = $1', [id]);
}

async function getLastCreatedItem() {
  const { rows } = await pool.query(`
    SELECT type, id, content, created_at FROM (
      SELECT 'todo' AS type, id, content, created_at FROM todos WHERE done = false ORDER BY created_at DESC LIMIT 1
      UNION ALL
      SELECT 'note' AS type, id, content, created_at FROM notes ORDER BY created_at DESC LIMIT 1
      UNION ALL
      SELECT 'event' AS type, id, title AS content, created_at FROM events ORDER BY created_at DESC LIMIT 1
    ) sub ORDER BY created_at DESC LIMIT 1
  `);
  return rows[0] || null;
}

// --- Stale todos ---

async function getStaleTodos(days = 5) {
  const { rows } = await pool.query(
    `SELECT * FROM todos WHERE done = false AND created_at < NOW() - INTERVAL '${days} days' ORDER BY created_at ASC`
  );
  return rows;
}

// --- Weekly activity ---

async function getWeeklyActivity() {
  const [completedTodos, addedTodos, newLearnings, newNotes] = await Promise.all([
    pool.query(
      `SELECT content, context FROM todos WHERE done = true AND completed_at >= NOW() - INTERVAL '7 days' ORDER BY completed_at DESC`
    ),
    pool.query(
      `SELECT content, context FROM todos WHERE created_at >= NOW() - INTERVAL '7 days' ORDER BY created_at DESC`
    ),
    pool.query(
      `SELECT topic, content FROM learnings WHERE created_at >= NOW() - INTERVAL '7 days' ORDER BY created_at DESC`
    ),
    pool.query(
      `SELECT content, context FROM notes WHERE created_at >= NOW() - INTERVAL '7 days' ORDER BY created_at DESC`
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
  const { rows } = await pool.query('SELECT name, description, instructions FROM skills ORDER BY name ASC');
  return rows;
}

async function saveSkill(name, description, instructions) {
  await pool.query(
    'INSERT INTO skills (name, description, instructions) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET description = $2, instructions = $3',
    [name, description, instructions]
  );
}

async function searchMemory(query, embedding = null, currentMode = 'personal') {
  if (embedding) {
    const vectorStr = `[${embedding.join(',')}]`;
    const [todos, notes, learnings, knowledge] = await Promise.all([
      // Todos don't have embeddings yet, still use ILIKE
      pool.query(
        `SELECT 'todo' as type, content, context, 1 - (NULL::vector <=> NULL::vector) as score FROM todos WHERE content ILIKE $1 AND done = false LIMIT 3`,
        [`%${query}%`]
      ),
      pool.query(
        `SELECT 'note' as type, content, context, 1 - (embedding <=> $1) as score FROM notes ORDER BY embedding <=> $1 LIMIT 5`,
        [vectorStr]
      ),
      pool.query(
        `SELECT 'learning' as type, topic as content, context, 1 - (embedding <=> $1) as score FROM learnings ORDER BY embedding <=> $1 LIMIT 5`,
        [vectorStr]
      ),
      pool.query(
        `SELECT 'knowledge' as type, fact as content, context, 
         (1 - (embedding <=> $1)) + (CASE WHEN context = $2 THEN 0.2 ELSE 0 END) as score 
         FROM knowledge ORDER BY score DESC LIMIT 5`,
        [vectorStr, currentMode]
      ),
    ]);
    return [...todos.rows, ...notes.rows, ...learnings.rows, ...knowledge.rows]
      .filter(r => r.score === null || r.score > 0.6) // Filter out low relevance if score exists
      .sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  // Fallback to basic ILIKE
  const [todos, notes, learnings] = await Promise.all([
    pool.query(
      `SELECT 'todo' as type, content, context FROM todos WHERE content ILIKE $1 AND done = false LIMIT 5`,
      [`%${query}%`]
    ),
    pool.query(
      `SELECT 'note' as type, content, context FROM notes WHERE content ILIKE $1 LIMIT 5`,
      [`%${query}%`]
    ),
    pool.query(
      `SELECT 'learning' as type, topic as content, context FROM learnings WHERE topic ILIKE $1 OR content ILIKE $1 LIMIT 5`,
      [`%${query}%`]
    ),
  ]);
  return [...todos.rows, ...notes.rows, ...learnings.rows];
}

// --- Standup data ---

async function getYesterdayActivity(context) {
  const [completed, notes] = await Promise.all([
    pool.query(
      `SELECT content FROM todos WHERE context = $1 AND done = true AND completed_at >= NOW() - INTERVAL '24 hours' ORDER BY completed_at DESC LIMIT 10`,
      [context]
    ),
    pool.query(
      `SELECT content FROM notes WHERE context = $1 AND created_at >= NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 5`,
      [context]
    ),
  ]);
  return { completed: completed.rows, notes: notes.rows };
}

// --- Rolling context summary (stored in state table, 24h TTL) ---

async function saveContextSummary(summary) {
  await pool.query(
    `INSERT INTO state (key, value, expires_at)
     VALUES ('context_summary', $1, NOW() + INTERVAL '24 hours')
     ON CONFLICT (key) DO UPDATE SET value = $1, expires_at = NOW() + INTERVAL '24 hours'`,
    [summary]
  );
}

async function getContextSummary() {
  const { rows } = await pool.query(
    `SELECT value FROM state WHERE key = 'context_summary' AND expires_at > NOW()`
  );
  return rows[0]?.value || null;
}

// --- Mode override (persisted so it survives restarts) ---

async function saveModeOverride(mode, expiry) {
  await pool.query(
    `INSERT INTO state (key, value, expires_at)
     VALUES ('mode_override', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $1, expires_at = $2`,
    [mode, expiry]
  );
}

async function loadModeOverride() {
  const { rows } = await pool.query(
    `SELECT value, expires_at FROM state
     WHERE key = 'mode_override' AND expires_at > NOW()`
  );
  return rows[0] || null;
}

async function clearModeOverride() {
  await pool.query(`DELETE FROM state WHERE key = 'mode_override'`);
}

// --- Reminders ---

async function addReminder(content, remindAt) {
  await pool.query(
    'INSERT INTO reminders (content, remind_at) VALUES ($1, $2)',
    [content, remindAt]
  );
}

async function getDueReminders() {
  const { rows } = await pool.query(
    `UPDATE reminders SET sent = true
     WHERE sent = false AND remind_at <= NOW()
     RETURNING *`
  );
  return rows;
}

// --- User insights ---

async function saveInsight(insight) {
  await pool.query('INSERT INTO user_insights (insight) VALUES ($1)', [insight]);
}

async function getRecentInsights(limit = 10) {
  const { rows } = await pool.query(
    'SELECT insight FROM user_insights ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows.map(r => r.insight);
}

async function getMessageCount() {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM conversations');
  return parseInt(rows[0].count);
}

// --- Summary stats (for briefs) ---

async function getSummaryStats() {
  const [hexTodos, srqTodos, unreviewed] = await Promise.all([
    getPendingTodos('hexaware'),
    getPendingTodos('smartresq'),
    getUnreviewedLearnings(),
  ]);
  return { hexTodos, srqTodos, unreviewed };
}

module.exports = {
  addTodo, getPendingTodos, completeTodo, completeTodoByContent,
  addNote, updateNoteTags, getRecentNotes, deleteNote, getLastCreatedItem,
  addLearning, getUnreviewedLearnings, markLearningReviewed,
  saveMessage, getRecentHistory,
  addReminder, getDueReminders, getDueTodoReminders,
  saveInsight, getRecentInsights, getMessageCount,
  saveKnowledge, getAllKnowledge, trimConversations,
  saveContextSummary, getContextSummary,
  saveModeOverride, loadModeOverride, clearModeOverride,
  addEvent, getWeekEvents, getUpcomingEvents,
  listEvents, findEventByTitle, deleteEvent, updateEvent, getEventsStartingSoon,
  searchMemory, getYesterdayActivity,
  getStaleTodos, getWeeklyActivity,
  getAnalytics, getRecentContent,
  getSummaryStats,
};
