# Blu — Personal AI Agent

Blu is a WhatsApp-native personal AI agent built for Tarun. It is not a todo app. It is a context-aware second brain that infers semantic context automatically, routes every message through a multi-tier LLM stack, stores memory in Postgres with vector search, and proactively surfaces what matters via scheduled briefs and nudges.

---

## Architecture

```
WhatsApp (Meta Cloud API)
        │
        ▼
Vercel Serverless Functions (api/)
        │
        ├── Intent Prefilter (regex — no LLM cost)
        │         │
        │         ▼ (ambiguous / complex)
        ├── LLM Brain (JSON-mode structured output)
        │     ├── Round 1: Groq — DeepSeek R1 70B / Llama 3.3 70B / Llama 3.1 8B (parallel race)
        │     ├── Round 2: OpenRouter — owl-alpha / Llama 3.3 70B free
        │     └── Round 3: Gemini 2.0 Flash / 1.5 Flash
        │
        ├── Action Executor
        │     ├── Postgres (Supabase) — todos, notes, learnings, events, knowledge, skills, conversations
        │     └── pgvector — semantic search with text-embedding-004 (Gemini)
        │
        ├── Integrations
        │     ├── GitHub API — open PRs, issues, recent commits (SmartResQ repo)
        │     └── Serper API — web search with LLM synthesis + knowledge caching
        │
        └── Scheduler (cron-job.org → Vercel HTTP endpoints, IST)
              ├── 9:00 AM Mon–Fri  — Morning brief + stale todo alert
              ├── 6:00 PM daily    — Evening brief + One Big Thing prompt
              ├── 9:00 PM daily    — Proactive nudge (goal check / automation suggestion)
              ├── 10:00 PM daily   — One Big Thing goal follow-up
              ├── Sun 10:00 AM     — Tech Twitter Pulse (web-search-driven)
              ├── Sun 8:00 PM      — Weekly review + conversation trim
              └── Every 15 min     — Reminder + event heads-up sweep
```

---

## Semantic Tagging

Items carry tags inferred from what a message actually means. Tags are stored as arrays on
`todos`, `notes`, and `events`, so one item can belong to several areas and new tags appear as
they become useful without a schema change.

**Tags are internal.** They exist so the agent can group and retrieve related things — they are
never shown to the user and never mentioned in replies. Blu says "Added to your todos", not
"Added to personal". The prompt instructs the model to reuse existing tags over inventing
near-duplicates, to keep them broad, and to use none at all when nothing fits.

There is also no hard-coded identity: the agent has no built-in notion of Tarun's employer,
schedule, or life areas. Everything it knows comes from stored knowledge, conversation history,
and current items — so it stays correct as his life changes.

> The original design used three hard-coded life modes selected by clock time
> (`src/agent/context.js`), which produced replies like "added to hexaware". That module is
> gone, along with the `switch_mode` action. `todos.context` and `events.context` remain in the
> schema for backwards compatibility and were backfilled into `tags`.

---

## LLM Routing

The brain (`src/agent/brain.js`) uses a three-round fallback chain to maximise availability and minimise latency:

1. **Groq (primary)** — Three models raced in parallel: DeepSeek R1 Distill 70B (chain-of-thought reasoning), Llama 3.3 70B, Llama 3.1 8B instant. Groq's R1 output is stripped of `<think>` blocks before parsing.
2. **OpenRouter (secondary)** — owl-alpha and Llama 3.3 70B free tier as fallback.
3. **Gemini (tertiary)** — gemini-2.0-flash then gemini-1.5-flash via Google AI SDK.

Failed models are cooled down for 5 minutes before retrying. All models return **JSON-mode structured output** with an `action`, `data`, and `reply` field so the executor never parses freeform text.

Streaming is also supported (`callLLMStream`) for the mobile app's real-time chat, with partial JSON extraction to stream the `reply` field token-by-token before the full response arrives.

---

## Intent System

### Prefilter (zero LLM cost)

Common unambiguous commands are handled by regex rules in `PREFILTER_RULES` before any LLM call:

- `todos / tasks / pending` → `list_todos`
- `notes / my notes` → `list_notes`
- `learnings` → `list_learnings`
- `events / calendar` → `list_events`
- `done: X / finished X` → `complete_todo`
- `note: X / save: X` → `add_note`
- `todo: X / remember to X` → `add_todo`

