# Personal Agent — Project Context

## What this is
A WhatsApp-based personal AI agent ("Jarvis") for Tarun. Not a todo app — an always-on context-aware agent that dynamically tags information based on the semantic context of conversations and proactively surfaces what matters.

## Who Tarun is
- Founder/tech lead of **SmartResQ** (healthcare emergency response startup)
- Learning **GenAI / Agentic AI** actively
- Uses Windows + WSL, VS Code, Claude Code
- Organised but forgets to enter/check todos — needs proactive nudges, not passive lists

## Context Tagging (Semantic-based)
Information is grouped via dynamically inferred tags rather than hard-coded life modes.
The agent categorizes tasks and notes into tags automatically based on intent.

## Architecture
```
WhatsApp (Meta Cloud API)
    ↓
Vercel serverless functions (api/) — the deployed path
    ↓
LLM ladder: Groq → OpenRouter → Gemini → local Ollama
    ↓
Supabase (PostgreSQL memory — todos, notes, learnings, conversation history) + pgvector
    ↓
cron-job.org → api/cron/* (briefs, nudges, reminder sweep every 15 min)
```

An always-on Express variant (`src/server.js` + node-cron) implements the same agent and is
still maintained in-tree. It is not currently deployed, but it is the only path that delivers
reminders to the second (`src/scheduler/timers.js`).

## Stack decisions
- **WhatsApp** over Telegram: Tarun already lives there daily
- **Gemini 2.0 Flash** over Claude API: Tarun has Claude Pro (not API), Gemini free tier is sufficient
- **Supabase** over Neon (migrated 2026-08-19): Neon bills **compute-hours**, so a cron polling
  every minute kept the endpoint hot 24/7 and exhausted the monthly quota mid-month — every
  query then failed with "exceeded the compute time quota". Supabase free is always-on and
  billed on storage, so that failure class cannot recur. Postgres 17 + pgvector.
  Reminder delivery stays timer-driven regardless, because it is simply better.
- **Vercel** over Render: serverless works because the webhook is stateless and cron is driven
  externally by cron-job.org. The tradeoff is that serverless cannot hold timers, so reminder
  precision on this path equals the cron interval.

## Phase plan
- **Phase 1 (MVP)**: Webhook → Gemini → respond. Capture todos/notes/learnings. Tag inference.
- **Phase 2**: Proactive cron briefs (10am, 7pm). Learning nudges. 
- **Phase 3**: GitHub integration (SmartResQ PR status in briefs). Web dashboard.

## Project structure
```
personal-agent/
├── src/
│   ├── server.js
│   ├── agent/
│   │   ├── brain.js       # Gemini calls + prompt
│   │   ├── memory.js      # Postgres CRUD (Supabase)
│   │   ├── queueProcessor.js  # Drains inbound message queue
│   │   └── intents.js     # Parse intent from message
│   ├── migrate_db.js      # Idempotent migrations — run after pulling
│   ├── scheduler/
│   │   ├── briefs.js      # Cron jobs + reminder sweep
│   │   ├── delivery.js    # Reminder message format + send — shared by all 3 delivery paths
│   │   └── timers.js      # Exact-time reminder delivery
│   └── whatsapp/
│       ├── buttons.js     # Inbound button/list handling — shared by both webhook entry points
│       ├── webhook.js     # Incoming handler
│       └── send.js        # Outgoing sender
├── test/                  # node --test, no framework dependency (`npm test`)
├── PLAN.md                # Full implementation plan (for Gemini)
├── CLAUDE.md              # This file
├── .env.example
└── package.json
```

## Environment variables needed
```
WHATSAPP_TOKEN=          # Meta permanent access token
WHATSAPP_PHONE_ID=       # Phone number ID from Meta app
WHATSAPP_VERIFY_TOKEN=   # Any string you choose (webhook verification)
MY_WHATSAPP_NUMBER=      # Tarun's personal number (E.164 format: 91XXXXXXXXXX) — seeds the owner row
ALLOWED_NUMBERS=         # Comma-separated numbers allowed to self-register. Empty = closed.
GEMINI_API_KEY=          # From aistudio.google.com
DATABASE_URL=            # Supabase → Connect → Transaction pooler (port 6543)
PORT=3000
TZ=Asia/Kolkata
```

