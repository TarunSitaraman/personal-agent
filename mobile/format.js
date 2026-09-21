// Time phrasing for the Now screen. Device-local time; the phone is where you are.
const pad = n => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function clock(d) {
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}

function dayDiff(a, b) {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86400000);
}

// "6:30 pm", "Tomorrow 9:00 am", "Wed 24 · 9:00 am"
export function when(iso, now = new Date()) {
  const d = new Date(iso);
  const diff = dayDiff(now, d);
  if (diff === 0) return clock(d);
  if (diff === 1) return `Tomorrow ${clock(d)}`;
  if (diff === -1) return `Yesterday ${clock(d)}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} · ${clock(d)}`;
}

// "in 40 min", "in 2 h", "now", "20 min ago" — only for the next few hours, else null.
export function relative(iso, now = new Date()) {
  const m = Math.round((new Date(iso) - now) / 60000);
  if (Math.abs(m) < 2) return 'now';
  if (m > 0 && m < 60) return `in ${m} min`;
  if (m >= 60 && m < 180) return `in ${Math.round(m / 60)} h`;
  if (m < 0 && m > -60) return `${-m} min ago`;
  return null;
}

export function ago(iso, now = new Date()) {
  const m = Math.round((now - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// Briefs and reminders are written for WhatsApp (*bold*, _italic_); show them as plain text.
export function plain(text = '') {
  return text.replace(/\*([^*\n]+)\*/g, '$1').replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2');
}