### LLM Actions (full intent set)

| Category | Actions |
|----------|---------|
| Capture | `add_todo`, `add_note`, `add_learning`, `learn_context`, `add_event`, `set_reminder`, `set_goal` |
| Retrieval | `list_todos`, `list_notes`, `list_learnings`, `list_events`, `search`, `search_web` |
| Completion | `complete_todo`, `complete_goal`, `delete_event`, `update_event`, `undo_last` |
| System | `generate_brief`, `create_skill`, `run_skill` |

Compound requests are handled via an `actions` array in the response — one message can trigger multiple stored actions simultaneously.

---

## Memory System

All memory lives in a Supabase (Postgres 17) database with the `pgvector` extension.

| Table | Purpose |
|-------|---------|
| `todos` | Tasks with tags, remind_at, done state |
| `notes` | Freeform notes with auto-tags and vector embeddings |
| `learnings` | Topic + content entries with reviewed flag |
| `knowledge` | Permanent facts about Tarun's world (people, tools, projects) |
| `events` | Calendar events with recurrence support |
| `conversations` | Rolling chat history (trimmed to 200 messages weekly) |
| `skills` | User-taught skills Blu can execute |
| `goals` | Daily "One Big Thing" goal tracking |
| `user_insights` | Behavioural patterns extracted every 20 messages |
| `reminders` | Time-based reminders |
| `state` | key-value store for push tokens and state, push tokens |

### Semantic Search

Notes, learnings, and knowledge entries are embedded with `text-embedding-004` (Gemini) at write time. Queries use cosine similarity via pgvector (`<=>` operator) with a relevance threshold of 0.6. Todos fall back to ILIKE since they lack embeddings.

Semantic results are injected into the LLM context block as "Relevant past memory" so Blu can surface connections across time.

---

## Proactive Features

### Scheduled Briefs

**Morning Brief (9am Mon–Fri)** — Standup format: yesterday's wins and notes → today's tasks → mental blockers. Sent via WhatsApp + push notification.

**Evening Brief (6pm)** — Summarises the day, surfaces open todos and PRs, and asks for the "One Big Thing" goal via interactive button.

**Weekly Review (Sun 8pm)** — Completed vs added todos, new learnings and notes, open items, honest progress assessment. Conversation history is trimmed after delivery.

**Tech Pulse (Sun 10am)** — Extracts Tarun's tech interests from knowledge store, runs a live web search via Serper, synthesises a curated digest of what he'd find interesting.

### Reactive Nudges

- **Stale todo alert** (9am Mon–Fri) — Flags todos untouched for 5+ days with snooze/dismiss buttons.
- **Proactive nudge** (9pm) — Priority: pending One Big Thing goal → automation suggestion based on behavioural insights → stale blockers.
- **Goal follow-up** (10pm) — Checks if a daily goal is still pending and pings for progress.
- **Reminder system** — Exact-time delivery via in-process timers (`src/scheduler/timers.js`), armed by a sweep every 15 min. Fires WhatsApp button messages (Done / Snooze 1hr).
- **Event reminders** — 15-minute heads-up before calendar events via button messages.

#### How reminder delivery works

Reminders are **not** found by frequent polling.

This was originally forced by Neon, which bills *compute-hours*: polling more often than its
autosuspend window kept the endpoint hot 24/7 (~730 compute-hours a month against a ~192-hour
free-tier budget), exhausted the quota mid-month, and made every query fail with "exceeded the
compute time quota". The database has since moved to Supabase, which is always-on and does not
bill that way — but the design is kept because it is simply better: reminders land on time
instead of up to a minute late, and the database is touched a few times an hour instead of
1,440 times a day.

Instead:

| Layer | Cadence | Role |
|-------|---------|------|
| Sweep (`scheduler/briefs.js`) | every 15 min, 6am–midnight IST | Looks ahead 20 min, arms timers, catches anything missed while the process was down |
| Timers (`scheduler/timers.js`) | exact `setTimeout` per item | Delivers on time without touching the DB until it fires |
| Queue processor | after each inbound message | Re-arms, so a reminder set for sooner than the next sweep still lands on time |

Every delivery goes through an **atomic claim** (`claimTodoReminder` / `claimEventReminder`),
which flips `reminded` only if it is still `false`. A timer and a catch-up sweep racing the
same row therefore send exactly once.

