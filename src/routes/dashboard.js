const express = require('express');
const { getAnalytics, getAllKnowledge, getPendingTodos, getRecentNotes, getUnreviewedLearnings } = require('../agent/memory');
const { getOpenPRs, getOpenIssues, getRecentCommits } = require('../integrations/github');
const { getCurrentMode, getModeDescription } = require('../agent/context');

const router = express.Router();

const MODE_CONFIG = {
  hexaware: { label: 'Hexaware', color: '#4f8ef7', emoji: '💼' },
  smartresq: { label: 'SmartResQ', color: '#34d399', emoji: '🚑' },
  personal: { label: 'Personal', color: '#a78bfa', emoji: '🌙' },
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
      if (!todos.length) return `<p class="nil">nothing here</p>`;
      return todos.map((t, i) => `
        <div class="row">
          <span class="row-num">${i + 1}</span>
          <span class="row-tag" style="color:${color}">${label.toLowerCase()}</span>
          <span class="row-body">${escHtml(t.content)}</span>
        </div>`).join('');
    };

    const renderPRs = () => openPRs.length
      ? openPRs.map(pr => `<div class="row"><span class="pill">PR</span><span class="row-body">${escHtml(pr)}</span></div>`).join('')
      : `<p class="nil">no open PRs</p>`;

    const renderIssues = () => openIssues.slice(0, 6).length
      ? openIssues.slice(0, 6).map(i => `<div class="row"><span class="pill">#</span><span class="row-body">${escHtml(i)}</span></div>`).join('')
      : `<p class="nil">no open issues</p>`;

    const renderCommits = () => recentCommits.slice(0, 4).length
      ? recentCommits.slice(0, 4).map(c => `<div class="row"><span class="pill">↑</span><span class="row-body">${escHtml(c)}</span></div>`).join('')
      : `<p class="nil">no recent commits</p>`;

    const renderNotes = () => recentNotes.length
      ? recentNotes.map(n => `<div class="row"><span class="row-tag">${escHtml(n.context)}</span><span class="row-body">${escHtml(n.content.slice(0, 90))}${n.content.length > 90 ? '…' : ''}</span></div>`).join('')
      : `<p class="nil">no notes yet</p>`;

    const renderLearnings = () => learnings.length
      ? learnings.map(l => `<div class="learn-row"><div class="learn-topic">${escHtml(l.topic)}</div><div class="learn-body">${escHtml(l.content.slice(0, 70))}${l.content.length > 70 ? '…' : ''}</div></div>`).join('')
      : `<p class="nil">all caught up</p>`;

    const renderKnowledge = () => knowledge.length
      ? knowledge.map(k => `<div class="know-row">${escHtml(k)}</div>`).join('')
      : `<p class="nil">tell Blu about your world</p>`;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>blu</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:      #09090b;
  --s1:      #111115;
  --s2:      #18181d;
  --line:    #27272f;
  --t1:      #fafafa;
  --t2:      #71717a;
  --t3:      #3f3f46;
  --acc:     ${modeConf.color};

  /* Spotlight — updated via JS */
  --mx: 0;
  --my: 0;
  --mxp: 0;
  --myp: 0;
  --hue-base: ${mode === 'hexaware' ? 220 : mode === 'smartresq' ? 152 : 265};
  --spot-hue: calc(var(--hue-base) + var(--mxp) * 60);
}

body {
  background: var(--bg);
  color: var(--t1);
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  -webkit-font-smoothing: antialiased;
}

/* ── HEADER ───────────────────────────────── */
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32px;
  height: 52px;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  background: var(--bg);
  z-index: 10;
}
.logo {
  font-size: 26px;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: var(--t1);
}
.logo em { color: var(--acc); font-style: normal; }
.hdr-right { display: flex; align-items: center; gap: 16px; }
.mode-badge {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--acc);
  background: color-mix(in srgb, var(--acc) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--acc) 25%, transparent);
  padding: 4px 12px;
  border-radius: 4px;
}
.hdr-time { font-size: 13px; color: var(--t2); }