## Setup steps Tarun needs to do manually
1. **Meta Developer account** → Create WhatsApp Business App → get PHONE_NUMBER_ID + TOKEN
2. **Supabase** → New project → run migration-export/01_schema.sql → get pooler URI
3. **Gemini API key** → aistudio.google.com → Create API key
4. **Vercel** → Import GitHub repo → set env vars → deploy
5. **cron-job.org** → point jobs at `api/cron/*`. Set `reminder` to **every 15 minutes**;
   the sweep is a catch-up path, not the delivery path (see README → Operations).
6. After any schema change: `node src/migrate_db.js`

## Current status
- [x] PLAN.md written
- [x] Meta WhatsApp setup
- [x] Supabase schema applied (migrated off Neon 2026-08-19)
- [x] Gemini API key obtained
- [x] Code implemented
- [x] Vercel deployed (2026-09-10 — pushed eab7b6f + e4e0de4, restoring production writes)
- [x] Webhook URL registered in Meta app
- [x] End-to-end test: message bot → response
- [x] Multi-user: registration, per-user ownership (13 tables), fan-out crons
- [x] Recurring reminders: single source of truth in src/agent/recurrence.js
- [x] Memory.js audit: all defects fixed (99 → 130 tests)
- [x] Per-user dashboard auth: shared DASHBOARD_TOKEN replaced with per-user tokens
- [x] Item-state awareness: standup/nudge briefs stop re-announcing unchanged open PRs as news
  (2026-09-12 — migration step 14, `src/agent/itemTracking.js`, verified against real PRs)
- [ ] ALLOWED_NUMBERS set in Vercel env (empty = closed to owner only)
- [ ] GITHUB_TOKEN replaced with classic repo-scoped PAT — unclear if still 403 in Vercel;
  worked locally with no token errors on 2026-09-12, worth re-checking before assuming broken
- [x] cron-job.org reminder job confirmed at every 15 minutes (verified 2026-09-12 —
  two consecutive prod hits 15m28s apart, both 200 in ~2s)

## Conventions
- **No AI attribution in commits.** No `Co-Authored-By`, no session trailers, no tool mentions
  in commit messages or PR descriptions. Conventional-commit format only.
- Run `npm test` before committing. Tests use the built-in `node --test` runner — deliberately
  no test framework dependency.
- **Branch naming:** `feat/` or `fix/` prefix for feature/fix branches (not `claude/`). Once merged
  to master, delete the branch immediately. Keep only master in long-term storage. Short-lived
  feature branches only, merged and removed within the same session when possible.

## Known issues / in flight (2026-09-17)

### Resolved (2026-09-12 sprint)
Item-state awareness shipped: `generateStandup`/`generateProactiveNudge` no longer re-announce
the same open PR as "news" on every brief. New `items`/`item_events` tables (global, not
per-user — GitHub integration is single-repo via the `REPO` env var, not per-user) track each
PR's snapshot (state, draft, head commit, requested reviewers — volatile fields like raw
`updated_at` are deliberately excluded from the diff). Classification only runs when something
in that allow-list actually changed; an unchanged item keeps its last verdict and costs zero
LLM calls. `generateWeeklyReview`, the live chat path, and the dashboard all still call
`getOpenPRs()` raw and unfiltered — only the two proactive surfaces got the new behavior.
Design doc + review history: `~/.gstack/projects/TarunSitaraman-personal-agent/Tarun-master-design-20260912-122627.md`.
New files: `src/agent/itemTracking.js` (pure diff logic, unit-tested in
`test/itemTracking.test.js`). Migration: `migrate_db.js` step 14.

Note while implementing: `getOpenPRsDetailed()` fetched successfully against the real
`SmartResQ-dev` repo with no 403 — the `GITHUB_TOKEN` issue below may already be resolved, or
this repo doesn't require the token it's failing on in Vercel. Worth checking the Vercel env var
directly rather than assuming the Ops item below is still live.

