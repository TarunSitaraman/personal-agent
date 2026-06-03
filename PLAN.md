# Personal Agent — Full Implementation Plan

## Overview
Build a WhatsApp bot that acts as a personal AI agent for Tarun. It knows his three life contexts (Hexaware intern, SmartResQ founder, GenAI learner), captures notes/todos/learnings on demand, and proactively briefs him at mode transitions.

**This document is self-contained. Implement everything described here exactly.**

---

## Stack
- Runtime: Node.js 20+
- Framework: Express
- AI: Google Gemini 2.0 Flash (`@google/generative-ai`)
- Database: Supabase (`@supabase/supabase-js`)
- Scheduling: node-cron
- WhatsApp: Meta Cloud API (HTTP calls via axios)
- Hosting target: Railway (always-on, not serverless)

---

## 1. package.json

```json
{
  "name": "personal-agent",
  "version": "1.0.0",
  "description": "WhatsApp-based personal AI agent",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "@supabase/supabase-js": "^2.45.0",
    "axios": "^1.7.0",
    "dotenv": "^16.4.0",
    "express": "^4.19.0",
    "node-cron": "^3.0.3"
  }
}
```

---

## 2. .env.example

```
WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=
WHATSAPP_VERIFY_TOKEN=jarvis_verify_2024
MY_WHATSAPP_NUMBER=91XXXXXXXXXX
GEMINI_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
PORT=3000
TZ=Asia/Kolkata
```

---

## 3. Supabase Schema

Run this SQL in the Supabase SQL editor to create all tables:

```sql
-- Todos
create table todos (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  context text check (context in ('hexaware', 'smartresq', 'learning', 'personal')),
  done boolean default false,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- Notes
create table notes (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  context text check (context in ('hexaware', 'smartresq', 'learning', 'personal')),
  tags text[] default '{}',
  created_at timestamptz default now()
);

-- Learnings
create table learnings (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  content text not null,
  source text,
  reviewed boolean default false,
  last_reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- Conversation history (short-term memory, last 20 messages used)
create table conversations (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('user', 'model')),
  content text not null,
  created_at timestamptz default now()
);

-- Enable RLS but allow all for anon key (personal use, no multi-user)
alter table todos enable row level security;
alter table notes enable row level security;
alter table learnings enable row level security;
alter table conversations enable row level security;

create policy "allow all" on todos for all using (true) with check (true);
create policy "allow all" on notes for all using (true) with check (true);
create policy "allow all" on learnings for all using (true) with check (true);
create policy "allow all" on conversations for all using (true) with check (true);
```

---

## 4. Source Files

### src/server.js

```javascript
require('dotenv').config();
const express = require('express');
const { router: webhookRouter } = require('./whatsapp/webhook');
const { startScheduler } = require('./scheduler/briefs');

const app = express();
app.use(express.json());
app.use('/webhook', webhookRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Personal agent running on port ${PORT}`);
  startScheduler();
});
```

---

### src/whatsapp/send.js

```javascript
const axios = require('axios');

const BASE_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

