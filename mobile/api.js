const BASE = 'https://personal-agent-6g2h.onrender.com';
const TOKEN = 'dash123';

// Dashboard endpoints (existing screens use these)
const api = (path) => `${BASE}${path}?token=${TOKEN}`;
// New /api/* endpoints use Bearer auth
const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

export async function getStatus() {
  const r = await fetch(api('/dashboard/api/status'));
  if (!r.ok) throw new Error('Failed to fetch status');
  return r.json();
}

export async function getTodos(context = null) {
  const url = context
    ? api('/dashboard/api/todos') + `&context=${context}`
    : api('/dashboard/api/todos');
  const r = await fetch(url);
  if (!r.ok) throw new Error('Failed to fetch todos');
  const d = await r.json();
  if (Array.isArray(d)) return d;
  return [...(d.hexaware || []), ...(d.smartresq || []), ...(d.personal || [])];
}

export async function completeTodo(content) {
  const r = await fetch(api('/dashboard/api/complete-todo'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!r.ok) throw new Error('Failed to complete todo');
  return r.json();
}

export async function getEvents(context = null) {
  const url = context
    ? api('/dashboard/api/events') + `&context=${context}`
    : api('/dashboard/api/events');
  const r = await fetch(url);
  if (!r.ok) throw new Error('Failed to fetch events');
  return r.json();
}

export async function getNotes(context = null) {
  const url = context
    ? api('/dashboard/api/notes') + `&context=${context}`
    : api('/dashboard/api/notes');
  const r = await fetch(url);
  if (!r.ok) throw new Error('Failed to fetch notes');
  return r.json();
}

export async function getLearnings() {
  const r = await fetch(api('/dashboard/api/learnings'));
  if (!r.ok) throw new Error('Failed to fetch learnings');
  return r.json();
}

// Chat via the new /api/chat endpoint
export async function chat(message) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ message }),
  });
  if (!r.ok) throw new Error('Failed to send message');
  return r.json();
}

// Register this device's Expo push token with the server
export async function registerPushToken(token) {
  const r = await fetch(`${BASE}/api/push/register`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ token }),
  });
  if (!r.ok) throw new Error('Failed to register push token');
  return r.json();
}

export const CTX_COLOR = {
  hexaware: '#4f8ef7',
  smartresq: '#34d399',
  personal: '#a78bfa',
};

export const MODE_COLOR = {
  hexaware: '#4f8ef7',
  smartresq: '#34d399',
  personal: '#a78bfa',
};

export function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3.6e6);
  const d = Math.floor(diff / 8.64e7);
  if (d > 6) return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (d >= 1) return d === 1 ? 'yesterday' : `${d}d ago`;
  if (h >= 1) return `${h}h ago`;
  return 'just now';
}
