const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const https = require('https');

const FRAMES_DIR = 'C:\\Users\\Tarun\\Documents\\Codex\\2026-05-25\\hatch-pet-c-users-tarun-codex\\runs\\hex\\frames';
const API_BASE   = 'https://personal-agent-6g2h.onrender.com';
const API_TOKEN  = 'dash123';

const PET_W = 128;
const PET_H = 138;
const CHAT_W = 320;
const CHAT_H = 440;

let petWin = null;
let chatWin = null;
let tray = null;

// ── API helpers ───────────────────────────────────────────────────────────────

function apiGet(path) {
  return new Promise((resolve, reject) => {
    https.get(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${API_TOKEN}` } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(`${API_BASE}${path}`);
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Window helpers ────────────────────────────────────────────────────────────

function getPetBounds() {
  const [x, y] = petWin ? petWin.getPosition() : [0, 0];
  return { x, y, w: PET_W, h: PET_H };
}

function chatPosition() {
  const { x, y, w, h } = getPetBounds();
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  // Place chat to the left of the pet; if too close to left edge, place right
  const chatX = (x - CHAT_W - 8 < 0) ? x + w + 8 : x - CHAT_W - 8;
  const chatY = Math.max(0, y + h - CHAT_H);
  return { x: chatX, y: chatY };
}

function createPetWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  petWin = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: sw - PET_W - 24,
    y: sh - PET_H - 24,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
  });

  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.loadFile(path.join(__dirname, 'index.html'));
  petWin.webContents.on('did-finish-load', () => {
    petWin.webContents.send('init', { framesDir: FRAMES_DIR });
  });
  petWin.on('closed', () => { petWin = null; });
}

function createChatWindow() {
  const { x, y } = chatPosition();
  chatWin = new BrowserWindow({
    width: CHAT_W,
    height: CHAT_H,
    x, y,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
  });
  chatWin.loadFile(path.join(__dirname, 'chat.html'));
  chatWin.on('closed', () => { chatWin = null; });
  chatWin.on('blur', () => {
    // Hide when focus leaves, unless pet was just clicked
  });
}

function toggleChat() {
  if (!chatWin) createChatWindow();
  if (chatWin.isVisible()) {
    chatWin.hide();
    petWin?.webContents.send('chat-closed');
  } else {
    const { x, y } = chatPosition();
    chatWin.setPosition(x, y);
    chatWin.show();
    chatWin.focus();
    petWin?.webContents.send('chat-open');
  }
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Hex Pet');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / Hide Hex', click: () => petWin && (petWin.isVisible() ? petWin.hide() : petWin.show()) },
    { label: 'Open Chat',       click: toggleChat },
    { type: 'separator' },
    { label: 'Quit',            click: () => app.quit() },
  ]));
}

// ── Proactive nudge polling ───────────────────────────────────────────────────

let lastTodoCount = null;

async function pollAndNudge() {
  try {
    const data = await apiGet('/api/todos');
    const all = data.pending || [];
    const count = all.length;

    if (lastTodoCount !== null && count > lastTodoCount) {
      const newItem = all[all.length - 1];
      petWin?.webContents.send('nudge', `New todo: ${newItem.content}`);
    }
    lastTodoCount = count;
  } catch { /* server might be sleeping */ }
}

// ── IPC ───────────────────────────────────────────────────────────────────────

ipcMain.on('move-window', (_, { x, y }) => {
  petWin?.setPosition(Math.round(x), Math.round(y));
  // Reposition chat if it's open
  if (chatWin?.isVisible()) {
    const { x: cx, y: cy } = chatPosition();
    chatWin.setPosition(cx, cy);
  }
});

ipcMain.handle('get-position', () => petWin?.getPosition() ?? [0, 0]);

ipcMain.on('toggle-chat', () => toggleChat());

ipcMain.on('close-chat', () => { chatWin?.hide(); petWin?.webContents.send('chat-closed'); });

ipcMain.handle('api-chat', async (_, message) => {
  const r = await apiPost('/api/chat', { message });
  return r?.reply || r?.error || 'Done.';
});

ipcMain.handle('api-todos', async () => {
  const d = await apiGet('/api/todos');
  return d?.pending || [];
});

ipcMain.handle('api-events', async () => {
  const d = await apiGet('/api/events');
  return d?.events ?? [];
});

// Right-click context menu triggered from pet renderer
ipcMain.on('show-context-menu', (event) => {
  const menu = Menu.buildFromTemplate([
    { label: 'Chat with Hex',  click: toggleChat },
    { label: 'See my todos',   click: async () => {
        const todos = await apiGet('/api/todos');
        const all = todos?.pending || [];
        const msg = all.length ? all.slice(0,5).map(t => `• ${t.content}`).join('\n') : 'No open todos!';
        petWin?.webContents.send('nudge', msg);
      }
    },
    { label: 'Upcoming events', click: async () => {
        const data = await apiGet('/api/events');
        const evs = data?.events ?? [];
        const msg = evs.length ? evs.slice(0,3).map(e => `• ${e.title}`).join('\n') : 'No upcoming events.';
        petWin?.webContents.send('nudge', msg);
      }
    },
    { type: 'separator' },
    { label: 'Hide Hex', click: () => petWin?.hide() },
    { label: 'Quit',     click: () => app.quit() },
  ]);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createPetWindow();
  createTray();
  // Poll for new todos every 2 minutes
  setInterval(pollAndNudge, 2 * 60 * 1000);
});

app.on('window-all-closed', () => {});  // keep alive via tray
