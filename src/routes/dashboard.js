const express = require('express');
const axios = require('axios');
const { getAnalytics, getAllKnowledge, getPendingTodos, getRecentNotes, getUnreviewedLearnings, getWeekEvents, getRecentHistory } = require('../agent/memory');
const { getOpenPRs, getOpenIssues, getRecentCommits } = require('../integrations/github');
const { getCurrentMode, getModeDescription } = require('../agent/context');
const { handleIncoming } = require('../agent/brain');
const hub = require('../events/hub');

const router = express.Router();

// Chat — text message
router.post('/chat', express.json(), async (req, res) => {
  if (req.query.token !== process.env.DASHBOARD_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'No message' });
  try {
    const reply = await handleIncoming(message.trim());
    res.json({ reply });
  } catch (err) {
    console.error('Dashboard chat error:', err.message);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Chat — image upload (base64)
router.post('/chat/image', express.json({ limit: '10mb' }), async (req, res) => {
  if (req.query.token !== process.env.DASHBOARD_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  const { base64, mimeType = 'image/jpeg', caption = '' } = req.body;
  if (!base64) return res.status(400).json({ error: 'No image' });
  try {
    const visionRes = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-001',
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text', text: caption || 'Describe this image in detail.' },
        ]}],
      },
      { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } }
    );
    const description = visionRes.data.choices[0].message.content;
    const userText = `[Image from dashboard] ${description}${caption ? `\nCaption: ${caption}` : ''}`;
    const reply = await handleIncoming(userText);
    hub.notify();
    res.json({ reply, description });
  } catch (err) {
    console.error('Dashboard image error:', err.message);
    res.status(500).json({ error: 'Failed to process image' });
  }
});

