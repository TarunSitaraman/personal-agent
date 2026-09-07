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

## Known issues / in flight (2026-09-07)
- `todos.tags` / `events.tags` have been added and backfilled from `context`. Both columns
  coexist — code still reads `context` in places. Finish the migration or keep both in sync.
- `src/whatsapp/webhook.js` still imports `transcribeAudio` / `analyzeImage` and defines an
  unused `isDuplicate`/`seenIds` pair — all dead since media handling moved to the queue
  processor. Left in place as pre-existing; safe to remove.
- Brief composition duplicates the stale-todo button block between `src/scheduler/briefs.js`
  and `api/cron/morning.js`. Smaller than the handler duplication was, but the same shape.
- The `refactor_*.js` / `rewrite_docs.js` scripts at repo root are spent one-off codegen from the
  semantic-tagging refactor (applied in `4f158be`). Untracked; delete when confirmed unneeded.
- Reminder delivery: `src/` arms exact timers, `api/` sweeps on a 15-min cron. Both now share the
  same message/send implementation (`src/scheduler/delivery.js`) — only the *trigger* differs.

## Key contacts / references
- SmartResQ-dev lives at: `C:\Users\Tarun\Documents\SmartResQ-dev`
- This project: `C:\Users\Tarun\Documents\personal-agent`
- Tarun's email: tarunsita13@gmail.com