Serverless (`api/cron/reminder.js`) cannot hold timers, so it relies on the sweep alone and
should be called **every 15 minutes, not every minute**. If you drive it from an external
scheduler such as cron-job.org, set the interval there — the repo cannot enforce it.

---

## WhatsApp Interactive Messages

Beyond plain text, Blu uses WhatsApp's native interactive components:

- **Button messages** — Up to 3 quick-reply buttons (e.g. Done / Snooze, Set goal / Skip, Tonight 9pm / Tomorrow 8am)
- **List messages** — Sectioned scrollable list (e.g. todo list grouped by Work / SmartResQ / Personal, each row tappable to mark done)

Interactive button replies (nteractive_reply events) are handled in the webhook and routed back through the brain for actions like `complete_todo`, `set_reminder`, and goal setting.

After `add_todo`, Blu automatically follows up 800ms later with a reminder-offer button without requiring the user to ask.

---

## Integrations

### GitHub (`src/integrations/github.js`)
Fetches open PRs, open issues, and recent commits from the SmartResQ-dev repo using the GitHub REST API. Injected into every LLM context block so Blu can surface PR status in briefs and proactive nudges.

### Web Search (`src/integrations/search.js`)
Uses Serper API for Google search results. LLM synthesises results into a concise answer. Stable facts can be cached permanently to the knowledge store (`cache: true` in action data) so future queries skip the API call.

### Push Notifications (`src/push/push.js`)
Expo Push API integration for the companion mobile app (Expo/React Native). Sends notification types: `reminder`, `brief`, `nudge`. Tokens stored in the `state` table.

### Vision + Whisper (`src/integrations/`)
Stubs for image understanding (vision.js) and audio transcription (whisper.js) — not yet wired into the main flow.

---

## Dashboard

A lightweight web dashboard is served at `/dashboard` (`src/routes/dashboard.js`) with a static frontend at `public/`. It exposes analytics: todo stats, context breakdown, weekly activity charts, recent activity feed.

The `/api` router (`src/routes/api.js`) exposes endpoints for the companion mobile app — chat, memory retrieval, push token registration, analytics.

---

## Self-Learning

Every 20 messages, `analyzePatterns()` runs asynchronously: it feeds the last 40 conversation turns to the LLM and extracts 2–3 behavioural insights (e.g. "Tarun tends to defer SmartResQ tasks past 11pm"). These are stored in `user_insights` and injected back into the system prompt context, closing a feedback loop so Blu's nudges become more personalised over time.

A rolling context summary is also refreshed at the same interval: the last 40 messages are condensed into 3–5 sentences and stored with a 24-hour TTL, preventing prompt bloat while preserving continuity.

---

## Project Structure

```
personal-agent/
├── api/                          # Vercel serverless entry points
│   ├── webhook.js                # WhatsApp webhook (GET verify + POST messages)
│   ├── health.js                 # Health check
│   ├── chat.js                   # Mobile app chat endpoint
│   ├── todos.js                  # Todos REST API
│   └── cron/
│       ├── morning.js            # 9am brief + stale alert
│       ├── evening.js            # 6pm evening brief
│       ├── nudge.js              # 9pm proactive nudge
│       ├── goal.js               # 10pm goal follow-up
│       ├── weekly.js             # Sunday weekly review
│       ├── reminder.js           # Reminder + event sweep (call every 15 min)
│       └── pulse.js              # Sunday tech pulse
├── src/
│   ├── agent/
│   │   ├── brain.js              # LLM routing, intent handling, action execution (shared by all api/ functions)
│   │   ├── memory.js             # All Postgres queries
│   │   ├── queueProcessor.js     # Drains the inbound message queue
│   │   └── intents.js            # Action name constants
│   ├── scheduler/
│   │   ├── briefs.js             # All cron jobs + reminder sweep
│   │   └── timers.js             # Exact-time reminder delivery
│   ├── migrate_db.js             # Idempotent schema migrations — run after pulling
│   ├── whatsapp/
│   │   ├── webhook.js            # Incoming message handler
│   │   └── send.js               # Text, button, list message senders
│   ├── integrations/
│   │   ├── github.js             # PR / issue / commit fetching
│   │   ├── search.js             # Serper web search
│   │   ├── connections.js        # Cross-memory connection finding
│   │   ├── vision.js             # Image understanding (stub)
│   │   └── whisper.js            # Audio transcription (stub)
│   ├── push/
│   │   └── push.js               # Expo push notifications
│   ├── routes/
│   │   ├── dashboard.js          # Analytics dashboard
│   │   └── api.js                # Mobile app REST API
│   └── events/
│       └── hub.js                # Internal event bus
├── mobile/                       # Expo companion app assets
├── CLAUDE.md                     # Project context for Claude Code
├── PLAN.md                       # Original implementation plan
├── vercel.json                   # Vercel function config (maxDuration: 60s)
└── package.json
```