// SSE endpoint — dashboard holds this open and reloads on 'refresh' event
router.get('/stream', (req, res) => {
  if (req.query.token !== process.env.DASHBOARD_TOKEN) return res.status(401).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  hub.addClient(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); hub.removeClient(res); });
});

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

    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const monthStart = new Date(nowIST.getFullYear(), nowIST.getMonth(), 1);
    const monthEnd   = new Date(nowIST.getFullYear(), nowIST.getMonth() + 1, 0, 23, 59, 59);

    const [analytics, openPRs, openIssues, recentCommits, knowledge, allTodos, recentNotes, learnings, dbEvents, chatHistory] = await Promise.all([
      getAnalytics(),
      getOpenPRs(),
      getOpenIssues(),
      getRecentCommits(),
      getAllKnowledge(),
      getPendingTodos(),
      getRecentNotes(null, 6),
      getUnreviewedLearnings(5),
      getWeekEvents(monthStart, monthEnd),
      getRecentHistory(30),
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

    // ── Monthly calendar ─────────────────────────────
    const monthYear   = nowIST.getFullYear();
    const monthNum    = nowIST.getMonth();
    const todayNum    = nowIST.getDate();
    const daysInMonth = new Date(monthYear, monthNum + 1, 0).getDate();
    const firstDow    = new Date(monthYear, monthNum, 1).getDay(); // 0=Sun
    const prevMonthDays = new Date(monthYear, monthNum, 0).getDate();
    const totalCells  = firstDow + daysInMonth;
    const trailingCnt = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);

    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const CTX_DOT     = { hexaware: '#4f8ef7', smartresq: '#34d399' };

    // Build event map: day (1-31) → sorted events[]
    const monthEventMap = {};
    for (let d = 1; d <= daysInMonth; d++) monthEventMap[d] = [];

    for (const ev of dbEvents) {
      const refStart = new Date(ev.start_at);
      if (ev.recurrence === 'none') {
        if (refStart.getFullYear() === monthYear && refStart.getMonth() === monthNum) {
          monthEventMap[refStart.getDate()].push({ title: ev.title, start_at: refStart.toISOString(), context: ev.context });
        }
      } else {
        for (let d = 1; d <= daysInMonth; d++) {
          const date = new Date(monthYear, monthNum, d);
          const dow = date.getDay();
          const isWeekday = dow >= 1 && dow <= 5;
          const refDow = refStart.getDay();
          if (ev.recurrence === 'daily' ||
              (ev.recurrence === 'weekdays' && isWeekday) ||
              (ev.recurrence === 'weekly' && dow === refDow)) {
            const s = new Date(date);
            s.setHours(refStart.getHours(), refStart.getMinutes(), 0, 0);
            monthEventMap[d].push({ title: ev.title, start_at: s.toISOString(), context: ev.context });
          }
        }
      }
    }
    for (const todo of allTodos) {
      if (!todo.remind_at) continue;
      const d = new Date(todo.remind_at);
      if (d.getFullYear() === monthYear && d.getMonth() === monthNum) {
        const day = d.getDate();
        if (monthEventMap[day]) monthEventMap[day].push({ title: todo.content, start_at: d.toISOString(), context: todo.context, isTodo: true });
      }
    }
    for (const d of Object.keys(monthEventMap)) {
      monthEventMap[d].sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    }

    const monthMapJson = JSON.stringify(monthEventMap);
    const totalMonthEvents = Object.values(monthEventMap).reduce((n, arr) => n + arr.length, 0);

    const renderDots = (events) => {
      if (!events.length) return '';
      return '<div class="mcal-dots">' +
        events.slice(0, 3).map(ev => `<div class="mcal-dot" style="background:${CTX_DOT[ev.context] || '#a78bfa'}"></div>`).join('') +
        '</div>';
    };

    const renderMonthlyCalendar = () => {
      const cells = [];
      for (let i = 0; i < firstDow; i++) {
        cells.push(`<div class="mcal-day other-month"><span class="mcal-num">${prevMonthDays - firstDow + i + 1}</span></div>`);
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const evs = monthEventMap[d] || [];
        cells.push(`<div class="mcal-day${d === todayNum ? ' today' : ''}" data-day="${d}">
          <span class="mcal-num">${d}</span>${renderDots(evs)}
        </div>`);
      }
      for (let i = 1; i <= trailingCnt; i++) {
        cells.push(`<div class="mcal-day other-month"><span class="mcal-num">${i}</span></div>`);
      }
      return `<div class="mcal-dow-row">
        <div class="mcal-dow">Su</div><div class="mcal-dow">Mo</div><div class="mcal-dow">Tu</div>
        <div class="mcal-dow">We</div><div class="mcal-dow">Th</div><div class="mcal-dow">Fr</div>
        <div class="mcal-dow">Sa</div>
      </div>
      <div class="mcal-grid">${cells.join('')}</div>`;
    };

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="300">
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

/* ── CHAT ─────────────────────────────────── */
.chat-panel { display: flex; flex-direction: column; height: 500px; }
.chat-msgs { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }
.chat-msgs::-webkit-scrollbar { width: 3px; }
.chat-msgs::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }
.chat-msg { max-width: 82%; display: flex; flex-direction: column; gap: 3px; }
.chat-msg.user { align-self: flex-end; align-items: flex-end; }
.chat-msg.blu  { align-self: flex-start; align-items: flex-start; }
.chat-bubble {
  padding: 9px 13px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.55;
  font-weight: 500;
  white-space: pre-wrap;
  word-break: break-word;
}
.chat-msg.user .chat-bubble { background: var(--acc); color: #000; border-bottom-right-radius: 3px; }
.chat-msg.blu  .chat-bubble { background: var(--s2); color: var(--t1); border: 1px solid var(--line); border-bottom-left-radius: 3px; }
.chat-img-preview { max-width: 200px; border-radius: 10px; margin-bottom: 4px; border: 1px solid var(--line); }
.chat-time { font-size: 10px; color: var(--t3); padding: 0 2px; }
.chat-typing { display: none; align-self: flex-start; }
.chat-typing.visible { display: flex; }
.chat-typing span { width: 6px; height: 6px; background: var(--t3); border-radius: 50%; animation: blink 1.2s infinite; }
.chat-typing span:nth-child(2) { animation-delay: 0.2s; }
.chat-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%,80%,100% { opacity: 0.2; } 40% { opacity: 1; } }

