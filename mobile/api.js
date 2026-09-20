// Every request goes to the /dashboard router with the token in an Authorization header — never
// in the URL, where access logs record it. The token comes from secure storage (./auth), not from
// the build. EXPO_PUBLIC_API_BASE is only the server address, which is not a secret.
import { getToken, clearToken } from './auth';

const BASE = process.env.EXPO_PUBLIC_API_BASE;

if (!BASE) {
  // Fail loudly at import rather than sending requests to "undefined/dashboard/..." that look
  // like a server problem. Set it in mobile/.env locally; eas.json sets it for cloud builds.
  throw new Error('Missing EXPO_PUBLIC_API_BASE. Set it in mobile/.env (see mobile/.env.example).');
}

// `token` is passed explicitly only when checking a candidate on the token screen; then a 401
// just means "wrong token" and must not sign anyone out.
async function request(path, { method = 'GET', body, token } = {}) {
  const t = token || await getToken();
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && !token) {
    await clearToken();
    throw new Error('Signed out — the token was rejected');
  }
  if (!r.ok) throw new Error(`${method} ${path} failed (${r.status})`);
  return r.json();
}

const withContext = (path, context) => (context ? `${path}?context=${encodeURIComponent(context)}` : path);

export async function verifyToken(token) {
  return request('/dashboard/api/auth/verify', { token });
}

export async function getStatus() {
  return request('/dashboard/api/status');
}

export async function getTodos(context = null) {
  const d = await request(withContext('/dashboard/api/todos', context));
  return Array.isArray(d) ? d : (d.pending || []);
}

export async function completeTodo(content) {
  return request('/dashboard/api/complete-todo', { method: 'POST', body: { content } });
}

export async function getEvents(context = null) {
  return request(withContext('/dashboard/api/events', context));
}

export async function getNotes(context = null) {
  return request(withContext('/dashboard/api/notes', context));
}

export async function getLearnings() {
  return request('/dashboard/api/learnings');
}

export async function chat(message) {
  return request('/dashboard/chat', { method: 'POST', body: { message } });
}

// The chat thread, newest first: conversation plus proactive messages (briefs, reminders…).
export async function getMessages(before = null) {
  const d = await request(before
    ? `/dashboard/api/messages?before=${encodeURIComponent(before)}`
    : '/dashboard/api/messages');
  return d.messages || [];
}

export async function registerPushToken(token) {
  return request('/dashboard/api/push/register', { method: 'POST', body: { token } });
}

export const CTX_COLOR = {
  default: '#4f8ef7',
  fallback: '#4f8ef7',
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