All 12 memory.js defects from the 2026-09-09 audit were fixed in commit `91913ca`
(verified against production, 99 → 130 tests). See that commit for details.

### Still pending

**Phase 2 — Google Calendar.** Deprioritised by Tarun (2026-09-12): "google calendar will
never work." Don't propose it again unless he raises it.

**Needs you (config, not code):**
- **Per-user timezone briefs** — code shipped 2026-09-12 but is opt-in. Switch the six timed
  cron-job.org jobs to hourly AND append `&hourly=1`, together (README → Per-user timezone
  briefs). Until then every user still gets IST-anchored briefs. Irrelevant while the owner is
  the only user.
- **Review `eval/captured.json`** — 10 real messages captured, none reviewed. Two look wrong:
  `"retry"` → `undo_last`, and `"when should I do my deep work?"` → `search_web`.

### Resolved 2026-09-12 (second pass)
- `findConnections` pre-filters with pgvector (`memory.getSimilarContent`, top 8 by cosine)
  instead of sending the 30 most recent items; falls back to recency with no embedding.
- `update_todo` / `delete_note` intents: in both prompts, handled in `executeAction` with the
  delete_event disambiguation shape. `test/updateDelete.test.js`.
- Eval harness: `npm run eval` asserts `eval/cases.json` against the live classifier (12/12 on
  first run); `--capture N` replays real messages from `conversations`.
  `src/eval/`, `test/eval.scoring.test.js`. `src/compare_models.js` is still the model shoot-out.
- DASHBOARD_TOKEN was already per-user (shipped 2026-09-11, `users.dashboard_token`) — the
  "still single-user" note here was stale.
- Brief timing: `src/scheduler/briefTiming.js` gates all six timed endpoints on `users.tz`
  behind `?hourly=1`. Opt-in because cron-job.org's actual trigger times aren't visible from the
  repo and the docs disagreed (10am/7pm vs 9am/6pm) — a hard gate on a guessed hour would have
  silently stopped every brief. The Express `src/scheduler/briefs.js` still uses fixed IST; it
  isn't deployed.

### Resolved 2026-09-16 (duplicate todos on WhatsApp)
The pending list was showing most tasks twice — one row carrying `remind_at`, one without. Two
independent bugs, diagnosed against production data:

1. **Missing query parameter (crash).** `setTodoReminderByContent` referenced `$3` for `user_id`
   twice but passed only two values, so every tap on the *Tonight 9pm* / *Tomorrow 8am* follow-up
   button threw `bind message supplies 2 parameters, but prepared statement "" requires 3`.
   `handleButtonAction` caught it and returned `false`, which both webhook entry points treat as
   "not a button" — so the button *title* went to the LLM as message text and was saved as a todo
   literally named "Tonight 9pm". A crash inside a caught branch surfaced as a data bug three
   files away. The same mistake (a `user_id = $3` added to satisfy the scoping guard without
   adding the value) was also in `getNextPendingMessages` and `markMessageProcessing`, so the
   Express queue-drain path was throwing on every call too. All three fixed.
2. **`set_reminder` always inserted.** It never looked for an existing todo, so "add X" followed
   by "remind me about X" left two rows — whether those arrived as two messages or as one
   compound `actions` array. It now calls `setTodoReminderByContent` first and only inserts when
   nothing matches, which also makes the chat path and the button path agree on the match rule.

New guard: `test/schema.params.test.js` asserts every query passes at least as many params as its
highest `$N`, by reading the source — the same approach as `schema.scoping.test.js`, and for the
same reason (unit tests mock `setTodoReminderByContent`, so its SQL never executes in CI). That
guard is what found bugs in the queue path; it carries a vacuity check so it fails rather than
passes silently if the scanner stops matching. 169 -> 174 tests.

Production data cleaned up the same day: 5 duplicate rows deleted, and the 9pm reminder the ghost
row was carrying moved onto `study fla for exam`, which is the todo the original tap meant.

### Resolved 2026-09-17 (correction capture)
The classifier runs on a frozen prompt plus the last three messages (`brain.js:894-901`), so it
never sees anything the agent has learned, and nothing recorded a misroute when one happened.
`eval/captured.json` labelled each case with *what the classifier did*, which can only confirm
current behaviour, and only grew when `--capture` was run by hand.

