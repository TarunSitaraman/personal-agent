# Personal Agent — Project Context

## What this is
A WhatsApp-based personal AI agent ("Jarvis") for Tarun. Not a todo app — an always-on context-aware agent that knows which life mode Tarun is in and proactively surfaces what matters.

## Who Tarun is
- Intern at **Hexaware** (10am–6pm weekdays)
- Founder/tech lead of **SmartResQ** (healthcare emergency response startup, worked on evenings/nights)
- Learning **GenAI / Agentic AI** actively
- Uses Windows + WSL, VS Code, Claude Code
- Organised but forgets to enter/check todos — needs proactive nudges, not passive lists

## Three modes (time-based)
| Mode | Hours | Focus |
|------|-------|-------|
| `hexaware` | 10am–6pm | Intern work + learning capture |
| `smartresq` | 8pm–12pm | Startup work, PR reviews, product |
| `personal` | 12am–10am | Rest, general |

## Architecture
```
WhatsApp (Meta Cloud API)
    ↓
Node.js + Express server (Railway — always on)
    ↓
Gemini 2.0 Flash API (brain — free tier)
    ↓
Supabase (memory — todos, notes, learnings, conversation history)
    ↓
node-cron (proactive briefs at 10am + 7pm IST)
```

## Stack decisions
- **WhatsApp** over Telegram: Tarun already lives there daily
- **Gemini 2.0 Flash** over Claude API: Tarun has Claude Pro (not API), Gemini free tier is sufficient
- **Supabase** over local DB: persistent across deploys, free tier, easy client
- **Railway** over Vercel: needs always-on server for webhooks + cron (Vercel serverless won't work)

## Phase plan
- **Phase 1 (MVP)**: Webhook → Gemini → respond. Capture todos/notes/learnings. Mode awareness.
- **Phase 2**: Proactive cron briefs (10am, 7pm). Learning nudges. 
- **Phase 3**: GitHub integration (SmartResQ PR status in briefs). Web dashboard.

## Project structure
```
personal-agent/
├── src/
│   ├── server.js
│   ├── agent/
│   │   ├── brain.js       # Gemini calls + prompt
│   │   ├── memory.js      # Supabase CRUD
│   │   ├── context.js     # Mode detection
│   │   └── intents.js     # Parse intent from message
│   ├── scheduler/
│   │   └── briefs.js      # Cron jobs
│   └── whatsapp/
│       ├── webhook.js     # Incoming handler
│       └── send.js        # Outgoing sender
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
SUPABASE_URL=            # From Supabase project settings
SUPABASE_ANON_KEY=       # From Supabase project settings
PORT=3000
TZ=Asia/Kolkata
```

## Setup steps Tarun needs to do manually
1. **Meta Developer account** → Create WhatsApp Business App → get PHONE_NUMBER_ID + TOKEN
2. **Supabase** → New project → run schema from PLAN.md → get URL + ANON_KEY  
3. **Gemini API key** → aistudio.google.com → Create API key
4. **Railway** → New project from GitHub → set env vars → deploy

## Current status
- [ ] PLAN.md written (Gemini implementing)
- [ ] Meta WhatsApp setup
- [ ] Supabase schema applied  
- [ ] Gemini API key obtained
- [ ] Code implemented
- [ ] Railway deployed
- [ ] Webhook URL registered in Meta app
- [ ] End-to-end test: message bot → response

## Key contacts / references
- SmartResQ-dev lives at: `C:\Users\Tarun\Documents\SmartResQ-dev`
- This project: `C:\Users\Tarun\Documents\personal-agent`
- Tarun's email: tarunsita13@gmail.com