/* ── LAYOUT ───────────────────────────────── */
.page { display: grid; grid-template-columns: 300px 1fr; min-height: calc(100vh - 52px); }
.sidebar { border-right: 1px solid var(--line); padding: 28px 24px; display: flex; flex-direction: column; gap: 32px; }
.main { padding: 28px 32px; display: flex; flex-direction: column; gap: 28px; }

/* ── STATS ────────────────────────────────── */
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  background-color: var(--s1);
  background-image: radial-gradient(
    320px 320px at calc(var(--mx) * 1px) calc(var(--my) * 1px),
    hsl(var(--spot-hue) 80% 65% / 0.07),
    transparent 70%
  );
  background-attachment: fixed;
  position: relative;
}
.stats::before {
  content: '';
  position: absolute;
  inset: -1px;
  padding: 1px;
  border-radius: inherit;
  background: radial-gradient(
    260px 260px at calc(var(--mx) * 1px) calc(var(--my) * 1px),
    hsl(var(--spot-hue) 90% 65% / 0.45),
    transparent 75%
  );
  background-attachment: fixed;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  pointer-events: none;
}
.stat {
  padding: 20px 18px;
  border-right: 1px solid var(--line);
}
.stat:last-child { border-right: none; }
.stat-n {
  font-size: 60px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.04em;
  color: var(--t1);
}
.stat-l { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--t2); margin-top: 10px; }

/* ── MODE ─────────────────────────────────── */
.mode-block { }
.mode-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--t3); margin-bottom: 10px; }
.mode-name {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--acc);
  line-height: 1;
  margin-bottom: 10px;
}
.mode-desc { font-size: 14px; color: var(--t2); line-height: 1.6; }

/* ── SECTION ──────────────────────────────── */
.section { }
.sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.sec-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--t2); }
.sec-count { font-size: 13px; font-weight: 700; color: var(--t2); }

/* ── GRID ─────────────────────────────────── */
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }

/* ── PANEL ────────────────────────────────── */
.panel {
  background-color: var(--s1);
  background-image: radial-gradient(
    320px 320px at calc(var(--mx) * 1px) calc(var(--my) * 1px),
    hsl(var(--spot-hue) 80% 65% / 0.07),
    transparent 70%
  );
  background-attachment: fixed;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 18px 20px;
  position: relative;
}

/* Glowing border that follows cursor */
.panel::before {
  content: '';
  position: absolute;
  inset: -1px;
  padding: 1px;
  border-radius: inherit;
  background: radial-gradient(
    260px 260px at calc(var(--mx) * 1px) calc(var(--my) * 1px),
    hsl(var(--spot-hue) 90% 65% / 0.55),
    transparent 75%
  );
  background-attachment: fixed;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  pointer-events: none;
}

.panel .sec-head { border-color: var(--s2); }

/* ── ROWS ─────────────────────────────────── */
.row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.panel .row { border-color: var(--s2); }
.row:last-child { border-bottom: none; }
.row-num { font-size: 12px; font-weight: 700; color: var(--t3); min-width: 16px; flex-shrink: 0; }
.row-tag { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--t2); flex-shrink: 0; }
.row-body { color: var(--t1); flex: 1; line-height: 1.5; font-weight: 500; }
.pill {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--t2);
  background: var(--s2);
  border: 1px solid var(--line);
  padding: 3px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}
.panel .pill { background: var(--bg); }

/* ── LEARNINGS ────────────────────────────── */
.learn-row { padding: 10px 0; border-bottom: 1px solid var(--s2); }
.learn-row:last-child { border-bottom: none; }
.learn-topic { font-size: 14px; font-weight: 700; color: var(--t1); margin-bottom: 3px; }
.learn-body { font-size: 13px; color: var(--t2); line-height: 1.5; }

/* ── KNOWLEDGE ────────────────────────────── */
.know-row {
  font-size: 14px;
  font-weight: 500;
  color: var(--t1);
  padding: 10px 0;
  border-bottom: 1px solid var(--s2);
  line-height: 1.5;
}
.know-row:last-child { border-bottom: none; }
.know-row::before { content: '— '; color: var(--acc); font-weight: 700; }