Now: a capture action leaves a `last_capture` breadcrumb (`saveState`, 10-minute TTL — the TTL
*is* the correction window). Three retraction actions read it back inside `executeAction`
(`undo_last`, `delete_note`, `delete_event`), plus a declined `destructive_action` confirmation.
A hit is written to `classifier_corrections` and exported locally by `npm run eval:import` as a
negative case — `{rejected: [...], accept: null}` — which the eval asserts as "must not classify
as X" with no labelling effort. Detection lives inside `executeAction` because there are eight
call sites and `undo_last` runs down the classifier path, not Path A; hooking the Path A dispatch
would have recorded nothing while every detector test still passed.

Two exclusions are deliberate and pinned in `test/corrections.test.js`: `complete_todo` on a
just-added todo (finishing a task you added ten minutes ago is ordinary use, and it is the most
frequent plausible signal, so including it would swamp the dataset) and a declined note-merge
prompt (it shares the `pending_clarification:` key and the word "no" with the destructive-action
confirmation, but means "save it separately" — a storage preference, not a misroute).

This is instrumentation, not learning: no runtime prompt changes, no auto-promotion past the
`reviewed` gate, no LLM judge. Nothing alters classification; `npm run eval` still reports 22/22.
New files: `src/agent/corrections.js` (pure detector), `src/eval/import_corrections.js`.
Migration: step 11b, created before the OWNED loop because that loop ALTERs every owned table.
174 -> 199 tests.

**Open:** recall is unmeasured. If corrections are usually expressed by rephrasing rather than
undo/delete, this captures very little. Count rows in `classifier_corrections` after a few weeks
of real use — a low count is the argument for the LLM-judge tier (Approach B in the spec).
Design: `docs/superpowers/specs/2026-09-17-correction-capture-design.md`.
Plan: `docs/superpowers/plans/2026-09-17-correction-capture.md`.

**2026-09-19:** first real production capture — a stray voice note ("This video is sponsored by
Biscuiti...") filed as `add_note`, then undone. Labelled `accept: [["none"]]`, reviewed; eval 23/23.
It passes locally although production misrouted it: the ladder is non-deterministic and prod had
conversation history, so a green run guards regressions but does not prove the misroute fixed.
Fixed while reviewing it: the breadcrumb stored the *extracted* content ("remind me to call the
bank" became "call the bank"), so the eval replayed text that was never sent. `handleIncoming`
and `handleIncomingStream` now enter `withIncomingMessage` (context.js) and the breadcrumb reads
`currentIncomingMessage()` first. 199 -> 202 tests.

### Ops
- Vercel `GITHUB_TOKEN` is a fine-grained PAT without access to the private
  SmartResQ-dev repo — production logs `403 Resource not accessible by personal
  access token`. Replace with a classic token carrying `repo` scope and briefs
  regain PR/commit context.
- `ssl: { rejectUnauthorized: false }` on the pool (`memory.js:13`) disables TLS
  verification against the database. Pre-existing; fix when not mid-incident.

### Stale items from older plans (verify before acting)
- `todos.context` / `events.context` coexist with `tags`; code still reads
  `context` in places (likely resolved by the ownership refactor — verify)
- `src/whatsapp/webhook.js` dead imports (likely resolved — verify)
- Brief composition duplication (likely resolved by scheduler/delivery.js)
- ~~`migrate_db.js` is not a full schema — it creates only four tables~~ — stale as of
  2026-09-12: it now creates/alters `users`, `entity_links`, `prompt_versions`, `items`,
  `item_events`, and a dozen-plus columns across every other table (confirmed by reading it
  directly while adding step 14). Still true that `migration-export/01_schema.sql` is a
  separate file and the two aren't reconciled into one authoritative schema — that part of
  the concern stands.

## Key references
- This project: `C:\Users\Tarun\Documents\personal-agent`
- Production: `https://personal-agent-blond-beta.vercel.app` (the `-git-master-` and
  build-specific URLs sit behind Vercel deployment protection and return 302)
