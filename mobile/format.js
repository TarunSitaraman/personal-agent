// Time phrasing for the Now screen. Device-local time; the phone is where you are.
const pad = n => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function clock(d) {
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

function dayDiff(a, b) {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86400000);
}

// "6:30 PM", "Tomorrow, 9:00 AM", "Wed 24 Sep, 9:00 AM"
export function when(iso, now = new Date()) {
  const d = new Date(iso);
  const diff = dayDiff(now, d);
  if (diff === 0) return clock(d);
  if (diff === 1) return `Tomorrow, ${clock(d)}`;
  if (diff === -1) return `Yesterday, ${clock(d)}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${clock(d)}`;
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

// True when `a` mostly restates `b` — e.g. a learning's topic that repeats its content. Compares
// word stems (first five letters), so "improvement" and "improve" count as the same word.
const STOP = new Set(['the', 'and', 'of', 'in', 'to', 'a', 'an', 'for', 'on', 'terms', 'with', 'is']);
const stems = s => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w)).map(w => w.slice(0, 5)));
export function restates(a = '', b = '') {
  const A = stems(a), B = stems(b);
  if (A.size < 2) return false; // a one-word topic is a label, worth keeping
  let shared = 0;
  A.forEach(w => { if (B.has(w)) shared += 1; });
  return shared / A.size >= 0.6;
}

// "Tuesday, 23 September" — the date line above the large title.
export function longDate(d) {
  return `${LONG_DAYS[d.getDay()]}, ${d.getDate()} ${LONG_MONTHS[d.getMonth()]}`;
}

// Section title for a day in a list: "Today", "Tomorrow", "Wednesday, 24 September".
export function dayTitle(iso, now = new Date()) {
  const d = new Date(iso);
  const diff = dayDiff(now, d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return longDate(d);
}