.chat-input-wrap { display: flex; align-items: flex-end; gap: 8px; padding-top: 12px; border-top: 1px solid var(--line); margin-top: 10px; }
.chat-textarea {
  flex: 1;
  background: var(--s2);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px 14px;
  color: var(--t1);
  font-size: 14px;
  font-family: inherit;
  resize: none;
  min-height: 42px;
  max-height: 120px;
  line-height: 1.5;
  outline: none;
  transition: border-color 0.15s;
  overflow-y: auto;
}
.chat-textarea:focus { border-color: var(--acc); }
.chat-textarea::placeholder { color: var(--t3); }
.chat-action-btn {
  width: 38px; height: 38px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--s2);
  color: var(--t2);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: all 0.12s;
}
.chat-action-btn:hover { background: var(--line); color: var(--t1); }
.chat-action-btn.send { background: var(--acc); color: #000; border-color: transparent; }
.chat-action-btn.send:hover { opacity: 0.85; }
.chat-action-btn.send:disabled { opacity: 0.4; cursor: default; }
.chat-action-btn.recording { background: #ef4444 !important; color: #fff !important; border-color: transparent; }
.chat-img-attach { display: none; }

/* ── MONTHLY CALENDAR ─────────────────────── */
.mcal-dow-row { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 4px; }
.mcal-dow { text-align: center; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--t3); padding: 4px 0 8px; }
.mcal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.mcal-day {
  height: 46px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.12s;
  user-select: none;
}
.mcal-day:hover:not(.other-month) { background: var(--s2); }
.mcal-day.other-month { opacity: 0.25; cursor: default; pointer-events: none; }
.mcal-num { font-size: 13px; font-weight: 600; color: var(--t1); line-height: 1; }
.mcal-day.other-month .mcal-num { color: var(--t3); }
.mcal-day.today .mcal-num {
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  background: var(--acc);
  color: #000;
  border-radius: 50%;
  font-weight: 800;
}
.mcal-dots { display: flex; gap: 3px; align-items: center; }
.mcal-dot { width: 4px; height: 4px; border-radius: 50%; flex-shrink: 0; }

/* ── DAY POPUP ────────────────────────────── */
.day-popup {
  position: fixed;
  display: none;
  z-index: 300;
  background: var(--s1);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px 16px;
  min-width: 230px;
  max-width: 280px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04);
  pointer-events: auto;
}
.day-popup.open { display: block; }
.popup-head { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--t2); margin-bottom: 10px; }
.popup-ev { display: flex; gap: 10px; align-items: flex-start; padding: 7px 0; border-bottom: 1px solid var(--line); }
.popup-ev:last-child { border-bottom: none; padding-bottom: 0; }
.popup-time { font-size: 11px; color: var(--t2); min-width: 50px; flex-shrink: 0; padding-top: 1px; }
.popup-body { font-size: 13px; font-weight: 600; color: var(--t1); line-height: 1.4; }
.popup-empty { font-size: 13px; color: var(--t3); font-style: italic; }

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
        <div class="stat-l">Todos</div>
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

    <div class="panel">
      <div class="sec-head">
        <span class="sec-title">Recent Notes</span>
        <span class="sec-count">${analytics.totalNotes} total</span>
      </div>
      ${renderNotes()}
    </div>

    <div class="panel">
      <div class="sec-head">
        <span class="sec-title">${MONTH_NAMES[monthNum]} ${monthYear}</span>
        <span class="sec-count">${totalMonthEvents} events</span>
      </div>
      ${renderMonthlyCalendar()}
    </div>

    <!-- CHAT -->
    <div class="panel chat-panel">
      <div class="sec-head">
        <span class="sec-title">Blu</span>
        <span class="sec-count" style="color:#34d399">● online</span>
      </div>
      <div class="chat-msgs" id="chat-msgs">
        ${chatHistory.map(m => {
          const isUser = m.role === 'user';
          const bubble = escHtml(m.content).replace(/\\n/g, '\n');
          return `<div class="chat-msg ${isUser ? 'user' : 'blu'}">
            <div class="chat-bubble">${bubble}</div>
          </div>`;
        }).join('')}
        <div class="chat-typing" id="chat-typing">
          <div class="chat-bubble" style="padding:10px 14px;background:var(--s2);border:1px solid var(--line);border-bottom-left-radius:3px;">
            <span></span><span style="margin:0 3px"></span><span></span>
          </div>
        </div>
      </div>
      <div class="chat-input-wrap">
        <input type="file" id="chat-img-input" class="chat-img-attach" accept="image/*">
        <button class="chat-action-btn" id="chat-img-btn" title="Attach image">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
        </button>
        <textarea class="chat-textarea" id="chat-input" placeholder="Message Blu…" rows="1"></textarea>
        <button class="chat-action-btn" id="chat-voice-btn" title="Voice input">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </button>
        <button class="chat-action-btn send" id="chat-send-btn" title="Send" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>

  </main>

  <div class="day-popup" id="day-popup"></div>

