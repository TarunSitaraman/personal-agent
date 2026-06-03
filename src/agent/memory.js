const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- Todos ---

async function addTodo(content, context) {
  await pool.query(
    'INSERT INTO todos (content, context) VALUES ($1, $2)',
    [content, context]
  );
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

async function addNote(content, context, tags = []) {
  const { rows } = await pool.query(
    'INSERT INTO notes (content, context, tags) VALUES ($1, $2, $3) RETURNING id',
    [content, context, tags]
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

async function addLearning(topic, content, source = null) {
  await pool.query(
    'INSERT INTO learnings (topic, content, source) VALUES ($1, $2, $3)',
    [topic, content, source]
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

// --- Search ---

async function searchMemory(query) {
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
  addNote, updateNoteTags, getRecentNotes,
  addLearning, getUnreviewedLearnings, markLearningReviewed,
  saveMessage, getRecentHistory,
  addReminder, getDueReminders,
  saveInsight, getRecentInsights, getMessageCount,
  searchMemory, getYesterdayActivity,
  getStaleTodos, getWeeklyActivity,
  getSummaryStats,
};