/* ── MISC ─────────────────────────────────── */
.nil { font-size: 14px; color: var(--t3); padding: 8px 0; font-style: italic; }

::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }

@media (max-width: 900px) {
  .page { grid-template-columns: 1fr; }
  .sidebar { border-right: none; border-bottom: 1px solid var(--line); }
  .two-col, .three-col { grid-template-columns: 1fr; }
  .stats { grid-template-columns: repeat(3, 1fr); }
}
</style>
</head>
<body>

<header>
  <div class="logo">blu<em>.</em></div>
  <div class="hdr-right">
    <span class="mode-badge">${modeConf.label}</span>
    <span class="hdr-time">${now} IST</span>
  </div>
</header>

<div class="page">

  <!-- SIDEBAR -->
  <aside class="sidebar">

    <div class="stats">
      <div class="stat">
        <div class="stat-n">${analytics.todoStats.open}</div>
        <div class="stat-l">Open</div>
      </div>
      <div class="stat">
        <div class="stat-n">${openPRs.length}</div>
        <div class="stat-l">PRs</div>
      </div>
      <div class="stat">
        <div class="stat-n">${openIssues.length}</div>
        <div class="stat-l">Issues</div>
      </div>
    </div>

    <div class="mode-block">
      <div class="mode-label">Current mode</div>
      <div class="mode-name">${modeConf.label}</div>
      <div class="mode-desc">${getModeDescription(mode)}</div>
    </div>

    <div class="section">
      <div class="sec-head">
        <span class="sec-title">Open Todos</span>
        <span class="sec-count">${allTodos.length}</span>
      </div>
      ${hexTodos.length ? renderTodoSection(hexTodos, 'Hexaware', '#4f8ef7') : ''}
      ${srqTodos.length ? renderTodoSection(srqTodos, 'SmartResQ', '#34d399') : ''}
      ${personalTodos.length ? renderTodoSection(personalTodos, 'Personal', '#a78bfa') : ''}
      ${!allTodos.length ? '<p class="nil">nothing open — all clear</p>' : ''}
    </div>

    <div class="section">
      <div class="sec-head">
        <span class="sec-title">What Blu Knows</span>
        <span class="sec-count">${knowledge.length}</span>
      </div>
      ${renderKnowledge()}
    </div>

  </aside>

  <!-- MAIN -->
  <main class="main">

    <div class="two-col">
      <div class="panel">
        <div class="sec-head">
          <span class="sec-title">Open PRs</span>
          <span class="sec-count">${openPRs.length}</span>
        </div>
        ${renderPRs()}
      </div>
      <div class="panel">
        <div class="sec-head">
          <span class="sec-title">Open Issues</span>
          <span class="sec-count">${openIssues.length}</span>
        </div>
        ${renderIssues()}
      </div>
    </div>

    <div class="two-col">
      <div class="panel">
        <div class="sec-head">
          <span class="sec-title">Recent Commits</span>
        </div>
        ${renderCommits()}
      </div>
      <div class="panel">
        <div class="sec-head">
          <span class="sec-title">Unreviewed Learnings</span>
          <span class="sec-count">${learnings.length}</span>
        </div>
        ${renderLearnings()}
      </div>
    </div>

    <div class="panel">
      <div class="sec-head">
        <span class="sec-title">Recent Notes</span>
        <span class="sec-count">${analytics.totalNotes} total</span>
      </div>
      ${renderNotes()}
    </div>

  </main>

</div>

<script>
(function() {
  const r = document.documentElement.style;
  document.addEventListener('pointermove', function(e) {
    r.setProperty('--mx', e.clientX.toFixed(1));
    r.setProperty('--my', e.clientY.toFixed(1));
    r.setProperty('--mxp', (e.clientX / window.innerWidth).toFixed(3));
    r.setProperty('--myp', (e.clientY / window.innerHeight).toFixed(3));
  });
})();
</script>
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
  if (ctx === 'hexaware') return '#4f8ef7';
  if (ctx === 'smartresq') return '#34d399';
  return '#a78bfa';
}

module.exports = router;
