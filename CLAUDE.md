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
MY_WHATSAPP_NUMBER=      # Tarun's personal number (E.164 format: 91XXXXXXXXXX)
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
- [x] Vercel deployed
- [x] Webhook URL registered in Meta app
- [x] End-to-end test: message bot → response

## Conventions
- **No AI attribution in commits.** No `Co-Authored-By`, no session trailers, no tool mentions
  in commit messages or PR descriptions. Conventional-commit format only.
- Run `npm test` before committing. Tests use the built-in `node --test` runner — deliberately
  no test framework dependency.

## Known issues / in flight (2026-09-09)

### memory.js — real defects, found by audit, not yet fixed
`src/agent/memory.js` is 909 lines and 77 exports with **zero SQL coverage** — no test executes a
single query in it. These were found by reading it and are ranked by consequence:

- **`src/agent/brain.js:779` — live arity bug.** `memory.addNote(pending.newContent,
  pending.context, [], embedding)` against `addNote(content, tags, embedding)`. A string lands in
  the `tags text[]` slot and `[]` becomes the embedding. The correct call is at `:1302`.
- **`getEventsStartingSoon` (`memory.js:394`)** — the outer `UPDATE` has no `reminded = false`
  re-check, unlike `claimTodoReminder`/`claimEventReminder`. Two concurrent sweeps can both claim
  a row and send the same reminder twice.
- **`searchMemory` (`:475`)** — (a) the JS filter is `r.score === null || r.score > 0.6` and the
  todo/note/learning queries do not filter `embedding IS NOT NULL`, so every NULL-embedding row is
  admitted unconditionally; (b) the knowledge query orders by the output alias `score` instead of
  `embedding <=> $1`, defeating the HNSW index.
- **`getStaleTodos` (`:429`)** — `INTERVAL '${days} days'` string-interpolated, not parameterised.
  The only such case in the file.
- **Queue claim (`:717`, `:728`)** — no `FOR UPDATE SKIP LOCKED`, no `WHERE status = 'pending'`
  guard, no `RETURNING`. Two workers can process one message, and rows stuck in `processing` are
  never retried (the retry filter is `status = 'failed'`).
- **`state` encoding mismatch** — `saveState` stores `JSON.stringify`, `saveContextSummary` stores
  a raw string, `getState` always `JSON.parse`s. `getState('context_summary')` throws.
- **`setTodoReminderByContent` (`:665`)** — no `RETURNING`, so "matched nothing" is
  indistinguishable from success. Same class as the `dfe0288` bug already fixed once.
- **`migrate_db.js:42`** declares `todos.embedding vector(1536)` while the schema and
  `EMBEDDING_DIMS` say 768. Inert on the existing DB (`IF NOT EXISTS`), fatal on a fresh one.
- Unescaped `%` / `_` in every ILIKE — `completeTodoByContent:103` has the widest blast radius.
- `isDuplicateRequest:693` depends on a constraint created only in `03_constraints.sql`. If that
  was ever skipped it returns `false` forever and every message is reprocessed.

### Smaller / structural
- `todos.context` / `events.context` coexist with `tags`; code still reads `context` in places.
- `src/whatsapp/webhook.js` still imports `transcribeAudio` / `analyzeImage` and defines an unused
  `isDuplicate`/`seenIds` pair — dead since media handling moved to the queue processor.
- Brief composition duplicates the stale-todo button block between `src/scheduler/briefs.js` and
  `api/cron/morning.js`. Same shape as the handler duplication already resolved.
- `migrate_db.js` is not a full schema — it creates only four tables; the rest exist only in
  `migration-export/01_schema.sql`. No single authoritative schema, which is exactly how the
  `tags` drift happened. Generalising `test/schema.tags.test.js` to any column would catch the next.
- **`ssl: { rejectUnauthorized: false }`** on the pool (`memory.js:13`) disables TLS verification
  against the database. Pre-existing; fix when not mid-incident.

### Ops
- Vercel `GITHUB_TOKEN` is a fine-grained PAT without access to the private SmartResQ-dev repo —
  production logs `403 Resource not accessible by personal access token`. Replace with a classic
  token carrying `repo` scope and briefs regain PR/commit context.

## Key references
- This project: `C:\Users\Tarun\Documents\personal-agent`
- Production: `https://personal-agent-blond-beta.vercel.app` (the `-git-master-` and
  build-specific URLs sit behind Vercel deployment protection and return 302)
