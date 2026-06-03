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
      return todos.map((t, i) => `
        <div class="todo-item">
          <span class="todo-num" style="color:${color}">${i + 1}</span>
          <span class="todo-text">${escHtml(t.content)}</span>
        </div>`).join('');
    };

    const renderPRs = () => openPRs.length
      ? openPRs.map(pr => `<div class="list-item"><span class="badge badge-green">PR</span>${escHtml(pr)}</div>`).join('')
      : `<div class="empty-state">No open PRs</div>`;

    const renderIssues = () => openIssues.slice(0, 6).length
      ? openIssues.slice(0, 6).map(i => `<div class="list-item"><span class="badge badge-blue">#</span>${escHtml(i)}</div>`).join('')
      : `<div class="empty-state">No open issues</div>`;

    const renderCommits = () => recentCommits.slice(0, 4).length
      ? recentCommits.slice(0, 4).map(c => `<div class="list-item"><span class="badge badge-purple">↑</span>${escHtml(c)}</div>`).join('')
      : `<div class="empty-state">No recent commits</div>`;

    const renderNotes = () => recentNotes.length
      ? recentNotes.map(n => `<div class="list-item"><span class="ctx-tag" style="background:${ctxColor(n.context)}20;color:${ctxColor(n.context)}">${n.context}</span>${escHtml(n.content.slice(0, 80))}${n.content.length > 80 ? '…' : ''}</div>`).join('')
      : `<div class="empty-state">No notes yet</div>`;

    const renderLearnings = () => learnings.length
      ? learnings.map(l => `<div class="list-item"><span class="badge badge-purple">💡</span><div><div class="learning-topic">${escHtml(l.topic)}</div><div class="learning-content">${escHtml(l.content.slice(0, 60))}${l.content.length > 60 ? '…' : ''}</div></div></div>`).join('')
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
  --bg: #080c14;
  --surface: #0f1625;
  --surface2: #141d2e;
  --border: #1e2a3a;
  --text: #e2e8f0;
  --muted: #4a5568;
  --blue: #3b82f6;
  --green: #10b981;
  --purple: #8b5cf6;
  --orange: #f59e0b;
  --red: #ef4444;
}
body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; min-height: 100vh; }

/* Header */
.header { display: flex; align-items: center; justify-content: space-between; padding: 20px 28px 16px; border-bottom: 1px solid var(--border); }
.header-left { display: flex; align-items: center; gap: 12px; }
.logo { font-size: 1.25rem; font-weight: 800; letter-spacing: -0.02em; color: #fff; }
.logo span { color: var(--blue); }
.mode-pill { display: flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; border: 1px solid; }
.header-time { font-size: 0.75rem; color: var(--muted); }

/* Layout */
.main { display: grid; grid-template-columns: 340px 1fr; gap: 0; height: calc(100vh - 57px); overflow: hidden; }
.sidebar { border-right: 1px solid var(--border); overflow-y: auto; padding: 20px 16px; display: flex; flex-direction: column; gap: 16px; }
.content { overflow-y: auto; padding: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-content: start; }

/* Cards */
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.card-header { padding: 12px 16px 8px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); }
.card-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.card-count { font-size: 0.7rem; font-weight: 600; background: var(--surface2); padding: 2px 8px; border-radius: 999px; color: var(--text); }
.card-body { padding: 10px 16px 12px; }

/* Stats row */
.stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.stat-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 4px; }
.stat-value { font-size: 1.6rem; font-weight: 800; line-height: 1; }
.stat-sub { font-size: 0.7rem; color: var(--muted); margin-top: 4px; }

