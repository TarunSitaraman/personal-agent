// Reads a reminder time out of the words of a message: "today around 6pm", "tonight",
// "tomorrow morning", "friday at 10:30am", "in 20 minutes", "10 in the morning". Deterministic,
// so a todo that plainly carries a time gets a reminder even when the classifier returns add_todo
// without one — which is what happened to "order groceries today after college around 6pm"
// (2026-09-22). Returns a Date, or null when the text names no time, or names one that has
// already passed on a day that was said explicitly.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// Day parts without a clock time. Evening/tonight match the Tonight 9pm button's spirit.
const PARTS = { morning: 8, afternoon: 15, evening: 18, tonight: 21, night: 21 };
const DEFAULT_TOMORROW_HOUR = 8; // matches the "Tomorrow 8am" follow-up button

// Wall-clock parts of `date` in `tz`.
function partsIn(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'long',
  });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return {
    y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second,
    wd: WEEKDAYS.indexOf(p.weekday.toLowerCase()),
  };
}

// The instant at which it is y-m-d h:mi on the wall clock in `tz`.
function zoned(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = partsIn(new Date(guess), tz);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - guess;
  return new Date(guess - offset);
}

function clockTime(t) {
  if (/\bnoon\b/.test(t)) return { h: 12, mi: 0 };
  // "6pm", "4:30 pm", "11 am" — am/pm is required for a bare hour, so "6 chapters" is not a time.
  let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m) {
    let h = +m[1] % 12;
    if (m[3] === 'pm') h += 12;
    return { h, mi: m[2] ? +m[2] : 0 };
  }
  // Spoken: "10 in the morning", "6 in the evening", "8 at night" — what voice notes transcribe to.
  m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s+(?:in the (morning|afternoon|evening)|at night)\b/);
  if (m && +m[1] >= 1 && +m[1] <= 12) {
    const pm = m[3] ? m[3] !== 'morning' : true; // "at night" leaves m[3] empty
    return { h: (+m[1] % 12) + (pm ? 12 : 0), mi: m[2] ? +m[2] : 0 };
  }
  // "17:45", "at 9:30" — 24-hour with a colon.
  m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return { h: +m[1], mi: +m[2] };
  return null;
}

function reminderFromText(text, now = new Date(), tz = 'Asia/Kolkata') {
  if (typeof text !== 'string' || !text.trim()) return null;
  const t = text.toLowerCase();

  const rel = t.match(/\bin\s+(\d{1,3})\s*(min(?:ute)?s?|h(?:ou)?rs?|hours?)\b/);
  if (rel) {
    const n = +rel[1];
    const mins = /^h/.test(rel[2]) ? n * 60 : n;
    return new Date(now.getTime() + mins * 60000);
  }

  const today = partsIn(now, tz);
  let dayOffset = null; // null = not said
  if (/\btomorrow\b/.test(t)) dayOffset = 1;
  else if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(t)) dayOffset = 0;
  else {
    const wd = WEEKDAYS.findIndex(w => new RegExp(`\\b${w}\\b`).test(t));
    if (wd >= 0) dayOffset = ((wd - today.wd + 7) % 7) || 7; // the next one, never today
  }

  let time = clockTime(t);
  if (!time) {
    const part = Object.keys(PARTS).find(k => new RegExp(`\\b${k}\\b`).test(t));
    if (part) time = { h: PARTS[part], mi: 0 };
    else if (dayOffset !== null && dayOffset > 0) time = { h: DEFAULT_TOMORROW_HOUR, mi: 0 };
    else return null;
  }

  const explicitDay = dayOffset !== null;
  const base = new Date(Date.UTC(today.y, today.m - 1, today.d) + (dayOffset || 0) * 86400000);
  let when = zoned(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), time.h, time.mi, tz);

  if (when <= now) {
    if (explicitDay) return null; // "today at 9am" at 10:36 — a reminder in the past helps no one
    const next = new Date(base.getTime() + 86400000);
    when = zoned(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), time.h, time.mi, tz);
  }
  return when;
}

module.exports = { reminderFromText };
