# Personal Agent — Full Implementation Plan

## Overview
Build a WhatsApp bot that acts as a personal AI agent for Tarun. It knows his three life contexts (Work intern, SmartResQ founder, GenAI learner), captures notes/todos/learnings on demand, and proactively briefs him at context transitions.

**This document is self-contained. Implement everything described here exactly.**

---

## Stack
- Runtime: Node.js 20+
- Framework: Express
- AI: Google Gemini 2.0 Flash (`@google/generative-ai`)
- Database: Neon (PostgreSQL via `pg`)
- Scheduling: node-cron
- WhatsApp: Meta Cloud API (HTTP calls via axios)
- Hosting target: Render (always-on, not serverless)

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
    "pg": "^8.12.0",
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
DATABASE_URL=
PORT=3000
TZ=Asia/Kolkata
```

---

## 3. Database Schema

Run this SQL in the Neon SQL editor to create all tables:

```sql
-- Todos
create table todos (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  context text check (context in ('work', 'smartresq', 'learning', 'personal')),
  done boolean default false,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- Notes
create table notes (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  context text check (context in ('work', 'smartresq', 'learning', 'personal')),
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
  role text not null check (role in ('user', 'contextl')),
  content text not null,
  created_at timestamptz default now()
);
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
  const context = req.query['hub.context'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (context === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
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
function getCurrentcontext() {
  // All times are IST (TZ=Asia/Kolkata set in env)
  const hour = new Date().getHours();

  if (hour >= 10 && hour < 18) return 'work';
  if (hour >= 18 && hour < 23) return 'smartresq';
  return 'personal';
}

function getcontextDescription(context) {
  const descriptions = {
    work: 'Tarun is in Work intern context (10am–6pm). Focus: intern work tasks and GenAI learning capture.',
    smartresq: 'Tarun is in SmartResQ context (6pm–11pm). Focus: startup work, intern PR reviews, product decisions.',
    personal: 'Tarun is in personal/rest context (late night or early morning).',
  };
  return descriptions[context];
}

module.exports = { getCurrentcontext, getcontextDescription };
```

---

### src/agent/memory.js

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- Todos ---

async function addTodo(content, context) {
  await pool.query('INSERT INTO todos (content, context) VALUES ($1, $2)', [content, context]);
}

async function getPendingTodos(context = null) {
  const query = context 
    ? 'SELECT * FROM todos WHERE done = false AND context = $1 ORDER BY created_at DESC LIMIT 10'
    : 'SELECT * FROM todos WHERE done = false ORDER BY created_at DESC LIMIT 10';
  const params = context ? [context] : [];
  const { rows } = await pool.query(query, params);
  return rows;
}

async function completeTodo(id) {
  await pool.query('UPDATE todos SET done = true, completed_at = NOW() WHERE id = $1', [id]);
}

// --- Notes ---

async function addNote(content, context, tags = []) {
  await pool.query('INSERT INTO notes (content, context, tags) VALUES ($1, $2, $3)', [content, context, tags]);
}

async function getRecentNotes(context = null, limit = 5) {
  const query = context
    ? 'SELECT * FROM notes WHERE context = $1 ORDER BY created_at DESC LIMIT $2'
    : 'SELECT * FROM notes ORDER BY created_at DESC LIMIT $1';
  const params = context ? [context, limit] : [limit];
  const { rows } = await pool.query(query, params);
  return rows;
}

// --- Learnings ---

async function addLearning(topic, content, source = null) {
  await pool.query('INSERT INTO learnings (topic, content, source) VALUES ($1, $2, $3)', [topic, content, source]);
}

async function getUnreviewedLearnings(limit = 5) {
  const { rows } = await pool.query('SELECT * FROM learnings WHERE reviewed = false ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows;
}

async function markLearningReviewed(id) {
  await pool.query('UPDATE learnings SET reviewed = true, last_reviewed_at = NOW() WHERE id = $1', [id]);
}

// --- Conversation history ---

async function saveMessage(role, content) {
  await pool.query('INSERT INTO conversations (role, content) VALUES ($1, $2)', [role, content]);
}

async function getRecentHistory(limit = 20) {
  const { rows } = await pool.query(
    'SELECT role, content FROM (SELECT * FROM conversations ORDER BY created_at DESC LIMIT $1) sub ORDER BY created_at ASC',
    [limit]
  );
  return rows;
}

// --- Summary stats (for briefs) ---

async function getSummaryStats() {
  const [hexTodos, srqTodos, unreviewed] = await Promise.all([
    getPendingTodos('work'),
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
const { getCurrentcontext, getcontextDescription } = require('./context');
const memory = require('./memory');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `You are Jarvis, Tarun's personal AI agent accessible via WhatsApp.

About Tarun:
- Intern at Work (10am–6pm weekdays)
- Founder/tech lead of SmartResQ — a healthcare emergency response startup (works evenings)
- Learning GenAI and agentic AI actively
- Wants low-friction capture and proactive intelligence

Your job:
1. Respond naturally and concisely (WhatsApp messages, not essays)
2. Detect intent from the message and take the right action
3. Always be context-aware — know which context Tarun is in

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
    "context": "work | smartresq | learning | personal"
  }
}

Keep replies short. Use line breaks. No markdown formatting (WhatsApp doesn't render it well). Use plain text only.`;

async function handleIncoming(userMessage) {
  const context = getCurrentcontext();
  const contextDesc = getcontextDescription(context);
  const history = await memory.getRecentHistory(20);
  const stats = await memory.getSummaryStats();

  const contextBlock = `
Current context: ${context}
${contextDesc}

Pending todos — Work: ${stats.hexTodos.length}, SmartResQ: ${stats.srqTodos.length}
Unreviewed learnings: ${stats.unreviewed.length}
`;

  const historyParts = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'contextl',
    parts: [{ text: h.content }],
  }));

  const contextl = genAI.getGenerativecontextl({
    contextl: 'gemini-2.0-flash-exp',
    systemInstruction: SYSTEM_PROMPT,
  });

  const chat = contextl.startChat({ history: historyParts });

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
    await memory.saveMessage('contextl', raw);
    return raw;
  }

  // Execute the action
  await executeAction(parsed.action, parsed.data, context);

  // Save to conversation history
  await memory.saveMessage('user', userMessage);
  await memory.saveMessage('contextl', parsed.reply);

  return parsed.reply;
}