---

## Environment Variables

```env
WHATSAPP_TOKEN=          # Meta permanent access token
WHATSAPP_PHONE_ID=       # Phone number ID from Meta Developer Console
WHATSAPP_VERIFY_TOKEN=   # Any string (webhook verification handshake)
MY_WHATSAPP_NUMBER=      # Tarun's number in E.164 format (91XXXXXXXXXX)

GROQ_API_KEY=            # Primary LLM provider (groq.com)
OPENROUTER_API_KEY=      # Secondary LLM fallback (openrouter.ai)
GEMINI_API_KEY=          # Tertiary LLM + embeddings (aistudio.google.com)

DATABASE_URL=            # Supabase transaction-pooler URI, port 6543 (with pgvector)
SERPER_API_KEY=          # Google search API (serper.dev)
GITHUB_TOKEN=            # GitHub PAT for SmartResQ repo integration
GITHUB_REPO=             # e.g. tarunsitaraman/SmartResQ-dev

PORT=3000
TZ=Asia/Kolkata
APP_URL=                 # Public URL of the deployed server (for keep-alive ping)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Framework | Express 4 |
| LLMs | Groq (DeepSeek R1, Llama 3.3/3.1), OpenRouter, Gemini 2.0 Flash |
| Embeddings | Google text-embedding-004 (768-dim) |
| Database | Supabase (Postgres 17) + pgvector |
| Scheduler | node-cron |
| WhatsApp | Meta Cloud API (messages, interactive components) |
| Push | Expo Push Notification API |
| Search | Serper (Google Search API) |
| GitHub | REST API v3 |
| Deployment | Vercel (serverless, free, no card required) |
| Scheduling | cron-job.org (free external cron → Vercel HTTP endpoints) |

---

## Operations

### After pulling changes

```bash
node src/migrate_db.js     # idempotent — safe to re-run
```

Required after any change that adds columns. Recent additions: `events.reminded`,
`todos.tags`, `events.tags`.

### External cron intervals

`api/cron/reminder.js` should be called **every 15 minutes**. The interval lives in the
cron-job.org dashboard, not in this repo. On Supabase a faster interval no longer risks a
compute quota, but it still burns pooler connections and buys nothing — the sweep is a
catch-up mechanism, not the delivery path. See
[How reminder delivery works](#how-reminder-delivery-works).

The other `api/cron/*` endpoints are once-daily or weekly and need no tuning.

### Troubleshooting

**WhatsApp replies with "exceeded the compute time quota"**
Historical — this was Neon running out of monthly compute hours, caused by an external cron
polling every minute. The database now runs on Supabase, which is always-on and does not bill
compute-hours, so this specific error should not recur. If something similar appears, check
for anything polling faster than every 15 minutes.

**Database connection errors after a network change**
Supabase's pooler listens on port 6543. Some networks block outbound Postgres ports; if
connections time out from a machine that worked before, test the port before assuming the
database is down.

**No reply at all on WhatsApp**
Check the Vercel function logs. The webhook always returns 200 to Meta (otherwise Meta retries
and duplicates), so failures are visible only in logs. Raw error text is deliberately never
sent to WhatsApp.

**Reminders arrive late**
Expected on the serverless path — granularity equals the cron interval (15 min). The always-on
server (`node src/server.js`) delivers to the second via `scheduler/timers.js`.

**Two deployment paths exist**
`src/` (always-on Express + node-cron) and `api/` (Vercel serverless) implement the same agent
and share `src/agent/*`. Only `api/` is deployed today. Changes to webhook or reminder
behaviour must be made in both, or they will drift.