async function sendMessage(to, text) {
  try {
    await axios.post(
      BASE_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    console.error('WhatsApp send error:', err.response?.data || err.message);
  }
}

module.exports = { sendMessage };
```

---

### src/whatsapp/webhook.js

```javascript
const express = require('express');
const { handleIncoming } = require('../agent/brain');
const { sendMessage } = require('./send');

const router = express.Router();

// Webhook verification (Meta handshake)
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Incoming messages
router.post('/', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) return;

    const from = message.from;
    const myNumber = process.env.MY_WHATSAPP_NUMBER;

    // Only respond to Tarun's number
    if (from !== myNumber) return;

    let text = '';
    if (message.type === 'text') {
      text = message.text.body;
    } else if (message.type === 'audio') {
      text = '[Voice message received — voice transcription not yet implemented]';
    } else {
      return;
    }

    const reply = await handleIncoming(text);
    await sendMessage(from, reply);
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

module.exports = { router };
```

---

### src/agent/context.js

```javascript
function getCurrentMode() {
  // All times are IST (TZ=Asia/Kolkata set in env)
  const hour = new Date().getHours();

  if (hour >= 10 && hour < 18) return 'hexaware';
  if (hour >= 18 && hour < 23) return 'smartresq';
  return 'personal';
}

function getModeDescription(mode) {
  const descriptions = {
    hexaware: 'Tarun is in Hexaware intern mode (10am–6pm). Focus: intern work tasks and GenAI learning capture.',
    smartresq: 'Tarun is in SmartResQ mode (6pm–11pm). Focus: startup work, intern PR reviews, product decisions.',
    personal: 'Tarun is in personal/rest mode (late night or early morning).',
  };
  return descriptions[mode];
}

module.exports = { getCurrentMode, getModeDescription };
```

---

### src/agent/memory.js

```javascript
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- Todos ---

async function addTodo(content, context) {
  const { error } = await supabase.from('todos').insert({ content, context });
  if (error) throw error;
}

async function getPendingTodos(context = null) {
  let query = supabase.from('todos').select('*').eq('done', false).order('created_at', { ascending: false });
  if (context) query = query.eq('context', context);
  const { data, error } = await query.limit(10);
  if (error) throw error;
  return data || [];
}

async function completeTodo(id) {
  const { error } = await supabase
    .from('todos')
    .update({ done: true, completed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// --- Notes ---

async function addNote(content, context, tags = []) {
  const { error } = await supabase.from('notes').insert({ content, context, tags });
  if (error) throw error;
}

async function getRecentNotes(context = null, limit = 5) {
  let query = supabase.from('notes').select('*').order('created_at', { ascending: false });
  if (context) query = query.eq('context', context);
  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return data || [];
}

// --- Learnings ---

async function addLearning(topic, content, source = null) {
  const { error } = await supabase.from('learnings').insert({ topic, content, source });
  if (error) throw error;
}

async function getUnreviewedLearnings(limit = 5) {
  const { data, error } = await supabase
    .from('learnings')
    .select('*')
    .eq('reviewed', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function markLearningReviewed(id) {
  const { error } = await supabase
    .from('learnings')
    .update({ reviewed: true, last_reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// --- Conversation history ---

async function saveMessage(role, content) {
  const { error } = await supabase.from('conversations').insert({ role, content });
  if (error) throw error;
}

async function getRecentHistory(limit = 20) {
  const { data, error } = await supabase
    .from('conversations')
    .select('role, content')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  // Return in chronological order for the prompt
  return (data || []).reverse();
}

// --- Summary stats (for briefs) ---

async function getSummaryStats() {
  const [hexTodos, srqTodos, unreviewed] = await Promise.all([
    getPendingTodos('hexaware'),
    getPendingTodos('smartresq'),
    getUnreviewedLearnings(),
  ]);
  return { hexTodos, srqTodos, unreviewed };
}

module.exports = {
  addTodo, getPendingTodos, completeTodo,
  addNote, getRecentNotes,
  addLearning, getUnreviewedLearnings, markLearningReviewed,
  saveMessage, getRecentHistory,
  getSummaryStats,
};
```

---

### src/agent/intents.js

Intent detection is done by Gemini inside the main prompt (not a separate classifier). The brain.js prompt instructs Gemini to return a structured JSON action alongside its reply. See brain.js for details.

```javascript
// Action types Gemini can return
const ACTIONS = {
  ADD_TODO: 'add_todo',
  ADD_NOTE: 'add_note',
  ADD_LEARNING: 'add_learning',
  LIST_TODOS: 'list_todos',
  LIST_NOTES: 'list_notes',
  LIST_LEARNINGS: 'list_learnings',
  NONE: 'none',
};

module.exports = { ACTIONS };
```

---

### src/agent/brain.js

```javascript
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getCurrentMode, getModeDescription } = require('./context');
const memory = require('./memory');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `You are Jarvis, Tarun's personal AI agent accessible via WhatsApp.

About Tarun:
- Intern at Hexaware (10am–6pm weekdays)
- Founder/tech lead of SmartResQ — a healthcare emergency response startup (works evenings)
- Learning GenAI and agentic AI actively
- Wants low-friction capture and proactive intelligence

Your job:
1. Respond naturally and concisely (WhatsApp messages, not essays)
2. Detect intent from the message and take the right action
3. Always be context-aware — know which mode Tarun is in

Intent detection rules:
- If Tarun says "remember to X", "todo: X", "add task X", "remind me to X" → ADD_TODO
- If Tarun says "note: X", "save this: X", "jot down X" → ADD_NOTE  
- If Tarun says "learned X", "learning: X", "concept: X", "understood X" → ADD_LEARNING
- If Tarun asks "what do I have", "my todos", "what's pending" → LIST_TODOS
- If Tarun asks "my notes", "what did I save" → LIST_NOTES
- If Tarun asks "my learnings", "what have I learned" → LIST_LEARNINGS
- Otherwise → NONE (just chat)

CRITICAL: Always respond with valid JSON in this exact format:
{
  "reply": "your natural WhatsApp message here",
  "action": "add_todo | add_note | add_learning | list_todos | list_notes | list_learnings | none",
  "data": {
    "content": "extracted content if action requires it",
    "topic": "topic if learning",
    "source": "source if mentioned",
    "context": "hexaware | smartresq | learning | personal"
  }
}

Keep replies short. Use line breaks. No markdown formatting (WhatsApp doesn't render it well). Use plain text only.`;

async function handleIncoming(userMessage) {
  const mode = getCurrentMode();
  const modeDesc = getModeDescription(mode);
  const history = await memory.getRecentHistory(20);
  const stats = await memory.getSummaryStats();

  const contextBlock = `
Current mode: ${mode}
${modeDesc}

Pending todos — Hexaware: ${stats.hexTodos.length}, SmartResQ: ${stats.srqTodos.length}
Unreviewed learnings: ${stats.unreviewed.length}
`;

  const historyParts = history.map(h => ({
    role: h.role,
    parts: [{ text: h.content }],
  }));

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
    systemInstruction: SYSTEM_PROMPT,
  });

  const chat = model.startChat({ history: historyParts });

  const fullMessage = `${contextBlock}\n\nUser message: ${userMessage}`;
  const result = await chat.sendMessage(fullMessage);
  const raw = result.response.text();

  // Parse Gemini's JSON response
  let parsed;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    // Fallback if JSON parsing fails
    await memory.saveMessage('user', userMessage);
    await memory.saveMessage('model', raw);
    return raw;
  }

  // Execute the action
  await executeAction(parsed.action, parsed.data, mode);

  // Save to conversation history
  await memory.saveMessage('user', userMessage);
  await memory.saveMessage('model', parsed.reply);

  return parsed.reply;
}

async function executeAction(action, data, currentMode) {
  const context = data?.context || currentMode;

  try {
    switch (action) {
      case 'add_todo':
        if (data?.content) await memory.addTodo(data.content, context);
        break;
      case 'add_note':
        if (data?.content) await memory.addNote(data.content, context);
        break;
      case 'add_learning':
        if (data?.topic && data?.content) {
          await memory.addLearning(data.topic, data.content, data.source);
        }
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('Action execution error:', action, err.message);
  }
}

// Used by scheduler for proactive briefs (no history context, just stats)
async function generateBrief(type) {
  const stats = await memory.getSummaryStats();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  let prompt;
  if (type === 'morning') {
    prompt = `Generate a concise morning brief for Tarun in plain text (no markdown).
He is starting his Hexaware intern day.
Pending Hexaware todos: ${stats.hexTodos.map(t => t.content).join(', ') || 'none'}
Pending SmartResQ todos from last night: ${stats.srqTodos.map(t => t.content).join(', ') || 'none'}
Unreviewed learnings: ${stats.unreviewed.length}
Keep it under 5 lines. Be direct and practical.`;
  } else if (type === 'evening') {
    prompt = `Generate a concise evening mode-switch message for Tarun in plain text (no markdown).
He is switching from Hexaware to SmartResQ work.
Pending SmartResQ todos: ${stats.srqTodos.map(t => t.content).join(', ') || 'none'}
Unreviewed learnings captured today: ${stats.unreviewed.length}
Keep it under 5 lines. Be direct and motivating.`;
  }

  const result = await model.generateContent(prompt);
  return result.response.text();
}

module.exports = { handleIncoming, generateBrief };
```

---

### src/scheduler/briefs.js

```javascript
const cron = require('node-cron');
const { generateBrief } = require('../agent/brain');
const { sendMessage } = require('../whatsapp/send');

function startScheduler() {
  const myNumber = process.env.MY_WHATSAPP_NUMBER;

  // 10:00 AM IST — morning brief (Hexaware mode start)
  cron.schedule('0 10 * * 1-5', async () => {
    try {
      const brief = await generateBrief('morning');
      await sendMessage(myNumber, brief);
    } catch (err) {
      console.error('Morning brief error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 7:00 PM IST — evening switch (SmartResQ mode)
  cron.schedule('0 19 * * *', async () => {
    try {
      const brief = await generateBrief('evening');
      await sendMessage(myNumber, brief);
    } catch (err) {
      console.error('Evening brief error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('Scheduler started — morning (10am) and evening (7pm) briefs active');
}

module.exports = { startScheduler };
```

---

## 5. railway.json (Railway deployment config)

Create this file at the root:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "node src/server.js",
    "healthcheckPath": "/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

---

## 6. .gitignore

```
node_modules/
.env
```

---

## 7. Implementation order

Implement in this exact order to be able to test at each step:

1. `package.json` + `.env.example` + `.gitignore`
2. `src/agent/context.js`
3. `src/agent/memory.js`
4. `src/whatsapp/send.js`
5. `src/agent/intents.js`
6. `src/agent/brain.js`
7. `src/whatsapp/webhook.js`
8. `src/scheduler/briefs.js`
9. `src/server.js`
10. `railway.json`

---

## 8. Testing locally before deploying

To test the webhook locally, use ngrok:

```bash
npm install  
# Copy .env.example to .env and fill in all values
cp .env.example .env

# Start the server
npm run dev

# In a separate terminal, expose it
npx ngrok http 3000
```

Copy the ngrok HTTPS URL (e.g. `https://abc123.ngrok.io`) and register it as the webhook URL in the Meta App Dashboard:
- Webhook URL: `https://abc123.ngrok.io/webhook`
- Verify token: whatever you set as `WHATSAPP_VERIFY_TOKEN`

Send a message to your WhatsApp test number and verify the bot responds.

---

## 9. Meta WhatsApp setup steps (Tarun does this manually)

1. Go to developers.facebook.com → Create App → Business type
2. Add "WhatsApp" product
3. Under WhatsApp > API Setup:
   - Copy the **Phone Number ID** → `WHATSAPP_PHONE_ID`
   - Generate a permanent token → `WHATSAPP_TOKEN` (use System User token for permanence)
   - The test number is your bot's number — add your personal number as a recipient
4. Under WhatsApp > Configuration:
   - Set Webhook URL to your Railway URL + `/webhook`
   - Set Verify Token to your chosen string
   - Subscribe to `messages` webhook field

---

## 10. Railway deployment steps (Tarun does this manually)

1. Push code to a GitHub repo
2. railway.app → New Project → Deploy from GitHub repo
3. Add all environment variables from `.env.example` in Railway dashboard
4. Deploy — Railway gives you a public URL
5. Update Meta webhook URL to the Railway URL

---

## Phase 2 additions (implement after MVP is working)

### Learning nudge cron (add to briefs.js)
Every Sunday at 6pm, check for learnings not reviewed in 7+ days and send a summary.

### GitHub integration (add to brain.js generateBrief)
Use the GitHub API to pull open PRs from `TarunSitaraman/SmartResQ-dev` and include them in the evening brief. Needs `GITHUB_TOKEN` env var added.

```javascript
// Pseudocode for GitHub PR fetch
const res = await fetch('https://api.github.com/repos/TarunSitaraman/SmartResQ-dev/pulls', {
  headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
});
const prs = await res.json();
const openPRs = prs.filter(pr => pr.state === 'open').length;
```

### Todo completion via WhatsApp
Gemini should also support "mark done: [item]" intent — search todos by content similarity and mark the closest match complete.

---

## What this system does when complete

- Tarun messages: "todo: follow up on BIZ-4 tonight" → saved to SmartResQ todos
- Tarun messages: "learned about tool calling in Gemini today" → saved to learnings
- Tarun messages: "what's pending for smartresq?" → bot lists open todos
- 10am every weekday → bot sends morning brief with Hexaware todos + SmartResQ backlog
- 7pm every day → bot sends evening brief switching to SmartResQ mode
