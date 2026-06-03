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
  await pool.query(
    'INSERT INTO notes (content, context, tags) VALUES ($1, $2, $3)',
    [content, context, tags]
  );
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
  addNote, getRecentNotes,
  addLearning, getUnreviewedLearnings, markLearningReviewed,
  saveMessage, getRecentHistory,
  getSummaryStats,
};
