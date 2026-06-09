const { ipcRenderer } = require('electron');

// ── Frames ────────────────────────────────────────────────────────────────────

let FRAMES_DIR = '';

const STATE_COUNTS = {
  idle: 6, running: 6, 'running-right': 8, 'running-left': 8,
  waving: 4, jumping: 5, failed: 8, waiting: 6, review: 6,
};

const FRAME_MS = 120;

function src(state, idx) {
  return `file:///${FRAMES_DIR.replace(/\\/g, '/')}/${state}/${String(idx).padStart(2,'0')}.png`;
}

// ── Animation ─────────────────────────────────────────────────────────────────

const img    = document.getElementById('pet');
const bubble = document.getElementById('bubble');
let state = 'idle', frame = 0, timer = null;

function startAnim(s) {
  state = s; frame = 0;
  clearInterval(timer);
  timer = setInterval(() => { frame = (frame + 1) % STATE_COUNTS[s]; img.src = src(s, frame); }, FRAME_MS);
  img.src = src(s, 0);
}

function playOnce(s, then = 'idle') {
  startAnim(s);
  setTimeout(() => startAnim(then), STATE_COUNTS[s] * FRAME_MS * 2);
}

// ── Speech bubble ─────────────────────────────────────────────────────────────

let bubbleTimer = null;
function showBubble(text, ms = 2800) {
  clearTimeout(bubbleTimer);
  bubble.textContent = text;
  bubble.classList.add('show');
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
}

// ── Drag ──────────────────────────────────────────────────────────────────────

let dragging = false, dragScreenStart = null, winStart = null;

img.addEventListener('mousedown', async (e) => {
  if (e.button !== 0) return;
  dragging = false;
  dragScreenStart = { x: e.screenX, y: e.screenY };
  winStart = await ipcRenderer.invoke('get-position');

  const onMove = (ev) => {
    const dx = ev.screenX - dragScreenStart.x;
    const dy = ev.screenY - dragScreenStart.y;
    if (!dragging && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) dragging = true;
    if (dragging) {
      const dir = dx > 0 ? 'running-right' : 'running-left';
      if (state !== dir) startAnim(dir);
      ipcRenderer.send('move-window', { x: winStart[0] + dx, y: winStart[1] + dy });
    }
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (dragging) startAnim('idle');
    else onTap();
    setTimeout(() => { dragging = false; }, 50);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// ── Tap reactions ─────────────────────────────────────────────────────────────

let chatOpen = false;
let tapIdx = 0;
const QUIPS = [
  { s: 'waving',  msg: "Hey Tarun! 👋" },
  { s: 'jumping', msg: "Let's crush it 🚀" },
  { s: 'review',  msg: "Code review mode 💻" },
  { s: 'waving',  msg: "I'm Hex 👾 — your desktop buddy" },
  { s: 'waiting', msg: "Focus time! 🎯" },
  { s: 'jumping', msg: "You've got this 💪" },
];

function onTap() {
  if (chatOpen) {
    ipcRenderer.send('toggle-chat');
    return;
  }
  const { s } = QUIPS[tapIdx % QUIPS.length];
  tapIdx++;
  playOnce(s);
}

// ── Quick-action buttons ──────────────────────────────────────────────────────

const chatBtn   = document.getElementById('btn-chat');
const todosBtn  = document.getElementById('btn-todos');
const eventsBtn = document.getElementById('btn-events');

chatBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  ipcRenderer.send('toggle-chat');
});

todosBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  todosBtn.classList.add('active');
  try {
    const todos = await ipcRenderer.invoke('api-todos');
    if (!todos.length) { showBubble('All clear! No open todos 🎉', 2500); }
    else {
      const lines = todos.slice(0, 5).map(t => `• ${t.content}`).join('\n');
      showBubble(lines, 4000);
    }
    playOnce('review');
  } finally {
    setTimeout(() => todosBtn.classList.remove('active'), 600);
  }
});

eventsBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  eventsBtn.classList.add('active');
  try {
    const events = await ipcRenderer.invoke('api-events');
    if (!events.length) { showBubble('Nothing upcoming 📅', 2500); }
    else {
      const lines = events.slice(0, 3).map(v => `• ${v.title}`).join('\n');
      showBubble(lines, 4000);
    }
  } finally {
    setTimeout(() => eventsBtn.classList.remove('active'), 600);
  }
});

// ── Right-click context menu ──────────────────────────────────────────────────

img.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  ipcRenderer.send('show-context-menu');
});

// ── IPC from main ─────────────────────────────────────────────────────────────

ipcRenderer.on('chat-open',   () => { chatOpen = true;  chatBtn.classList.add('active'); });
ipcRenderer.on('chat-closed', () => { chatOpen = false; chatBtn.classList.remove('active'); });

ipcRenderer.on('nudge', (_, msg) => {
  showBubble(msg, 5000);
  playOnce('waving');
});

// ── Init ──────────────────────────────────────────────────────────────────────

ipcRenderer.on('init', (_, { framesDir }) => {
  FRAMES_DIR = framesDir;
  startAnim('idle');
  setTimeout(() => playOnce('waving'), 500);
});