async function executeAction(action, data, currentcontext) {
  const context = data?.context || currentcontext;

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
  const contextl = genAI.getGenerativecontextl({ contextl: 'gemini-2.0-flash-exp' });

  let prompt;
  if (type === 'morning') {
    prompt = `Generate a concise morning brief for Tarun in plain text (no markdown).
He is starting his Work intern day.
Pending Work todos: ${stats.hexTodos.map(t => t.content).join(', ') || 'none'}
Pending SmartResQ todos from last night: ${stats.srqTodos.map(t => t.content).join(', ') || 'none'}
Unreviewed learnings: ${stats.unreviewed.length}
Keep it under 5 lines. Be direct and practical.`;
  } else if (type === 'evening') {
    prompt = `Generate a concise evening context-switch message for Tarun in plain text (no markdown).
He is switching from Work to SmartResQ work.
Pending SmartResQ todos: ${stats.srqTodos.map(t => t.content).join(', ') || 'none'}
Unreviewed learnings captured today: ${stats.unreviewed.length}
Keep it under 5 lines. Be direct and motivating.`;
  }

  const result = await contextl.generateContent(prompt);
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

  // 10:00 AM IST — morning brief (Work context start)
  cron.schedule('0 10 * * 1-5', async () => {
    try {
      const brief = await generateBrief('morning');
      await sendMessage(myNumber, brief);
    } catch (err) {
      console.error('Morning brief error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 7:00 PM IST — evening switch (SmartResQ context)
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

## 5. .gitignore

```
node_modules/
.env
```

---

## 6. Implementation order

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

---

## 7. Testing locally before deploying

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

## 8. Meta WhatsApp setup steps (Tarun does this manually)

1. Go to developers.facebook.com → Create App → Business type
2. Add "WhatsApp" product
3. Under WhatsApp > API Setup:
   - Copy the **Phone Number ID** → `WHATSAPP_PHONE_ID`
   - Generate a permanent token → `WHATSAPP_TOKEN` (use System User token for permanence)
   - The test number is your bot's number — add your personal number as a recipient
4. Under WhatsApp > Configuration:
   - Set Webhook URL to your Render URL + `/webhook`
   - Set Verify Token to your chosen string
   - Subscribe to `messages` webhook field

---

## 9. Neon setup steps (Tarun does this manually)

1. Create project on neon.tech
2. Get the Connection String → `DATABASE_URL`
3. Run the schema from Section 3 in the SQL Editor

---

## 10. Render deployment steps (Tarun does this manually)

1. Push code to a GitHub repo
2. render.com → New Web Service → Deploy from GitHub repo
3. Add all environment variables from `.env.example` in Render dashboard
4. Deploy — Render gives you a public URL
5. Update Meta webhook URL to the Render URL

---

## What this system does when complete

- Tarun messages: "todo: follow up on BIZ-4 tonight" → saved to SmartResQ todos
- Tarun messages: "learned about tool calling in Gemini today" → saved to learnings
- Tarun messages: "what's pending for smartresq?" → bot lists open todos
- 10am every weekday → bot sends morning brief with Work todos + SmartResQ backlog
- 7pm every day → bot sends evening brief switching to SmartResQ context