/* Mode card */
.mode-card { background: linear-gradient(135deg, ${modeConf.bg}, var(--surface)); border: 1px solid ${modeConf.color}40; border-radius: 12px; padding: 16px; }
.mode-emoji { font-size: 2rem; margin-bottom: 8px; }
.mode-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: ${modeConf.color}; font-weight: 700; margin-bottom: 4px; }
.mode-name { font-size: 1.2rem; font-weight: 800; color: #fff; margin-bottom: 6px; }
.mode-desc { font-size: 0.75rem; color: var(--muted); line-height: 1.5; }

/* Todo items */
.todo-item { display: flex; gap: 10px; align-items: flex-start; padding: 7px 0; border-bottom: 1px solid var(--border); }
.todo-item:last-child { border-bottom: none; }
.todo-num { font-size: 0.7rem; font-weight: 700; min-width: 16px; margin-top: 1px; }
.todo-text { font-size: 0.82rem; color: var(--text); line-height: 1.4; }
.context-section { margin-bottom: 4px; }
.context-label { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 10px 0 4px; color: var(--muted); }

/* List items */
.list-item { display: flex; align-items: flex-start; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--border); font-size: 0.8rem; line-height: 1.4; color: var(--text); }
.list-item:last-child { border-bottom: none; }
.badge { display: inline-flex; align-items: center; justify-content: center; padding: 1px 7px; border-radius: 4px; font-size: 0.65rem; font-weight: 700; white-space: nowrap; flex-shrink: 0; margin-top: 1px; }
.badge-green { background: #064e3b; color: #10b981; }
.badge-blue { background: #1e3a5f; color: #3b82f6; }
.badge-purple { background: #2e1065; color: #8b5cf6; }
.ctx-tag { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 0.65rem; font-weight: 600; white-space: nowrap; flex-shrink: 0; margin-top: 1px; }
.learning-topic { font-weight: 600; font-size: 0.8rem; }
.learning-content { font-size: 0.75rem; color: var(--muted); margin-top: 2px; }
.knowledge-item { font-size: 0.8rem; color: var(--text); padding: 6px 0; border-bottom: 1px solid var(--border); line-height: 1.4; }
.knowledge-item:last-child { border-bottom: none; }
.knowledge-item::before { content: '◆ '; color: var(--purple); font-size: 0.5rem; vertical-align: middle; }
.empty-state { font-size: 0.78rem; color: var(--muted); padding: 8px 0; font-style: italic; }

/* Full width card in grid */
.full-width { grid-column: 1 / -1; }

/* Scrollbar */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

@media (max-width: 900px) {
  .main { grid-template-columns: 1fr; height: auto; }
  .sidebar { border-right: none; border-bottom: 1px solid var(--border); }
  .content { grid-template-columns: 1fr; }
}
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <div class="logo">blu<span>.</span></div>
    <div class="mode-pill" style="color:${modeConf.color};border-color:${modeConf.color}40;background:${modeConf.bg}">
      ${modeConf.emoji} ${modeConf.label} mode
    </div>
  </div>
  <div class="header-time">↻ auto-refresh · ${now} IST</div>
</div>

<div class="main">

  <!-- SIDEBAR: Todos -->
  <div class="sidebar">

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Open</div>
        <div class="stat-value" style="color:var(--orange)">${analytics.todoStats.open}</div>
        <div class="stat-sub">todos</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Done</div>
        <div class="stat-value" style="color:var(--green)">${analytics.todoStats.completed_this_week}</div>
        <div class="stat-sub">this week</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">PRs</div>
        <div class="stat-value" style="color:var(--blue)">${openPRs.length}</div>
        <div class="stat-sub">open</div>
      </div>
    </div>

    <div class="mode-card">
      <div class="mode-emoji">${modeConf.emoji}</div>
      <div class="mode-label">Current mode</div>
      <div class="mode-name">${modeConf.label}</div>
      <div class="mode-desc">${getModeDescription(mode)}</div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">Open Todos</div>
        <div class="card-count">${allTodos.length}</div>
      </div>
      <div class="card-body">
        ${hexTodos.length ? `<div class="context-label" style="color:var(--blue)">Hexaware</div>${renderTodoSection(hexTodos, 'Hexaware', '#3b82f6')}` : ''}
        ${srqTodos.length ? `<div class="context-label" style="color:var(--green)">SmartResQ</div>${renderTodoSection(srqTodos, 'SmartResQ', '#10b981')}` : ''}
        ${personalTodos.length ? `<div class="context-label" style="color:var(--purple)">Personal</div>${renderTodoSection(personalTodos, 'Personal', '#8b5cf6')}` : ''}
        ${!allTodos.length ? `<div class="empty-state">All clear — no open todos</div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">What Blu Knows</div>
        <div class="card-count">${knowledge.length}</div>
      </div>
      <div class="card-body">${renderKnowledge()}</div>
    </div>

  </div>

  <!-- MAIN CONTENT -->
  <div class="content">

    <div class="card">
      <div class="card-header">
        <div class="card-title">Open PRs</div>
        <div class="card-count">${openPRs.length}</div>
      </div>
      <div class="card-body">${renderPRs()}</div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">Open Issues</div>
        <div class="card-count">${openIssues.length}</div>
      </div>
      <div class="card-body">${renderIssues()}</div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">Recent Commits</div>
      </div>
      <div class="card-body">${renderCommits()}</div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">Unreviewed Learnings</div>
        <div class="card-count">${learnings.length}</div>
      </div>
      <div class="card-body">${renderLearnings()}</div>
    </div>

    <div class="card full-width">
      <div class="card-header">
        <div class="card-title">Recent Notes</div>
        <div class="card-count">${analytics.totalNotes}</div>
      </div>
      <div class="card-body">${renderNotes()}</div>
    </div>

  </div>
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
