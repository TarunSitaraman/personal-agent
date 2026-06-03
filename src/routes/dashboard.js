const express = require('express');
const { getAnalytics, getAllKnowledge, getPendingTodos, getRecentNotes, getUnreviewedLearnings } = require('../agent/memory');
const { getOpenPRs, getOpenIssues, getRecentCommits } = require('../integrations/github');
const { getCurrentMode, getModeDescription } = require('../agent/context');

const router = express.Router();

const MODE_CONFIG = {
  hexaware: { label: 'Hexaware', color: '#3b82f6', bg: '#1e3a5f', emoji: '💼' },
  smartresq: { label: 'SmartResQ', color: '#10b981', bg: '#064e3b', emoji: '🚑' },
  personal: { label: 'Personal', color: '#8b5cf6', bg: '#2e1065', emoji: '🌙' },
};

router.get('/', async (req, res) => {
  if (req.query.token !== process.env.DASHBOARD_TOKEN) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const mode = getCurrentMode();
    const modeConf = MODE_CONFIG[mode] || MODE_CONFIG.personal;

    const [analytics, openPRs, openIssues, recentCommits, knowledge, allTodos, recentNotes, learnings] = await Promise.all([
      getAnalytics(),
      getOpenPRs(),
      getOpenIssues(),
      getRecentCommits(),
      getAllKnowledge(),
      getPendingTodos(),
      getRecentNotes(null, 6),
      getUnreviewedLearnings(5),
    ]);

    const hexTodos = allTodos.filter(t => t.context === 'hexaware');
    const srqTodos = allTodos.filter(t => t.context === 'smartresq');
    const personalTodos = allTodos.filter(t => t.context !== 'hexaware' && t.context !== 'smartresq');

    const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

    const renderTodoSection = (todos, label, color) => {
      if (!todos.length) return `<div class="empty-state">No open todos</div>`;
      return todos.map((t) => `
        <div class="todo-item">
          <span class="todo-ctx">${escHtml(label)}</span>
          <span class="todo-sep">·</span>
          <span class="todo-text">${escHtml(t.content)}</span>
        </div>`).join('');
    };

    const renderPRs = () => openPRs.length
      ? openPRs.map(pr => `<div class="list-item"><span class="tag">PR</span><span class="list-text">${escHtml(pr)}</span></div>`).join('')
      : `<div class="empty-state">No open PRs</div>`;

    const renderIssues = () => openIssues.slice(0, 6).length
      ? openIssues.slice(0, 6).map(i => `<div class="list-item"><span class="tag">#</span><span class="list-text">${escHtml(i)}</span></div>`).join('')
      : `<div class="empty-state">No open issues</div>`;

    const renderCommits = () => recentCommits.slice(0, 4).length
      ? recentCommits.slice(0, 4).map(c => `<div class="list-item"><span class="tag">commit</span><span class="list-text">${escHtml(c)}</span></div>`).join('')
      : `<div class="empty-state">No recent commits</div>`;

    const renderNotes = () => recentNotes.length
      ? recentNotes.map(n => `<div class="list-item"><span class="tag">${escHtml(n.context)}</span><span class="list-text">${escHtml(n.content.slice(0, 80))}${n.content.length > 80 ? '…' : ''}</span></div>`).join('')
      : `<div class="empty-state">No notes yet</div>`;

    const renderLearnings = () => learnings.length
      ? learnings.map(l => `<div class="learning-item"><div class="learning-topic">${escHtml(l.topic)}</div><div class="learning-content">${escHtml(l.content.slice(0, 60))}${l.content.length > 60 ? '…' : ''}</div></div>`).join('')
      : `<div class="empty-state">No unreviewed learnings</div>`;

    const renderKnowledge = () => knowledge.length
      ? knowledge.map(k => `<div class="knowledge-item">${escHtml(k)}</div>`).join('')
      : `<div class="empty-state">Nothing taught yet — tell Blu about your world</div>`;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="60">
<title>Blu — Command Centre</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0a0b0e;
  --surface: #111318;
  --border: #1f2230;
  --text: #f8fafc;
  --secondary: #94a3b8;
  --muted: #3d4663;
  --accent: #6366f1;
}
html, body { background: var(--bg); }
body {
  color: var(--text);
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.5;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}

/* Header */
.header { display: flex; align-items: center; justify-content: space-between; height: 48px; padding: 0 28px; border-bottom: 1px solid var(--border); }
.logo { font-size: 16px; font-weight: 300; letter-spacing: 0.15em; text-transform: uppercase; color: var(--text); }
.header-time { font-size: 11px; letter-spacing: 0.04em; color: var(--secondary); display: flex; align-items: center; gap: 8px; }
.refresh-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 0 rgba(99,102,241,0.6); animation: pulse 2.4s ease-out infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(99,102,241,0.5); } 70% { box-shadow: 0 0 0 6px rgba(99,102,241,0); } 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); } }

/* Layout */
.main { display: grid; grid-template-columns: 320px 1fr; gap: 20px; align-items: start; padding: 24px 28px 40px; max-width: 1500px; margin: 0 auto; }
.sidebar { display: flex; flex-direction: column; gap: 20px; }
.content { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-content: start; }