</div>

<script>
(function() {
  // Spotlight
  var r = document.documentElement.style;
  document.addEventListener('pointermove', function(e) {
    r.setProperty('--mx', e.clientX.toFixed(1));
    r.setProperty('--my', e.clientY.toFixed(1));
    r.setProperty('--mxp', (e.clientX / window.innerWidth).toFixed(3));
    r.setProperty('--myp', (e.clientY / window.innerHeight).toFixed(3));
  });

  // Monthly calendar popup
  var MAP = ${monthMapJson};
  var MSHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var CTX_COLOR = { hexaware: '#4f8ef7', smartresq: '#34d399' };
  var popup = document.getElementById('day-popup');
  var activeCell = null;

  function fmtTime(iso) {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function openPopup(cell, day) {
    if (activeCell === cell) { closePopup(); return; }
    activeCell = cell;
    var evs = MAP[day] || [];
    var dateLabel = MSHORT[${monthNum}] + ' ' + day + ', ' + ${monthYear};
    var html = '<div class="popup-head">' + dateLabel + '</div>';
    if (!evs.length) {
      html += '<div class="popup-empty">Nothing scheduled</div>';
    } else {
      evs.forEach(function(ev) {
        var color = CTX_COLOR[ev.context] || '#a78bfa';
        html += '<div class="popup-ev">' +
          '<div class="popup-time">' + fmtTime(ev.start_at) + '</div>' +
          '<div class="popup-body"><span style="color:' + color + '">● </span>' + ev.title + '</div>' +
          '</div>';
      });
    }
    popup.innerHTML = html;
    popup.classList.add('open');

    var rect = cell.getBoundingClientRect();
    var pw = 260, ph = popup.offsetHeight || 140;
    var left = rect.right + 10;
    var top = rect.top;
    if (left + pw > window.innerWidth - 12) left = rect.left - pw - 10;
    if (top + ph > window.innerHeight - 12) top = window.innerHeight - ph - 12;
    popup.style.left = Math.max(8, left) + 'px';
    popup.style.top  = Math.max(8, top)  + 'px';
  }

  function closePopup() {
    popup.classList.remove('open');
    activeCell = null;
  }

  document.querySelectorAll('.mcal-day[data-day]').forEach(function(cell) {
    cell.addEventListener('click', function(e) {
      e.stopPropagation();
      openPopup(cell, cell.dataset.day);
    });
  });

  document.addEventListener('click', closePopup);

  // ── CHAT ───────────────────────────────────────────────────────
  var chatPending = false;
  (function() {
    var token = new URLSearchParams(window.location.search).get('token');
    var msgsEl   = document.getElementById('chat-msgs');
    var inputEl  = document.getElementById('chat-input');
    var sendBtn  = document.getElementById('chat-send-btn');
    var voiceBtn = document.getElementById('chat-voice-btn');
    var imgBtn   = document.getElementById('chat-img-btn');
    var imgInput = document.getElementById('chat-img-input');
    var typing   = document.getElementById('chat-typing');

    // Scroll to bottom on load
    msgsEl.scrollTop = msgsEl.scrollHeight;

    // Auto-resize textarea
    inputEl.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      sendBtn.disabled = !this.value.trim();
    });

    inputEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) send(); }
    });

    function addMsg(role, text, imgSrc) {
      typing.classList.remove('visible');
      var div = document.createElement('div');
      div.className = 'chat-msg ' + (role === 'user' ? 'user' : 'blu');
      var html = '';
      if (imgSrc) html += '<img class="chat-img-preview" src="' + imgSrc + '">';
      html += '<div class="chat-bubble">' + text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</div>';
      div.innerHTML = html;
      msgsEl.insertBefore(div, typing);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function showTyping() { typing.classList.add('visible'); msgsEl.scrollTop = msgsEl.scrollHeight; }

    async function send() {
      var text = inputEl.value.trim();
      if (!text) return;
      addMsg('user', text);
      inputEl.value = ''; inputEl.style.height = ''; sendBtn.disabled = true;
      showTyping();
      chatPending = true;
      try {
        var res = await fetch('/dashboard/chat?token=' + token, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });
        var data = await res.json();
        addMsg('blu', data.reply || data.error || 'No response');
      } catch(e) { addMsg('blu', 'Connection error. Try again.'); }
      chatPending = false;
    }

    sendBtn.addEventListener('click', send);

    // Image attach
    imgBtn.addEventListener('click', function() { imgInput.click(); });
    imgInput.addEventListener('change', async function() {
      var file = this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = async function(e) {
        var dataUrl = e.target.result;
        var base64 = dataUrl.split(',')[1];
        var mimeType = file.type;
        var caption = inputEl.value.trim();
        var previewSrc = dataUrl;
        addMsg('user', caption || '📎 Image', previewSrc);
        inputEl.value = ''; inputEl.style.height = ''; sendBtn.disabled = true;
        showTyping();
        try {
          var res = await fetch('/dashboard/chat/image?token=' + token, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64, mimeType, caption }),
          });
          var data = await res.json();
          addMsg('blu', data.reply || data.error || 'No response');
          chatPending = false;
        } catch(e) { addMsg('blu', 'Image upload failed.'); chatPending = false; }
      };
      reader.readAsDataURL(file);
      imgInput.value = '';
    });

    // Voice — Web Speech API
    var recognition = null;
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.lang = 'en-IN';
      recognition.interimResults = false;
      recognition.onresult = function(e) {
        var transcript = e.results[0][0].transcript;
        inputEl.value = transcript;
        inputEl.dispatchEvent(new Event('input'));
        voiceBtn.classList.remove('recording');
      };
      recognition.onend = function() { voiceBtn.classList.remove('recording'); };
      recognition.onerror = function() { voiceBtn.classList.remove('recording'); };
    }

    var listening = false;
    voiceBtn.addEventListener('click', function() {
      if (!recognition) { alert('Voice not supported in this browser. Try Chrome.'); return; }
      if (listening) { recognition.stop(); listening = false; voiceBtn.classList.remove('recording'); }
      else { recognition.start(); listening = true; voiceBtn.classList.add('recording'); }
    });
  })();

  // Live refresh via SSE — reloads instantly when a WhatsApp message is processed
  (function() {
    var token = new URLSearchParams(window.location.search).get('token');
    var es = new EventSource('/dashboard/stream?token=' + token);
    es.addEventListener('refresh', function() { if (!chatPending) window.location.reload(); });
    es.onerror = function() {
      es.close();
      // SSE dropped (deploy/restart) — fall back to polling every 30s
      setTimeout(function() { window.location.reload(); }, 30000);
    };
  })();
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
