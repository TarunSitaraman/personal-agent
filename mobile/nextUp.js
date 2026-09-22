// What's next, decided in one place for both the Now screen and the home-screen widget, so the
// two can never disagree. Plain JS with no React Native imports: the widget runs it headless.
import { when } from './format';

// NEXT is the next event; with none, the top todo takes the headline (and leaves the list).
export function pickNext(events, todos, now = new Date()) {
  const e = events[0];
  if (e) return { kind: 'event', item: e, label: 'Next', title: e.title, at: e.start_at, sub: when(e.start_at, now) };
  const t = todos[0];
  if (t) {
    const sub = t.remind_at ? 'Reminder ' + when(t.remind_at, now) : 'Open todo';
    return { kind: 'todo', item: t, label: 'Next up', title: t.content, at: t.remind_at, sub };
  }
  return null;
}

// "in 50m", "15h 20m", "3 days", "now".
export function countdown(iso, now = new Date()) {
  const m = Math.round((new Date(iso) - now) / 60000);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.round(h / 24)} days`;
}
