// Every cron endpoint under api/cron/ is invoked by cron-job.org's own external schedule at a
// single fixed clock time (e.g. once daily, set on cron-job.org's dashboard to land on 9am IST).
// forEachUser then fans that one invocation out to every active user regardless of their stored
// `users.tz` — so a Berlin user gets the "morning" brief at whatever hour 9am IST happens to be
// in Berlin, not their own actual morning.
//
// This gate makes each endpoint safe to trigger more often than once a day: it only proceeds for
// a user whose LOCAL time right now matches the target hour (and day-of-week constraint, if any).
// It does NOT by itself fix multi-timezone briefs — that also requires cron-job.org's own
// schedule to change from "once daily" to "hourly" for these endpoints, which is a dashboard
// change outside this codebase, not something this repo can do for you.
//
// See CLAUDE.md "Two things still single-user" and
// ~/.gstack/projects/TarunSitaraman-personal-agent/Tarun-master-design-20260912-122627.md's
// sibling scoping discussion for why this is additive infrastructure, not a full fix on its own.

// The gate is opt-in per request (?hourly=1). Without it every endpoint behaves exactly as it did
// before, because the current cron-job.org triggers fire once daily at times this repo can't see
// — and the docs disagree on what they are (CLAUDE.md says 10am/7pm, briefs.js says 9am/6pm).
// Hard-gating on a guessed hour would silently stop every brief if the guess were wrong.
//
// Unset tz falls back to Asia/Kolkata, not the runtime default: Vercel runs in UTC, so
// Intl with an undefined timeZone would evaluate the wrong local hour.
const DEFAULT_TZ = 'Asia/Kolkata';
const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

function isUserBriefTime(tz, targetHour, { weekdaysOnly = false, sundayOnly = false } = {}) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || DEFAULT_TZ,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date());

  const hour = Number(parts.find(p => p.type === 'hour').value);
  const weekday = parts.find(p => p.type === 'weekday').value; // 'Mon' .. 'Sun'

  if (hour !== targetHour) return false;
  if (weekdaysOnly && !WEEKDAYS.has(weekday)) return false;
  if (sundayOnly && weekday !== 'Sun') return false;
  return true;
}

// Returns a skip message when the request opted into gating and this user isn't at their local
// target time; null means "go ahead".
function localTimeSkip(query, user, targetHour, opts) {
  if (query?.hourly !== '1') return null;
  if (isUserBriefTime(user.tz, targetHour, opts)) return null;
  return `${user.wa_number}: skipped — not ${targetHour}:00 local (tz ${user.tz || DEFAULT_TZ})`;
}

module.exports = { isUserBriefTime, localTimeSkip };
