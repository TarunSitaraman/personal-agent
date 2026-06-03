const express = require('express');
const { getAnalytics } = require('../agent/memory');
const { getOpenPRs, getOpenIssues } = require('../integrations/github');

const router = express.Router();

router.get('/', async (req, res) => {
  if (req.query.token !== process.env.DASHBOARD_TOKEN) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const [analytics, openPRs, openIssues] = await Promise.all([
      getAnalytics(),
      getOpenPRs(),
      getOpenIssues(),
    ]);

    const { todoStats, contextBreakdown, weeklyTodos, weeklyLearnings, recentActivity, totalNotes, totalLearnings } = analytics;

    const completionRate = todoStats.completed > 0
      ? Math.round((parseInt(todoStats.completed_this_week) / Math.max(parseInt(todoStats.added_this_week), 1)) * 100)
      : 0;

    const hexCtx = contextBreakdown.find(c => c.context === 'hexaware') || { open: 0, done: 0 };
    const srqCtx = contextBreakdown.find(c => c.context === 'smartresq') || { open: 0, done: 0 };

    const weekLabels = JSON.stringify(weeklyTodos.map(w => w.week));
    const weekAdded = JSON.stringify(weeklyTodos.map(w => parseInt(w.added)));
    const weekCompleted = JSON.stringify(weeklyTodos.map(w => parseInt(w.completed)));
    const learningWeekLabels = JSON.stringify(weeklyLearnings.map(w => w.week));
    const learningCounts = JSON.stringify(weeklyLearnings.map(w => parseInt(w.count)));

    const activityIcons = { todo: '✓', note: '📝', learning: '💡' };

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Blu — Personal Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0f1117; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; min-height: 100vh; }
  h1 { font-size: 1.5rem; font-weight: 700; color: #fff; margin-bottom: 4px; }
  .subtitle { color: #64748b; font-size: 0.875rem; margin-bottom: 32px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .card { background: #1e2130; border-radius: 12px; padding: 20px; border: 1px solid #2d3148; }
  .card-label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
  .card-value { font-size: 2rem; font-weight: 700; color: #fff; }
  .card-sub { font-size: 0.8rem; color: #64748b; margin-top: 4px; }
  .accent-green { color: #34d399; }
  .accent-blue { color: #60a5fa; }
  .accent-purple { color: #a78bfa; }
  .accent-orange { color: #fb923c; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px; }
  .chart-card { background: #1e2130; border-radius: 12px; padding: 20px; border: 1px solid #2d3148; }
  .chart-title { font-size: 0.875rem; font-weight: 600; color: #94a3b8; margin-bottom: 16px; }
  .section { margin-bottom: 32px; }
  .section-title { font-size: 1rem; font-weight: 600; color: #94a3b8; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .context-row { display: flex; gap: 16px; margin-bottom: 16px; }
  .context-card { flex: 1; background: #1e2130; border-radius: 12px; padding: 16px; border: 1px solid #2d3148; }
  .context-name { font-weight: 600; font-size: 0.875rem; margin-bottom: 8px; }
  .context-stats { display: flex; gap: 16px; }
  .context-stat { font-size: 0.8rem; color: #64748b; }
  .context-stat span { color: #e2e8f0; font-weight: 600; }
  .activity-list { background: #1e2130; border-radius: 12px; border: 1px solid #2d3148; overflow: hidden; }
  .activity-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #2d3148; }
  .activity-item:last-child { border-bottom: none; }
  .activity-icon { font-size: 1rem; margin-top: 1px; }
  .activity-content { flex: 1; min-width: 0; }
  .activity-text { font-size: 0.875rem; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .activity-meta { font-size: 0.75rem; color: #64748b; margin-top: 2px; }
  .github-row { display: flex; gap: 16px; }
  .github-card { flex: 1; background: #1e2130; border-radius: 12px; padding: 16px; border: 1px solid #2d3148; }
  .github-title { font-size: 0.8rem; color: #64748b; margin-bottom: 8px; }
  .github-item { font-size: 0.8rem; color: #94a3b8; padding: 4px 0; border-bottom: 1px solid #2d3148; }
  .github-item:last-child { border-bottom: none; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; margin-right: 6px; }
  .badge-green { background: #064e3b; color: #34d399; }
  .badge-blue { background: #1e3a5f; color: #60a5fa; }
  .updated { color: #475569; font-size: 0.75rem; text-align: right; margin-top: 24px; }
  @media (max-width: 768px) { .charts { grid-template-columns: 1fr; } .context-row { flex-direction: column; } .github-row { flex-direction: column; } }
</style>
</head>
<body>
<h1>Blu Dashboard</h1>
<p class="subtitle">Personal productivity overview — Tarun Sitaraman</p>

<div class="grid">
  <div class="card">
    <div class="card-label">Open Todos</div>
    <div class="card-value accent-orange">${todoStats.open}</div>
    <div class="card-sub">${todoStats.added_this_week} added this week</div>
  </div>
  <div class="card">
    <div class="card-label">Completion Rate</div>
    <div class="card-value accent-green">${completionRate}%</div>
    <div class="card-sub">${todoStats.completed_this_week} done this week</div>
  </div>
  <div class="card">
    <div class="card-label">Learnings</div>
    <div class="card-value accent-purple">${totalLearnings}</div>
    <div class="card-sub">${analytics.todoStats ? '' : ''}total captured</div>
  </div>
  <div class="card">
    <div class="card-label">Notes Saved</div>
    <div class="card-value accent-blue">${totalNotes}</div>
    <div class="card-sub">across all contexts</div>
  </div>
  <div class="card">
    <div class="card-label">Open PRs</div>
    <div class="card-value">${openPRs.length}</div>
    <div class="card-sub">SmartResQ</div>
  </div>
  <div class="card">
    <div class="card-label">Open Issues</div>
    <div class="card-value">${openIssues.length}</div>
    <div class="card-sub">SmartResQ</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Context Breakdown</div>
  <div class="context-row">
    <div class="context-card">
      <div class="context-name accent-blue">Hexaware</div>
      <div class="context-stats">
        <div class="context-stat">Open <span>${hexCtx.open}</span></div>
        <div class="context-stat">Done <span>${hexCtx.done}</span></div>
      </div>
    </div>
    <div class="context-card">
      <div class="context-name accent-green">SmartResQ</div>
      <div class="context-stats">
        <div class="context-stat">Open <span>${srqCtx.open}</span></div>
        <div class="context-stat">Done <span>${srqCtx.done}</span></div>
      </div>
    </div>
  </div>
</div>

<div class="charts">
  <div class="chart-card">
    <div class="chart-title">Todo Activity (8 weeks)</div>
    <canvas id="todoChart" height="200"></canvas>
  </div>
  <div class="chart-card">
    <div class="chart-title">Learning Velocity (8 weeks)</div>
    <canvas id="learningChart" height="200"></canvas>
  </div>
</div>

<div class="section">
  <div class="section-title">GitHub — SmartResQ</div>
  <div class="github-row">
    <div class="github-card">
      <div class="github-title">Open PRs (${openPRs.length})</div>
      ${openPRs.length ? openPRs.map(pr => `<div class="github-item"><span class="badge badge-green">PR</span>${pr}</div>`).join('') : '<div class="github-item">No open PRs</div>'}
    </div>
    <div class="github-card">
      <div class="github-title">Open Issues (${openIssues.length})</div>
      ${openIssues.slice(0, 8).length ? openIssues.slice(0, 8).map(i => `<div class="github-item"><span class="badge badge-blue">#</span>${i}</div>`).join('') : '<div class="github-item">No open issues</div>'}
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">Recent Activity</div>
  <div class="activity-list">
    ${recentActivity.map(a => `
    <div class="activity-item">
      <div class="activity-icon">${activityIcons[a.type] || '·'}</div>
      <div class="activity-content">
        <div class="activity-text">${a.content}</div>
        <div class="activity-meta">${a.type}${a.context ? ` · ${a.context}` : ''} · ${new Date(a.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</div>
      </div>
    </div>`).join('')}
  </div>
</div>

<div class="updated">Refreshed at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</div>

<script>
const chartDefaults = { responsive: true, plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } }, scales: { x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: '#2d3148' } }, y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: '#2d3148' }, beginAtZero: true } } };

new Chart(document.getElementById('todoChart'), {
  type: 'bar',
  data: {
    labels: ${weekLabels},
    datasets: [
      { label: 'Added', data: ${weekAdded}, backgroundColor: '#3b82f620', borderColor: '#3b82f6', borderWidth: 2, borderRadius: 4 },
      { label: 'Completed', data: ${weekCompleted}, backgroundColor: '#34d39920', borderColor: '#34d399', borderWidth: 2, borderRadius: 4 }
    ]
  },
  options: chartDefaults
});

new Chart(document.getElementById('learningChart'), {
  type: 'line',
  data: {
    labels: ${learningWeekLabels},
    datasets: [{ label: 'Learnings', data: ${learningCounts}, borderColor: '#a78bfa', backgroundColor: '#a78bfa20', borderWidth: 2, fill: true, tension: 0.4, pointBackgroundColor: '#a78bfa' }]
  },
  options: chartDefaults
});
</script>
</body>
</html>`);
  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.status(500).send('Error loading dashboard');
  }
});

module.exports = router;