/* Cards */
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 24px; }
.card-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 18px; }
.card-title { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
.card-count { font-size: 11px; font-weight: 400; color: var(--secondary); }

/* Stats row */
.stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px 18px; }
.stat-value { font-size: 28px; font-weight: 700; line-height: 1; color: var(--text); }
.stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--secondary); margin-top: 8px; }

/* Mode card */
.mode-card { background: var(--surface); border: 1px solid var(--border); border-left: 2px solid ${modeConf.color}; border-radius: 8px; padding: 24px; }
.mode-eyebrow { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin-bottom: 12px; }
.mode-name { font-size: 18px; font-weight: 400; color: var(--text); margin-bottom: 8px; letter-spacing: 0.01em; }
.mode-desc { font-size: 13px; color: var(--secondary); line-height: 1.55; }

/* Todo items */
.todo-group + .todo-group { margin-top: 16px; }
.todo-item { display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px; padding: 9px 0; border-bottom: 1px solid var(--border); }
.todo-item:last-child { border-bottom: none; }
.todo-ctx { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
.todo-sep { color: var(--muted); }
.todo-text { font-size: 13px; color: var(--text); flex: 1; }

/* List items */
.list-item { display: flex; align-items: baseline; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--border); }
.list-item:last-child { border-bottom: none; }
.list-text { font-size: 13px; color: var(--text); line-height: 1.45; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; letter-spacing: 0.06em; text-transform: lowercase; background: #1f2230; color: var(--secondary); white-space: nowrap; flex-shrink: 0; }

/* Learnings */
.learning-item { padding: 11px 0; border-bottom: 1px solid var(--border); }
.learning-item:last-child { border-bottom: none; }
.learning-topic { font-size: 13px; color: var(--text); margin-bottom: 3px; }
.learning-content { font-size: 12px; color: var(--secondary); line-height: 1.45; }

/* Knowledge */
.knowledge-item { font-size: 13px; color: var(--secondary); padding: 9px 0 9px 16px; position: relative; border-bottom: 1px solid var(--border); line-height: 1.45; }
.knowledge-item:last-child { border-bottom: none; }
.knowledge-item::before { content: ''; position: absolute; left: 0; top: 15px; width: 5px; height: 1px; background: var(--accent); }

.empty-state { font-size: 13px; color: var(--muted); padding: 4px 0; }

/* Full width card in grid */
.full-width { grid-column: 1 / -1; }

/* Scrollbar */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

@media (max-width: 960px) {
  .main { grid-template-columns: 1fr; }
  .content { grid-template-columns: 1fr; }
}
</style>
</head>
<body>

<header class="header">
  <div class="logo">blu</div>
  <div class="header-time"><span class="refresh-dot"></span>${now} IST</div>
</header>

<div class="main">

  <!-- SIDEBAR -->
  <aside class="sidebar">

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">${analytics.todoStats.open}</div>
        <div class="stat-label">Open todos</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${analytics.todoStats.completed_this_week}</div>
        <div class="stat-label">Done / week</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${openPRs.length}</div>
        <div class="stat-label">Open PRs</div>
      </div>
    </div>

    <div class="mode-card">
      <div class="mode-eyebrow">Current mode</div>
      <div class="mode-name">${modeConf.label}</div>
      <div class="mode-desc">${getModeDescription(mode)}</div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">Open Todos</div>
        <div class="card-count">${allTodos.length}</div>
      </div>
      <div>
        ${hexTodos.length ? `<div class="todo-group">${renderTodoSection(hexTodos, 'Hexaware', '#3b82f6')}</div>` : ''}
        ${srqTodos.length ? `<div class="todo-group">${renderTodoSection(srqTodos, 'SmartResQ', '#10b981')}</div>` : ''}
        ${personalTodos.length ? `<div class="todo-group">${renderTodoSection(personalTodos, 'Personal', '#8b5cf6')}</div>` : ''}
        ${!allTodos.length ? `<div class="empty-state">All clear — no open todos</div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">What Blu Knows</div>
        <div class="card-count">${knowledge.length}</div>
      </div>
      <div>${renderKnowledge()}</div>
    </div>

  </aside>

  <!-- MAIN CONTENT -->
  <main class="content">

    <div class="card">
      <div class="card-head">
        <div class="card-title">Open PRs</div>
        <div class="card-count">${openPRs.length}</div>
      </div>
      <div>${renderPRs()}</div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">Open Issues</div>
        <div class="card-count">${openIssues.length}</div>
      </div>
      <div>${renderIssues()}</div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">Recent Commits</div>
      </div>
      <div>${renderCommits()}</div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">Unreviewed Learnings</div>
        <div class="card-count">${learnings.length}</div>
      </div>
      <div>${renderLearnings()}</div>
    </div>

    <div class="card full-width">
      <div class="card-head">
        <div class="card-title">Recent Notes</div>
        <div class="card-count">${analytics.totalNotes}</div>
      </div>
      <div>${renderNotes()}</div>
    </div>

  </main>
</div>

</body>
</html>`);
  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.status(500).send('Error loading dashboard');
  }
});

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ctxColor(ctx) {
  if (ctx === 'hexaware') return '#3b82f6';
  if (ctx === 'smartresq') return '#10b981';
  return '#8b5cf6';
}

module.exports = router;
