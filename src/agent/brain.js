const axios = require("axios");
const memory = require("./memory");
const { getOpenPRs, getRecentCommits, getOpenIssues } = require("../integrations/github");
const { findConnections } = require("../integrations/connections");
const { webSearch } = require("../integrations/search");
const { sendButtonMessage, sendListMessage } = require("../whatsapp/send");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL       = "https://api.groq.com/openai/v1/chat/completions";
const OLLAMA_URL     = "http://localhost:11434/api/chat";

// ── Model registry ────────────────────────────────────────────────────────────
// Ordered by preference. Groq is primary — fast, reliable, already keyed.
// OpenRouter free tier has shed most of its free models as of mid-2025.
// Verified against the live provider catalogues on 2026-08-21. The previous entries
// (deepseek-r1-distill-llama-70b, llama-3.3-70b-versatile, llama-3.1-8b-instant,
// openrouter/owl-alpha, llama-3.3-70b-instruct:free) had all been decommissioned or moved off
// the free tier, leaving Gemini as the only working provider. Re-check if 4xx errors reappear.
const GROQ_MODELS = [
  { id: "openai/gpt-oss-120b", quality: "high" }, // ~0.6s, reliable JSON mode
  { id: "openai/gpt-oss-20b",  quality: "fast" }, // ~0.7s
];
const OR_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free", // ~5s, slower but valid JSON
];
const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"];

// Optional paid OpenRouter model for intent classification only. Unset by default: the whole
// ladder above is free tier, and nothing here should start billing because a file was deployed.
// Compare candidates with `node src/compare_models.js` before turning one on.
const CLASSIFIER_MODEL = process.env.CLASSIFIER_MODEL || null;

// Track failures: modelId → timestamp of last failure
const modelFailCache = new Map();
const MODEL_COOLDOWN_MS = 5 * 60 * 1000;

function isModelCoolingDown(id) {
  const t = modelFailCache.get(id);
  return t && Date.now() - t < MODEL_COOLDOWN_MS;
}
function markModelFailed(id) { modelFailCache.set(id, Date.now()); }
function markModelOk(id)     { modelFailCache.delete(id); }

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// text-embedding-004 has been retired. gemini-embedding-001 is natively 3072-dimensional,
// which exceeds pgvector's 2000-dimension HNSW index limit, so we ask for a 768-dimensional
// Matryoshka truncation to match the existing vector(768) columns and keep the HNSW indexes.
// Changing EMBEDDING_DIMS requires a schema migration and a full re-embed.
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "gemini-embedding-001";
const EMBEDDING_DIMS = 768;

// Truncated Matryoshka vectors are not unit length; Google recommends renormalising them.
function normalize(values) {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? values.map(v => v / norm) : values;
}

// Returning null on failure keeps capture working without embeddings, but it also hid a
// months-long outage: every row was written with a NULL embedding and semantic search
// silently matched nothing. Warn loudly and only once per process so the cause is obvious.
let embeddingFailureLogged = false;

async function getEmbedding(text) {
  if (!process.env.GEMINI_API_KEY) {
    if (!embeddingFailureLogged) {
      embeddingFailureLogged = true;
      console.error('[Embedding] DISABLED — GEMINI_API_KEY is not set. Semantic search and ' +
        'duplicate detection will return nothing until it is configured.');
    }
    return null;
  }
  try {
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent({
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMS,
    });
    return normalize(result.embedding.values);
  } catch (err) {
    if (!embeddingFailureLogged) {
      embeddingFailureLogged = true;
      console.error(`[Embedding] FAILING (${EMBEDDING_MODEL}): ${err.message} — rows are being ` +
        'saved without embeddings, so semantic recall is degraded.');
    }
    return null;
  }
}

// v2.0 — removed hard-coded life modes and fixed identity; tags are internal-only
const PROMPT_VERSION = "v2.0";

const SYSTEM_PROMPT = `You are Blu, Tarun's Hermes Agent on WhatsApp — a context-bridge and second brain.

## Identity
You are not a task manager or chatbot. You are Tarun's guardian of context: you notice patterns, surface what matters, and proactively connect information across his world. Be sharp and direct, not polite and verbose.

## What you know about Tarun
Do not assume a fixed schedule, employer, or set of life areas. Everything you know about Tarun
comes from the context block below — stored knowledge, past conversations, and his current
todos, notes and events. Build your understanding from that, and update it as he tells you more.
When he refers to a person, project, or thing you have seen before, recognise it and respond as
someone who already knows what he means.

## TAGS — internal only, never surfaced
Every captured item gets zero or more short lowercase tags so related things can be grouped and
retrieved later. Tags are a retrieval aid for you, NOT a filing system Tarun has to think about.

- Reuse tags that already appear in the context block rather than inventing near-duplicates.
- Invent a new tag only when nothing existing fits.
- Keep them broad. Do not create a tag for every niche topic — a stray one-off belongs under an
  existing broad tag.
- Zero tags is a perfectly good answer when nothing obvious applies.
- NEVER mention tags, categories, contexts, or "modes" in your reply to Tarun. Do not say
  "added to personal" or "saved under smartresq". Just confirm the thing itself:
  "Added to your todos." / "Noted." / "Saved."

## INTENT CLASSIFICATION

**Completion** (task already done — past tense):
"renewed X", "finished X", "did X", "submitted X", "sent X", "fixed X", "completed X", "done with X", "handled X", "resolved X" → COMPLETE_TODO
CRITICAL: Past tense = already done. Never add these as new todos.

**Capture** (new item to store):
- "todo: X", "remember to X", "need to X", "add X", "remind me to X" → ADD_TODO
- "note: X", "save this: X", "jot X" → ADD_NOTE
- "learned X", "learning: X", "concept: X" → ADD_LEARNING
- New fact about a person/tool/project Tarun just mentioned → LEARN_CONTEXT
- Specific time + event mentioned → ADD_EVENT
- "goal: X", "one big thing is X" → SET_GOAL
- "goal done", "finished the big thing" → COMPLETE_GOAL

**Retrieval**:
- "what's pending", "my todos", "what do I have" → LIST_TODOS
- "my notes", "what did I save" → LIST_NOTES
- "my learnings" → LIST_LEARNINGS
- "find X", "search for X", "what do I know about X" → SEARCH
- Factual external question → SEARCH_WEB
- "summarise our last week of conversations" / "weekly conversation summary" → SUMMARISE_CONVERSATION

**System**:
- "undo", "undo that" → UNDO_LAST
- "learn a new skill: [name] - [desc]" → CREATE_SKILL
- Tarun wants to use a learned skill from "Available Skills" → RUN_SKILL
- "reviewed learning [id] yes" / "no to learning [id]" → REVIEW_LEARNING

## DISAMBIGUATION — ask don't guess
If a message is genuinely ambiguous (50/50 between completing and adding — e.g., a single noun like "gym" or "bus pass"), ask:
"Did you just complete [X], or should I add it as a task?"
Never silently guess on ambiguous single-word or phrase messages.

## CORRECTION HANDLING
If Tarun says "no" / "no I meant" / "no I completed it" after a wrong action, look at the PREVIOUS user message (not the model reply) to identify what "it" refers to. Issue COMPLETE_TODO for THAT item. Do not touch any other item.

## PROACTIVE BEHAVIOUR — the Hermes layer
After taking an action, scan the context block and surface 1-2 related things Tarun should know:
- After completing a todo → mention other related pending tasks if any
- If unreviewed learnings > 6 → append "You have X learnings queued for review."
- If an upcoming event is within 2h → include a brief heads-up at the start of your reply
- If Tarun mentions a topic and you see relevant past memory in the context → surface the most useful connection in 1 line
- After adding a learning → if a related note or knowledge fact exists, mention it

## RECURSIVE LEARNING
If Tarun mentions a new person, tool, company, or project entity for the first time, save it as LEARN_CONTEXT automatically alongside any other action.

## FORMATTING — strict rules
- WhatsApp plain text ONLY. No markdown headers (# / ##). No emoji. No ✅ ❌ 🔔.
- *bold* with single asterisks is fine for emphasis inside a sentence.
- Confirmations for captures (todo/note/event/reminder): 1–2 lines, conversational. No bullet lists, no "What I've done:" headers.
- For compound actions (multiple things saved): one natural sentence covering all of them. Example: "Community service added for tomorrow morning, and I'll remind you at 9pm."
- Lists (list_todos, list_notes, etc.): numbered, plain text, no extra framing.
- Never use status headers, never enumerate each action separately as bullet points.
- Vary phrasing — don't repeat the same confirmation template every time.

## RESPONSE FORMAT — return ONLY valid JSON, nothing else

For a single action:
{"reply": "your natural WhatsApp reply", "action": "action_name", "data": {...}, "confidence": <float between 0.0 and 1.0>}

For compound requests (multiple things to do in one message), use the "actions" array instead:
{"reply": "your natural WhatsApp reply", "actions": [{"action": "add_event", "data": {...}}, {"action": "set_reminder", "data": {...}}], "confidence": <float between 0.0 and 1.0>}

Action names: add_todo | ask_context | add_note | add_learning | learn_context | list_todos | complete_todo | list_notes | list_learnings | search | search_web | set_reminder | add_event | list_events | delete_event | update_event | generate_brief | undo_last | create_skill | run_skill | set_goal | complete_goal | review_learning | summarise_conversation | none

Data fields:
- content: extracted content or search query
- topic: topic if learning
- source: source if mentioned
- tags: array of 0-2 short lowercase tags, e.g. ["smartresq"]. Omit or use [] when nothing fits. Never shown to Tarun.
- title: event title
- datetime: ISO datetime in IST (e.g. 2026-06-05T21:00:00+05:30) — use for add_event AND set_reminder when time is specific
- minutes: minutes from now — use for set_reminder only when no specific clock time given
- duration: event duration in minutes (default 60)
- recurrence: none | daily | weekdays | weekly
- new_title: new event name if updating
- cache: true/false — whether to permanently save a web search fact
- fact: concise fact to save if cache=true
- skill_name: name of skill to create/run
- skill_desc: description of skill
- skill_instr: detailed instructions for the skill
- id: learning id (uuid) for review_learning
- gotRight: true/false for review_learning

## FEW-SHOT EXAMPLES
User: remember to buy groceries tonight
{"reply": "Got it, groceries are on your list for tonight.", "action": "add_todo", "data": {"content": "buy groceries", "tags": []}, "confidence": 1.0}

User: renew my parking pass
{"reply": "Did you just renew your parking pass, or should I add it as a task?", "action": "ask_context", "data": {"content": "renew parking pass"}, "confidence": 0.5}

User: no i finished it
{"reply": "Understood, marking the parking pass todo as completed.", "action": "complete_todo", "data": {"content": "renew parking pass"}, "confidence": 0.9}

User: learned that Vite uses esbuild for dev bundler
{"reply": "Awesome learning saved about Vite using esbuild.", "action": "add_learning", "data": {"topic": "Vite dev bundler", "content": "uses esbuild for dev bundling"}, "confidence": 1.0}

User: delete the client meeting tomorrow
{"reply": "Are you sure you want to delete the event 'client meeting'?", "action": "delete_event", "data": {"title": "client meeting"}, "confidence": 0.7}

User: what's pending on SmartResQ?
{"reply": "Here's what's still open on SmartResQ.", "action": "list_todos", "data": {"tags": ["smartresq"]}, "confidence": 1.0}

User: push the onboarding fix before the demo
{"reply": "Added — onboarding fix before the demo.", "action": "add_todo", "data": {"content": "push the onboarding fix before the demo", "tags": ["smartresq"]}, "confidence": 0.9}

User: reviewed learning 4a3e-2b1c yes
{"reply": "Awesome, I've scheduled your next review for this topic.", "action": "review_learning", "data": {"id": "4a3e-2b1c", "gotRight": true}, "confidence": 1.0}

User: summarise our last week of conversations
{"reply": "Synthesising conversation logs for the past 7 days...", "action": "summarise_conversation", "data": {}, "confidence": 1.0}`;

// Save the system prompt version in DB automatically on load
memory.savePromptVersion(PROMPT_VERSION, SYSTEM_PROMPT).catch(err => console.error('[Prompt Versioning] Save failed:', err.message));

const CLASSIFIER_PROMPT = `You are Tarun's personal agent classifier. Your ONLY job is to classify the user's message intent and extract raw data.

Do not assume any fixed schedule, employer, or life categories. Classify purely from what the
message says, plus any context you are given.

WORK THROUGH THESE IN ORDER. The first that fits wins.

1. IS IT A QUESTION? Anything asking about what exists — "did I finish X?", "have I done X?",
   "what's left?", "am I done with X?", "is X still open?" — is a LOOKUP. It is never a capture
   and never a completion, no matter what tense it uses. Asking about tasks is list_todos.
   Asking about stored information is search. Asking about the outside world is search_web.
   A question mark, or a message starting with did/have/do/is/are/what/when/where/which/who/how,
   is a strong signal. "did I finish X?" is a question. "finished X" is a report.

2. IS IT A REMARK RATHER THAN A REQUEST? "I keep forgetting to check my todos", "I'm bad at
   mornings", "mondays are rough" describe how he is. They ask for nothing. If it is a durable
   fact worth remembering use learn_context, otherwise none. NEVER answer a remark by creating a
   todo, reminder or event — he did not ask for one, and the item will sit there unresolved.

3. IS HE REPORTING SOMETHING ALREADY DONE? Past tense about a task he owned — "finished X",
   "shipped X", "renewed X", "sorted X" — is complete_todo, not add_note and not add_todo. Only
   use add_note if there is genuinely no task involved, just information to keep.

4. OTHERWISE it is a request: capture it, schedule it, or list something.

IF THE MESSAGE ASKS FOR MORE THAN ONE THING — "add milk and remind me to call the bank" — return
an "actions" array with one entry per thing, each with its own action and data. Do not collapse
them into one and do not silently drop the second.

Allowed Action Names:
- add_todo: user wants to capture a task to do later (e.g., "remember to X", "todo: X")
- complete_todo: user reports finishing a task (past tense statement, e.g., "renewed X",
  "finished X", "shipped X"). A question such as "did I finish X?" is NOT this — see rule 1.
- add_note: user wants to jot down information (e.g., "note: X", "save this: X")
- add_learning: user captured a new concept/lesson (e.g., "learned X", "learning: X")
- learn_context: user tells you a fact about their world/people/projects (e.g., "Rohan is X")
- list_todos: user asks to see tasks
- list_notes: user asks to see notes
- list_learnings: user asks to see learnings
- search: user asks to find/lookup information (e.g., "what do I know about X", "find X")
- search_web: user asks a factual question requiring external search
- set_reminder: user wants a task with a specific reminder time/date
- add_event: user wants to schedule a calendar event
- list_events: user asks for calendar list
- delete_event: user wants to delete an event
- update_event: user wants to update an event
- undo_last: user wants to undo
- review_learning: user is reviewing learnings
- summarise_conversation: user requests a weekly conversation summary
- none: default chat / question

CRITICAL: Return ONLY a valid JSON object in this exact schema, with no additional text or formatting:
{
  "action": "action_name",
  "data": {
    "content": "extracted content or search query",
    "topic": "topic if learning",
    "source": "source if learning",
    "tags": ["0-2 short lowercase tags for grouping, [] if nothing fits — never shown to the user"],
    "title": "event title",
    "datetime": "ISO datetime in IST (e.g. 2026-06-05T21:00:00+05:30) if time mentioned",
    "minutes": "integer minutes from now for reminder if relative",
    "duration": "integer duration in minutes (default 60)",
    "recurrence": "none | daily | weekdays | weekly",
    "new_title": "new event name if updating",
    "id": "learning id for review_learning",
    "gotRight": "boolean for review_learning"
  },
  "confidence": <float between 0.0 and 1.0 indicating intent classification certainty>
}

For a message asking for two or more things, use this shape instead — same data fields per entry:
{
  "actions": [
    { "action": "add_todo", "data": { "content": "milk", "tags": [] } },
    { "action": "set_reminder", "data": { "content": "call the bank", "minutes": 60 } }
  ],
  "confidence": <float>
}

Worked examples:
"finished the dispatch refactor"        -> complete_todo, content "dispatch refactor"
"did I finish the dispatch refactor?"   -> list_todos (rule 1: a question, not a completion)
"I keep forgetting to check my todos"   -> none (rule 2: a remark, create nothing)
"add milk and remind me to call the bank" -> actions array with add_todo and set_reminder`;

// ── Individual model callers ──────────────────────────────────────────────────

async function callGroqModel(modelId, messages, jsonMode) {
  const isReasoning = modelId.includes('deepseek-r1');
  const body = { model: modelId, messages, max_tokens: 2048 };
  // gpt-oss models emit chain-of-thought into the completion. Against a prompt this large they
  // will spend the entire token budget reasoning and get truncated mid-JSON, so cap the effort.
  if (modelId.includes('gpt-oss')) body.reasoning_effort = 'low';
  // R1 doesn't support json_object mode — strip <think> blocks instead
  if (jsonMode && !isReasoning) body.response_format = { type: 'json_object' };
  const r = await axios.post(GROQ_URL, body, {
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 25000,
  });
  let content = r.data?.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error('Empty response');
  // Strip chain-of-thought reasoning block from R1 output
  if (isReasoning) content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return content;
}

async function callOpenRouterModel(modelId, messages, jsonMode) {
  // NOTE: deliberately NOT setting response_format here. The free nemotron model returns
  // thousands of blank lines when json_object mode is requested; the downstream JSON extractor
  // handles prose responses fine, so leave it off.
  const body = { model: modelId, messages, max_tokens: 1024 };
  const r = await axios.post(OPENROUTER_URL, body, {
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': process.env.RENDER_EXTERNAL_URL || 'https://personal-agent',
      'X-Title': 'Personal Agent',
    },
    timeout: 20000,
  });
  const content = r.data?.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error('Empty response');
  return content;
}

async function callGeminiModel(modelId, messages, jsonMode) {
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs  = messages.filter(m => m.role !== 'system');
  if (!chatMsgs.length) throw new Error('No messages');
  const history = chatMsgs.slice(0, -1).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
  const config = { model: modelId };
  if (systemMsg) config.systemInstruction = systemMsg.content;
  if (jsonMode)  config.generationConfig = { responseMimeType: 'application/json' };
  const model = genAI.getGenerativeModel(config);
  const chat  = model.startChat({ history });
  const result = await Promise.race([
    chat.sendMessage(chatMsgs[chatMsgs.length - 1].content),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Gemini timeout')), 20000)),
  ]);
  const text = result.response.text();
  if (!text?.trim()) throw new Error('Empty response');
  return text;
}

async function callOllamaModel(messages, jsonMode) {
  const body = {
    model: "llama3:8b",
    messages,
    stream: false,
    options: {
      temperature: 0.1
    }
  };
  if (jsonMode) {
    body.format = "json";
  }
  const r = await axios.post(OLLAMA_URL, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  const content = r.data?.message?.content;
  if (!content?.trim()) throw new Error('Empty Ollama response');
  return content;
}

async function streamFromUrl(url, headers, body, onToken) {
  const response = await axios.post(url, { ...body, stream: true }, {
    headers,
    responseType: 'stream',
    timeout: 60000,
  });
  return new Promise((resolve, reject) => {
    let buf = '', full = '';
    response.data.on('data', chunk => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') return;
        try {
          const token = JSON.parse(raw).choices?.[0]?.delta?.content || '';
          if (token) { full += token; onToken(token, full); }
        } catch {}
      }
    });
    response.data.on('end', () => resolve(full));
    response.data.on('error', reject);
  });
}

async function callLLMStream(messages, onToken) {
  // Try Groq streaming first (fast, reliable)
  if (process.env.GROQ_API_KEY) {
    for (const model of GROQ_MODELS) {
      if (isModelCoolingDown(model.id)) continue;
      try {
        const full = await streamFromUrl(
          GROQ_URL,
          { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          { model: model.id, messages, max_tokens: 2048 },
          onToken,
        );
        markModelOk(model.id);
        return full;
      } catch (err) {
        console.warn(`[LLM stream] Groq ${model.id} failed (${err.response?.status || err.message})`);
        markModelFailed(model.id);
      }
    }
  }

  // Fallback: OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    for (const model of OR_MODELS) {
      if (isModelCoolingDown(model)) continue;
      try {
        const full = await streamFromUrl(
          OPENROUTER_URL,
          {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': process.env.RENDER_EXTERNAL_URL || 'https://personal-agent',
            'X-Title': 'Personal Agent',
          },
          { model, messages },
          onToken,
        );
        markModelOk(model);
        return full;
      } catch (err) {
        console.warn(`[LLM stream] OR ${model} failed (${err.response?.status || err.message})`);
        markModelFailed(model);
      }
    }
  }

  throw new Error('All streaming models failed');
}

// Extracts the reply string from partial streaming JSON
function extractPartialReply(content) {
  const m = content.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
  if (!m) return null;
  try { return JSON.parse('"' + m[1] + '"'); } catch {
    return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function extractFirstJSON(text) {
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch {}
      }
    }
  }
  return null;
}

// Try a list of async calls in parallel — resolves on first success, rejects if all fail
function raceAll(calls) {
  return new Promise((resolve, reject) => {
    if (!calls.length) { reject(new Error('No candidates')); return; }
    let failed = 0;
    const errs = [];
    calls.forEach(fn => {
      fn().then(resolve).catch(e => {
        errs.push(e);
        if (++failed === calls.length) reject(new Error(errs.map(x => x.message).join(' | ')));
      });
    });
  });
}

async function callLLM(messages, jsonMode = false, routeType = 'default') {
  const hasGroq   = !!process.env.GROQ_API_KEY;
  const hasOR     = !!process.env.OPENROUTER_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;

  let groqOrder = [...GROQ_MODELS];
  let geminiOrder = [...GEMINI_MODELS];
  
  // Derive route preferences from GROQ_MODELS rather than restating model ids — the old
  // duplicated lists silently kept pointing at decommissioned models.
  if (routeType === 'classifier') {
    // Classification is easy; prefer the fastest model first.
    groqOrder = [...GROQ_MODELS].sort((a, b) => (a.quality === 'fast' ? -1 : b.quality === 'fast' ? 1 : 0));

    // Optional paid model ahead of the free ladder, for the one route where a wrong answer
    // cascades: the classifier picks the action, and acting on the wrong intent is worse than
    // answering slowly. Every other model here is free tier, so this must never engage by
    // accident — it is used only when CLASSIFIER_MODEL is set, and any failure falls straight
    // through to the free ladder, so a billing or availability problem degrades rather than
    // breaks. Set it to e.g. nousresearch/hermes-4-70b to try one.
    if (CLASSIFIER_MODEL && hasOR && !isModelCoolingDown(CLASSIFIER_MODEL)) {
      try {
        const r = await callOpenRouterModel(CLASSIFIER_MODEL, messages, jsonMode);
        markModelOk(CLASSIFIER_MODEL);
        return r;
      } catch (e) {
        markModelFailed(CLASSIFIER_MODEL);
        console.warn(`[LLM] CLASSIFIER_MODEL ${CLASSIFIER_MODEL} failed, using the free ladder:`, e.message);
      }
    }
  } else if (routeType === 'reasoner') {
    // Reasoning benefits from the strongest model first.
    groqOrder = [...GROQ_MODELS].sort((a, b) => (a.quality === 'high' ? -1 : b.quality === 'high' ? 1 : 0));
  } else if (routeType === 'synthesizer') {
    if (hasGemini) {
      for (const modelId of geminiOrder) {
        if (isModelCoolingDown(modelId)) continue;
        try {
          const r = await callGeminiModel(modelId, messages, jsonMode);
          markModelOk(modelId);
          return r;
        } catch (e) {
          markModelFailed(modelId);
        }
      }
    }
  } else if (routeType === 'background') {
    try {
      const r = await callOllamaModel(messages, jsonMode);
      return r;
    } catch (e) {
      console.warn('[LLM] Local Ollama failed for background operation, falling back to APIs:', e.message);
    }
  }

  // ── Round 1: Groq primary + secondary in parallel (fast, reliable) ──────
  if (hasGroq) {
    const available = groqOrder.filter(m => !isModelCoolingDown(m.id));
    if (available.length) {
      try {
        const text = await raceAll(available.map(m => async () => {
          try {
            const r = await callGroqModel(m.id, messages, jsonMode);
            markModelOk(m.id);
            return r;
          } catch (e) {
            const s = e.response?.status;
            console.warn(`[LLM] Groq ${m.id} failed (${s || e.code}): ${e.response?.data?.error?.message || e.message}`.slice(0, 120));
            markModelFailed(m.id);
            throw e;
          }
        }));
        return text;
      } catch { /* fall through */ }
    }
  }

  // ── Round 2: OpenRouter (one surviving free model) ───────────────────────
  if (hasOR) {
    const available = OR_MODELS.filter(id => !isModelCoolingDown(id));
    if (available.length) {
      try {
        const text = await raceAll(available.map(id => async () => {
          try {
            const r = await callOpenRouterModel(id, messages, jsonMode);
            markModelOk(id);
            return r;
          } catch (e) {
            const s = e.response?.status;
            console.warn(`[LLM] OR ${id} failed (${s || e.code}): ${e.response?.data?.error?.message || e.message}`.slice(0, 120));
            markModelFailed(id);
            throw e;
          }
        }));
        return text;
      } catch { /* fall through */ }
    }
  }

  // ── Round 3: Gemini (if key present) ─────────────────────────────────────
  if (hasGemini) {
    for (const modelId of geminiOrder) {
      if (isModelCoolingDown(modelId)) continue;
      try {
        const r = await callGeminiModel(modelId, messages, jsonMode);
        markModelOk(modelId);
        return r;
      } catch (e) {
        const is429 = e.message?.includes('429') || e.message?.includes('RESOURCE_EXHAUSTED');
        console.warn(`[LLM] Gemini ${modelId} failed${is429 ? ' (429)' : ''}: ${e.message?.slice(0, 80)}`);
        markModelFailed(modelId);
      }
    }
  }

  // ── Final: Groq retry with cleared cooldowns (covers burst rate-limit) ───
  if (hasGroq) {
    groqOrder.forEach(m => modelFailCache.delete(m.id));
    try {
      return await callGroqModel(groqOrder[groqOrder.length - 1].id, messages, jsonMode);
    } catch (e) {
      console.error('[LLM] Final Groq retry failed:', e.message);
    }
  }

  // ── Ultimate Fallback: Local Ollama model ─────────────────────────────────
  try {
    const r = await callOllamaModel(messages, jsonMode);
    return r;
  } catch (e) {
    console.error('[LLM] Ollama ultimate fallback failed:', e.message);
  }

  throw new Error('All LLMs unavailable');
}

function filterKnowledge(knowledge, userMessage) {
  if (!knowledge.length) return [];
  const words = userMessage.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  if (!words.length) return knowledge.slice(0, 6);
  const scored = knowledge.map(k => {
    const kl = k.toLowerCase();
    const score = words.reduce((n, w) => n + (kl.includes(w) ? 1 : 0), 0);
    return { k, score };
  });
  const relevant = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.k);
  const fallback = scored.filter(x => x.score === 0).slice(0, 3).map(x => x.k);
  return [...relevant, ...fallback];
}

// Chooses which facts reach the prompt.
//
// filterKnowledge ranks by word overlap, which is how "when am I most productive" ended up
// matching "When a task is completed, remove associated reminders" — on the word "when" — while
// "Tarun does focused work in the evenings" never reached the model at all. The agent was being
// handed the wrong context and then blamed for reasoning badly from it. A stronger model does not
// fix that; it just reasons more fluently over the same noise.
//
// The embedding is already computed for the semantic-memory block, so ranking by it costs one
// extra indexed query. Word overlap stays as the fallback: embeddings have been unavailable on
// this project for months at a stretch, and a degraded ranking beats none.
async function selectKnowledge(knowledge, userMessage, embedding) {
  if (embedding) {
    const ranked = await memory.getRelevantKnowledge(embedding);
    if (ranked && ranked.length) return ranked;
  }
  return filterKnowledge(knowledge, userMessage);
}

// ── Intent pre-filter ─────────────────────────────────────────────────────────
// Handles unambiguous common commands without touching any LLM.
// Returns a reply string, or null to fall through to LLM.

// ctx: null = all contexts, 'mode' = current mode
const PREFILTER_RULES = [
  // Explicit completion — "done: X", "finished X", "done with X"
  {
    match: /^(done|finished|completed|done with|just (did|finished|completed)|marked.*done)[:\s]+(.+)/i,
    action: 'complete_todo', tags: [],
    dataFn: (m) => ({ content: m[3].trim() }),
    reply: (data) => `Marked "${data.content}" as done.`,
  },
  // Quick note: prefix
  {
    match: /^(note|save|jot)[:\s]+(.+)/i,
    action: 'add_note', tags: [],
    dataFn: (m) => ({ content: m[2].trim() }),
    reply: (data) => `Saved as a note.`,
  },
  // Quick todo: prefix
  {
    match: /^(todo|task|remind me to|add|remember to)[:\s]+(.+)/i,
    action: 'add_todo', tags: [],
    dataFn: (m) => ({ content: m[2].trim() }),
    reply: (data) => `Added to your todos.`,
  },
];

// A request for two things has to reach the classifier. The prefilter can only ever perform one
// action, so "add milk and remind me to call the bank" was captured as a single todo whose content
// was the entire sentence — the reminder silently dropped, and a todo left that no phrasing would
// ever complete. Requires a command word after the conjunction, so "add milk and eggs" still takes
// the cheap path.
const COMPOUND_REQUEST = /\b(and|then|also)\b[^.!?]*\b(remind|remember|add|note|schedule|book|todo|task|event)\b/i;

async function tryPrefilter(userMessage, replyTo) {
  const msg = userMessage.trim();
  if (COMPOUND_REQUEST.test(msg)) return undefined; // fall through to the LLM
  for (const rule of PREFILTER_RULES) {
    const m = msg.match(rule.match);
    if (!m) continue;

    const data = rule.dataFn ? rule.dataFn(m) : {};
    const tags = rule.tags || [];
    const defaultReply = rule.reply ? rule.reply(data) : null;
    const result = await executeAction(rule.action, { tags, ...data }, defaultReply, replyTo);
    // null = interactive message already sent (e.g. list picker on WhatsApp) — still short-circuit
    return result ?? null;
  }
  return undefined; // sentinel: no rule matched, fall through to LLM
}

function validateJsonSchema(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (typeof parsed.reply !== 'string') return false;
  if (parsed.actions !== undefined) {
    if (!Array.isArray(parsed.actions)) return false;
    for (const act of parsed.actions) {
      if (typeof act !== 'object' || typeof act.action !== 'string') return false;
    }
  } else {
    if (parsed.action !== undefined && typeof parsed.action !== 'string') return false;
  }
  if (parsed.confidence !== undefined && typeof parsed.confidence !== 'number') return false;
  return true;
}

async function handleIncoming(userMessage, replyTo = null) {
  // Check for active multi-turn clarifications (Items 12, 16, 17)
  if (replyTo) {
    const clarification = await memory.getState(`pending_clarification:${replyTo}`);
    if (clarification) {
      if (clarification.type === 'note_merge') {
        const isYes = userMessage.toLowerCase().match(/\b(yes|yep|yeah|merge|ok|sure|do it)\b/);
        const isNo = userMessage.toLowerCase().match(/\b(no|nope|dont|separate|skip)\b/);
        
        if (isYes) {
          const pending = clarification.data;
          const mergedContent = `${pending.existingContent}\n${pending.newContent}`;
          const newEmbedding = await getEmbedding(mergedContent);
          await memory.updateNoteContent(pending.existingId, mergedContent, newEmbedding);
          await memory.deleteState(`pending_clarification:${replyTo}`);
          
          const replyText = `Merged! The note is now:\n${mergedContent}`;
          await memory.saveMessage('user', userMessage, PROMPT_VERSION, Math.ceil(userMessage.length / 4), 0);
          await memory.saveMessage('model', replyText, PROMPT_VERSION, 0, Math.ceil(replyText.length / 4));
          return replyText;
        } else if (isNo) {
          const pending = clarification.data;
          const embedding = await getEmbedding(pending.newContent);
          // addNote(content, tags, embedding) — this passed four arguments against three, so the
          // empty array landed in the embedding slot and became the literal "[]", which is not a
          // valid vector and threw. The saved clarification carries `tags`, never `context`.
          const noteId = await memory.addNote(pending.newContent, pending.tags || [], embedding);
          await memory.deleteState(`pending_clarification:${replyTo}`);
          
          const replyText = `Saved as a separate note.`;
          await memory.saveMessage('user', userMessage, PROMPT_VERSION, Math.ceil(userMessage.length / 4), 0);
          await memory.saveMessage('model', replyText, PROMPT_VERSION, 0, Math.ceil(replyText.length / 4));
          return replyText;
        }
      }
      
      if (clarification.type === 'destructive_action') {
        const isYes = userMessage.toLowerCase().match(/\b(yes|yep|yeah|delete|complete|do it|ok|sure)\b/);
        if (isYes) {
          const { action, data, currentMode, defaultReply } = clarification.data;
          await memory.deleteState(`pending_clarification:${replyTo}`);
          const reply = await executeAction(action, data, defaultReply, replyTo);
          const finalReply = reply || defaultReply;
          await memory.saveMessage('user', userMessage, PROMPT_VERSION, Math.ceil(userMessage.length / 4), 0);
          await memory.saveMessage('model', finalReply, PROMPT_VERSION, 0, Math.ceil(finalReply.length / 4));
          return finalReply;
        } else {
          await memory.deleteState(`pending_clarification:${replyTo}`);
          const replyText = `Action cancelled.`;
          await memory.saveMessage('user', userMessage, PROMPT_VERSION, Math.ceil(userMessage.length / 4), 0);
          await memory.saveMessage('model', replyText, PROMPT_VERSION, 0, Math.ceil(replyText.length / 4));
          return replyText;
        }
      }
    }
  }

  // Fast path: handle unambiguous commands without LLM
  const prefiltered = await tryPrefilter(userMessage, replyTo);
  if (prefiltered !== undefined) {
    const promptLen = Math.ceil(userMessage.length / 4);
    const replyLen = prefiltered ? Math.ceil(prefiltered.length / 4) : 0;
    await memory.saveMessage('user', userMessage, PROMPT_VERSION, promptLen, 0);
    if (prefiltered !== null) await memory.saveMessage('model', prefiltered, PROMPT_VERSION, 0, replyLen);
    return prefiltered;
  }

  // Get history first to feed into Classifier
  const history = await memory.getRecentHistory(8);

  // 1. Run Classifier model with CLASSIFIER_PROMPT on history.slice(-3)
  const classifierMessages = [
    { role: "system", content: CLASSIFIER_PROMPT },
    ...history.slice(-3).map(h => ({
      role: h.role === "user" ? "user" : "assistant",
      content: h.content.length > 300 ? h.content.slice(0, 300) + '…' : h.content,
    })),
    { role: "user", content: `User message: ${userMessage}` }
  ];

  const classifierInputCharCount = classifierMessages.reduce((acc, msg) => acc + (msg.content?.length || 0), 0);
  const classifierTokensInput = Math.ceil(classifierInputCharCount / 4);

  let rawClassifier;
  try {
    rawClassifier = await callLLM(classifierMessages, true, 'classifier');
  } catch (err) {
    console.error('[Brain] Classifier failed:', err.message);
    await memory.saveMessage("user", userMessage, PROMPT_VERSION, classifierTokensInput, 0);
    // Item 4: Graceful LLM degradation
    return "I'm offline right now, I've saved your message and will process it when I'm back.";
  }

  const classifierTokensOutput = Math.ceil(rawClassifier.length / 4);

  let parsedClassifier;
  try {
    parsedClassifier = JSON.parse(rawClassifier);
  } catch {
    parsedClassifier = extractFirstJSON(rawClassifier);
  }

  // Fallback if parsing fails completely
  if (!parsedClassifier || typeof parsedClassifier !== 'object') {
    parsedClassifier = { action: 'none', confidence: 0 };
  }

  // One message can legitimately ask for two things — "add milk and remind me to call the bank".
  // The classifier may answer with an `actions` array; everything downstream (the low-confidence
  // confirmation, the follow-up reminder button) is written around a single primary action, so
  // the first entry stays primary and the rest are executed alongside it.
  const extraActions = Array.isArray(parsedClassifier.actions)
    ? parsedClassifier.actions.filter(a => a && typeof a.action === 'string')
    : [];
  const primaryAction = parsedClassifier.action || extraActions[0]?.action || 'none';
  const primaryData = parsedClassifier.data || extraActions[0]?.data || {};
  // Anything the primary did not already cover.
  const secondaryActions = parsedClassifier.action ? extraActions : extraActions.slice(1);
  const confidence = parsedClassifier.confidence !== undefined ? parsedClassifier.confidence : 1.0;

  const RETRIEVAL_ACTIONS = ['list_todos', 'list_notes', 'list_learnings', 'list_events', 'search', 'search_web', 'summarise_conversation', 'run_skill'];

  if (primaryAction === 'none' || RETRIEVAL_ACTIONS.includes(primaryAction)) {
    // Path A: None or Retrieval -> Full Context & Synthesizer
    const msgEmbedding = await getEmbedding(userMessage);

    const [openPRs, openIssues] = await Promise.all([
      getOpenPRs().catch(() => []),
      getOpenIssues().catch(() => []),
    ]);

    const [stats, insights, knowledge, upcomingEvents, msgCount, contextSummary, learnedSkills] = await Promise.all([
      memory.getSummaryStats(),
      memory.getRecentInsights(3),
      memory.getAllKnowledge(),
      memory.getUpcomingEvents(24),
      memory.getMessageCount(),
      memory.getContextSummary(),
      memory.getAllSkills(),
    ]);

    const semanticMatches = msgEmbedding
      ? await memory.searchMemory(userMessage, msgEmbedding)
      : [];
    // Phase 4: Prune embedding queries to top 2 instead of 5.
    // searchMemory returns `tags`, not `context` — the old template rendered a literal
    // "[undefined]" into every one of these lines and fed it to the model as if it meant something.
    const semanticBlock = semanticMatches.length
      ? `Relevant past memory:\n${semanticMatches.slice(0, 2).map(r => {
          const tags = (r.tags || []).length ? `[${r.tags.join(',')}]` : '';
          return `[${r.type}]${tags} ${r.content}`;
        }).join('\n')}`
      : '';

    // Phase 4: Context Slicing (only feed relevant todos)

    const todoBlock = stats.pendingTodos ? stats.pendingTodos.map(t => `[${(t.tags || []).join(',')}] ${t.content}`) : [];
    const prs = openPRs;
    const issues = openIssues;

    const knowledgeBlock = knowledge.length
      ? `What I know about Tarun's world:\n${(await selectKnowledge(knowledge, userMessage, msgEmbedding)).join('\n')}`
      : '';

    const skillsBlock = learnedSkills.length
      ? `Available Skills (Learned):\n${learnedSkills.map(s => `- ${s.name}: ${s.description}`).join('\n')}`
      : '';

    const insightsBlock = insights.length
      ? `Behavioural insights:\n${insights.join('\n')}`
      : '';

    const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
    const eventsBlock = upcomingEvents.length
      ? `Upcoming events (next 24h):\n${upcomingEvents.map(e => `- ${e.title} at ${new Date(e.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' })}`).join('\n')}`
      : '';

    const summaryBlock = contextSummary ? `Earlier conversation summary:\n${contextSummary}` : '';

    const contextBlock = `Current time: ${now} IST

Pending todos (${todoBlock.length}):
${todoBlock.length ? todoBlock.join('\n') : 'none'}

Unreviewed learnings: ${stats.unreviewed.length}
Open PRs (${prs.length}): ${prs.join(', ') || 'none'}
Open Issues (${issues.length}): ${issues.join(', ') || 'none'}
${eventsBlock}
${semanticBlock}
${skillsBlock}
${knowledgeBlock}
${insightsBlock}
${summaryBlock}`;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      // Phase 4: Aggressive History Summarization (slice history to last 3 exchanges)
      ...history.slice(-3).map(h => ({
        role: h.role === "user" ? "user" : "assistant",
        content: h.content.length > 600 ? h.content.slice(0, 600) + '…' : h.content,
      })),
      { role: "user", content: `${contextBlock}\n\nUser message: ${userMessage}` },
    ];

    const inputCharCount = messages.reduce((acc, msg) => acc + (msg.content?.length || 0), 0);
    const tokensInput = Math.ceil(inputCharCount / 4);

    let raw;
    try {
      raw = await callLLM(messages, true, 'synthesizer');
    } catch (err) {
      console.error('[Brain] All LLMs failed in synthesizer route:', err.message);
      await memory.saveMessage("user", userMessage, PROMPT_VERSION, tokensInput, 0);
      return "I'm offline right now, I've saved your message and will process it when I'm back.";
    }

    const tokensOutput = Math.ceil(raw.length / 4);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = extractFirstJSON(raw);
    }

    if (!parsed || !validateJsonSchema(parsed)) {
      console.warn('[Brain] Malformed JSON response validation failed:', raw);
      await memory.saveMessage("user", userMessage, PROMPT_VERSION, tokensInput, 0);
      await memory.saveMessage("model", raw, PROMPT_VERSION, 0, tokensOutput);
      return "Sorry, I got confused there. Could you try again?";
    }

    if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) parsed.reply = 'Done.';

    const synthAction = Array.isArray(parsed.actions) ? parsed.actions[0]?.action : parsed.action;
    const synthData = Array.isArray(parsed.actions) ? parsed.actions[0]?.data : parsed.data;
    const synthConfidence = parsed.confidence !== undefined ? parsed.confidence : 1.0;

    if (replyTo && synthConfidence < 0.8 && ['complete_todo', 'delete_event'].includes(synthAction)) {
      await memory.saveState(`pending_clarification:${replyTo}`, {
        type: 'destructive_action',
        data: { action: synthAction, data: synthData,  defaultReply: parsed.reply }
      });

      let confirmationQuestion = `Are you sure you want to complete the task "${synthData?.content || ''}"?`;
      if (synthAction === 'delete_event') {
        confirmationQuestion = `Are you sure you want to delete the event "${synthData?.title || ''}"?`;
      }

      await memory.saveMessage("user", userMessage, PROMPT_VERSION, tokensInput, 0);
      await memory.saveMessage("model", confirmationQuestion, PROMPT_VERSION, 0, Math.ceil(confirmationQuestion.length / 4));
      return confirmationQuestion;
    }

    let reply;
    if (Array.isArray(parsed.actions) && parsed.actions.length) {
      for (const item of parsed.actions) {
        await executeAction(item.action, item.data, parsed.reply, replyTo);
      }
      reply = parsed.reply;
    } else {
      reply = await executeAction(parsed.action, parsed.data, parsed.reply, replyTo);
    }

    await memory.saveMessage("user", userMessage, PROMPT_VERSION, tokensInput, 0);
    const finalModelMessage = reply || parsed.reply || "(action executed)";
    if (reply != null) await memory.saveMessage("model", finalModelMessage, PROMPT_VERSION, 0, Math.ceil(finalModelMessage.length / 4));

    if (replyTo) {
      const finalAction = Array.isArray(parsed.actions) ? parsed.actions[0]?.action : parsed.action;
      const finalData = Array.isArray(parsed.actions) ? parsed.actions[0]?.data : parsed.data;
      if (finalAction === 'add_todo' && finalData?.content) {
        const key = finalData.content.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
        setTimeout(async () => {
          try {
            await sendButtonMessage(replyTo, 'Want a reminder for this?', [
              { id: `rem_tonight_${key}`, title: 'Tonight 9pm' },
              { id: `rem_tmrw_${key}`, title: 'Tomorrow 8am' },
              { id: 'rem_no', title: 'Skip' },
            ]);
          } catch (e) { console.error('[Brain] Follow-up button error:', e.message); }
        }, 800);
      }
    }

    const finalMsgCount = await memory.getMessageCount();
    if ((finalMsgCount + 2) % 20 === 0) {
      analyzePatterns().catch(err => console.error('Insight analysis error:', err.message));
      refreshContextSummary().catch(err => console.error('Summary refresh error:', err.message));
    }

    return reply;

  } else {
    // Path B: Capture or Mutation -> Decoupled execution + lightweight synthesis
    if (replyTo && confidence < 0.8 && ['complete_todo', 'delete_event'].includes(primaryAction)) {
      await memory.saveState(`pending_clarification:${replyTo}`, {
        type: 'destructive_action',
        data: { action: primaryAction, data: primaryData,  defaultReply: `Marked "${primaryData?.content || primaryData?.title || ''}" as completed.` }
      });

      let confirmationQuestion = `Are you sure you want to complete the task "${primaryData?.content || ''}"?`;
      if (primaryAction === 'delete_event') {
        confirmationQuestion = `Are you sure you want to delete the event "${primaryData?.title || ''}"?`;
      }

      await memory.saveMessage("user", userMessage, PROMPT_VERSION, classifierTokensInput, 0);
      await memory.saveMessage("model", confirmationQuestion, PROMPT_VERSION, 0, Math.ceil(confirmationQuestion.length / 4));
      return confirmationQuestion;
    }

    let executionStatus;
    try {
      executionStatus = await executeAction(primaryAction, primaryData, null, replyTo);
    } catch (err) {
      console.error('[Brain] Capture/mutation execution error:', err.message);
      executionStatus = `Failed to perform action ${primaryAction}.`;
    }

    // Do the rest of a compound request. Each is guarded on its own so a failure in the second
    // thing cannot discard the first, and the outcomes are joined so the synthesised reply can
    // report on everything that actually happened rather than only the first item.
    for (const extra of secondaryActions) {
      try {
        const status = await executeAction(extra.action, extra.data || {}, null, replyTo);
        if (status) executionStatus = executionStatus ? `${executionStatus}\n${status}` : status;
      } catch (err) {
        console.error('[Brain] Secondary action execution error:', extra.action, err.message);
      }
    }

    // If executionStatus is null (e.g. interactive message already sent), we don't synthesize anything
    if (executionStatus === null) {
      await memory.saveMessage("user", userMessage, PROMPT_VERSION, classifierTokensInput, 0);
      return null;
    }

    const synthesisMessages = [
      {
        role: "system",
        content: `You are Blu, Tarun's Hermes Agent on WhatsApp.
Draft a short, direct confirmation message for the user based on the action execution result.
Rules:
- Plain text ONLY. No markdown headers (# / ##). No emojis. No ✅ ❌ 🔔.
- Keep it 1-2 lines, conversational.
- Do not repeat the action execution result word-for-word, make it sound like a natural human assistant.
- Use *bold* with single asterisks for emphasis inside a sentence if appropriate.`
      },
      ...history.slice(-2).map(h => ({
        role: h.role === "user" ? "user" : "assistant",
        content: h.content.length > 200 ? h.content.slice(0, 200) + '…' : h.content,
      })),
      {
        role: "user",
        content: `User message: "${userMessage}"\nAction execution result: "${executionStatus}"`
      }
    ];

    const synthInputCharCount = synthesisMessages.reduce((acc, msg) => acc + (msg.content?.length || 0), 0);
    const synthTokensInput = Math.ceil(synthInputCharCount / 4);

    let replyText;
    try {
      replyText = await callLLM(synthesisMessages, false, 'synthesizer');
    } catch (err) {
      console.error('[Brain] Synthesis model failed, using executionStatus directly:', err.message);
      replyText = executionStatus;
    }

    const synthTokensOutput = Math.ceil(replyText.length / 4);

    const totalTokensInput = classifierTokensInput + synthTokensInput;
    const totalTokensOutput = classifierTokensOutput + synthTokensOutput;

    await memory.saveMessage("user", userMessage, PROMPT_VERSION, totalTokensInput, 0);
    await memory.saveMessage("model", replyText, PROMPT_VERSION, 0, totalTokensOutput);

    // Learn from the exchange in the background. Deliberately after the reply is composed so a
    // slow or failing extraction can never delay or break the answer Tarun actually gets.
    extractFactsFromExchange(userMessage, replyText)
      .catch(err => console.error('[Facts] Extraction error:', err.message));

    if (replyTo && primaryAction === 'add_todo' && primaryData?.content) {
      const key = primaryData.content.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
      setTimeout(async () => {
        try {
          await sendButtonMessage(replyTo, 'Want a reminder for this?', [
            { id: `rem_tonight_${key}`, title: 'Tonight 9pm' },
            { id: `rem_tmrw_${key}`, title: 'Tomorrow 8am' },
            { id: 'rem_no', title: 'Skip' },
          ]);
        } catch (e) { console.error('[Brain] Follow-up button error:', e.message); }
      }, 800);
    }

    const finalMsgCount = await memory.getMessageCount();
    if ((finalMsgCount + 2) % 20 === 0) {
      analyzePatterns().catch(err => console.error('Insight analysis error:', err.message));
      refreshContextSummary().catch(err => console.error('Summary refresh error:', err.message));
    }

    return replyText;
  }
}

async function refreshContextSummary() {
  const history = await memory.getRecentHistory(40);
  if (history.length < 10) return;
  const histText = history.map(h => `${h.role}: ${h.content}`).join('\n');
  const raw = await callLLM([{
    role: 'user',
    content: `Summarize this conversation in 3-5 sentences. Focus on decisions made, things saved, key context — NOT greetings or small talk.\n\n${histText}\n\nSummary:`,
  }]);
  await memory.saveContextSummary(raw.trim());
}

// Streaming version — streams reply tokens, executes action after full response
async function handleIncomingStream(userMessage, onToken) {
  // The embedding rides along in the same batch, so ranking knowledge properly costs no extra
  // wall-clock time before the first streamed token.
  const [history, stats, openPRs, openIssues, insights, knowledge, upcomingEvents, msgCount, learnedSkills, msgEmbedding] = await Promise.all([
    memory.getRecentHistory(10),
    memory.getSummaryStats(),
    getOpenPRs(),
    getOpenIssues(),
    memory.getRecentInsights(5),
    memory.getAllKnowledge(),
    memory.getUpcomingEvents(24),
    memory.getMessageCount(),
    memory.getAllSkills(),
    getEmbedding(userMessage),
  ]);

  const todoBlock = [
    ...(stats.pendingTodos || []).map(t => `[${(t.tags || []).join(',')}] ${t.content}`),
  ];

  const skillsBlock = learnedSkills.length
    ? `Available Skills (Learned):\n${learnedSkills.map(s => `- ${s.name}: ${s.description}`).join('\n')}`
    : '';

  const knowledgeBlock = knowledge.length
    ? `What I know about Tarun's world:\n${(await selectKnowledge(knowledge, userMessage, msgEmbedding)).join('\n')}` : '';
  
  const insightsBlock = insights.length ? `Behavioural insights:\n${insights.join('\n')}` : '';
  
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
  const eventsBlock = upcomingEvents.length
    ? `Upcoming events (next 24h):\n${upcomingEvents.map(e => `- ${e.title} at ${new Date(e.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' })}`).join('\n')}` : '';

  const contextBlock = `Current time: ${now} IST

Pending todos (${todoBlock.length}):
${todoBlock.join('\n') || 'none'}

Unreviewed learnings: ${stats.unreviewed.length}
Open PRs (${openPRs.length}): ${openPRs.join(', ') || 'none'}
Open Issues (${openIssues.length}): ${openIssues.join(', ') || 'none'}
${eventsBlock}
${skillsBlock}
${knowledgeBlock}
${insightsBlock}`;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map(h => ({ role: h.role === "user" ? "user" : "assistant", content: h.content })),
    { role: "user", content: `${contextBlock}\n\nUser message: ${userMessage}` },
  ];

  let sentLen = 0;
  const full = await callLLMStream(messages, (token, accumulated) => {
    const reply = extractPartialReply(accumulated);
    if (reply && reply.length > sentLen) {
      onToken(reply.slice(sentLen));
      sentLen = reply.length;
    }
  });

  let parsed;
  try {
    parsed = JSON.parse(full);
  } catch {
    parsed = extractFirstJSON(full);
  }

  if (!parsed) {
    await memory.saveMessage("user", userMessage);
    await memory.saveMessage("model", full);
    return "Sorry, I got confused there. Could you try again?";
  }

  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) parsed.reply = 'Done.';

  const reply = await executeAction(parsed.action, parsed.data, parsed.reply);
  const finalModelMessage = reply || parsed.reply || "(action executed)";
  await memory.saveMessage("user", userMessage);
  await memory.saveMessage("model", finalModelMessage);

  if ((msgCount + 2) % 20 === 0) {
    analyzePatterns().catch(err => console.error('Insight analysis error:', err.message));
  }

  return reply;
}

async function executeAction(action, data, defaultReply, replyTo = null) {
  const tags = data?.tags || [];
  try {
    switch (action) {
      case "set_goal":
        if (data?.content) {
          await memory.saveGoal(data.content, tags);
          return `Goal set: "${data.content}".`;
        }
        return "No goal content provided.";

      case "complete_goal": {
        const goal = await memory.getPendingGoal();
        if (goal) {
          await memory.completeGoal(goal.id);
          return `Awesome work finishing the **One Big Thing**: ${goal.content}! Goal cleared.`;
        }
        return "You don't have an active 'One Big Thing' set for today.";
      }

      // Disambiguation ("did you complete X, or should I add it?") — the model's own
      // clarifying question is the reply; nothing to execute.
      case "ask_context":
        return defaultReply || "Did you just complete that, or should I add it as a task?";
      
      case "add_note":
        if (data?.content) {
          const embedding = await getEmbedding(data.content);
          const matches = embedding ? await memory.searchMemory(data.content, embedding) : [];
          const similarNote = matches.find(m => m.type === 'note' && m.score > 0.85);

          if (similarNote && replyTo) {
            await memory.saveState(`pending_clarification:${replyTo}`, {
              type: 'note_merge',
              data: {
                newContent: data.content,
                existingId: similarNote.id,
                existingContent: similarNote.content,
                tags
              }
            });
            return `I found a similar note: "${similarNote.content}". Would you like to merge this new note with the existing one? (Reply "yes" to merge, "no" to save as separate)`;
          }

          const noteId = await memory.addNote(data.content, tags, embedding);
          autoTagNote(noteId, data.content).catch(() => {});
          findConnections(callLLM, data.content, 'note').catch(() => {});
          return `Note saved: "${data.content}"`;
        }
        return "No note content provided.";

      case "add_todo":
        if (data?.content) {
          const embedding = await getEmbedding(data.content);
          await memory.addTodo(data.content, tags, null, embedding);
          return `Todo added: "${data.content}"`;
        }
        return "No todo content provided.";

      case "add_learning":
        if (data?.topic && data?.content) {
          const embedding = await getEmbedding(`${data.topic}: ${data.content}`);
          await memory.addLearning(data.topic, data.content, data.source, embedding);
          findConnections(callLLM, `${data.topic}: ${data.content}`, 'learning').catch(() => {});
          return `Learning captured on *${data.topic}*: "${data.content}"`;
        }
        return "Topic and content are required for learnings.";

      case "learn_context":
        if (data?.content) {
          const embedding = await getEmbedding(data.content);
          const contradiction = await detectContradiction(data.content, embedding);
          const knowledgeId = await memory.saveKnowledge(data.content, embedding, tags);
          
          extractAndLinkEntities(data.content, knowledgeId).catch(err => console.error('[Entity Graph] Error:', err.message));

          let confirmation = `Got it: "${data.content}"`;
          if (contradiction) {
            return `${confirmation}\n\n*Note:* This contradicts what I already know:\n${contradiction.replace('CONTRADICTION:', '').trim()}`;
          }
          return confirmation;
        }
        return "No content to learn.";

      // Never claim success without checking what actually changed. The old version ignored
      // the returned rows, so a keyword that matched nothing still reported "marked as
      // completed" while the todo stayed pending and resurfaced later.
      case "complete_todo": {
        if (!data?.content) return "No todo content specified to complete.";

        const completed = await memory.completeTodoByContent(data.content);
        if (completed.length === 1) return `Marked as done: "${completed[0].content}"`;
        if (completed.length > 1) {
          return `Marked ${completed.length} as done: ${completed.map(t => `"${t.content}"`).join(', ')}`;
        }

        // Nothing matched — say so, and offer the closest pending items by word overlap.
        const pending = await memory.getPendingTodos();
        if (!pending.length) return `Nothing matched "${data.content}" — you have no pending todos.`;

        const words = data.content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        const near = pending
          .map(t => ({ t, score: words.reduce((n, w) => n + (t.content.toLowerCase().includes(w) ? 1 : 0), 0) }))
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        if (!near.length) return `I couldn't find a pending todo matching "${data.content}". Nothing was changed.`;
        return `I couldn't find an exact match for "${data.content}". Did you mean:\n` +
          near.map((x, i) => `${i + 1}. ${x.t.content}`).join('\n');
      }

      case "set_reminder": {
        if (!data?.content) return "No reminder content provided.";
        const remindAt = data?.datetime
          ? new Date(data.datetime)
          : new Date(Date.now() + (parseInt(data?.minutes) || 60) * 60 * 1000);
        const embedding = await getEmbedding(data.content);
        await memory.addTodo(data.content, tags, remindAt, embedding);
        const timeStr = remindAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
        return `Reminder set for ${timeStr}: "${data.content}"`;
      }

      case "add_event": {
        if (data?.title && data?.datetime) {
          const startAt = new Date(data.datetime);
          const duration = parseInt(data?.duration) || 60;
          const endAt = new Date(startAt.getTime() + duration * 60 * 1000);
          const recurrence = ['none', 'daily', 'weekdays', 'weekly'].includes(data?.recurrence)
            ? data.recurrence : 'none';
          await memory.addEvent(data.title, startAt, endAt, tags, recurrence);
          const timeStr = startAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
          return `Event added to calendar on ${timeStr}: "${data.title}"`;
        }
        return "Event title and datetime are required.";
      }

      case "list_events": {
        const events = await memory.listEvents(tags[0] || null, 10);
        if (!events.length) return 'Nothing on your calendar yet.';
        const fmtEvent = ev => {
          const timeStr = new Date(ev.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
          const rec = ev.recurrence !== 'none' ? ` _(${ev.recurrence})_` : '';
          return `${ev.title} — ${timeStr}${rec}`;
        };
        return `*Calendar* (${events.length})\n\n` + events.map((ev, i) => `${i + 1}. ${fmtEvent(ev)}`).join('\n');
      }

      case "delete_event": {
        if (!data?.title) return "No event title provided to delete.";
        const matches = await memory.findEventByTitle(data.title);
        if (!matches.length) return `Couldn't find an event matching "${data.title}".`;
        if (matches.length === 1) {
          await memory.deleteEvent(matches[0].id);
          return `Removed *${matches[0].title}* from your calendar.`;
        }
        const list = matches.map((ev, i) => {
          const timeStr = new Date(ev.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
          return `${i + 1}. ${ev.title} — ${timeStr}`;
        }).join('\n');
        return `Found ${matches.length} matching events:\n${list}\n\nWhich one should I remove?`;
      }

      case "update_event": {
        if (!data?.title) return "No event title provided to update.";
        const hits = await memory.findEventByTitle(data.title);
        if (!hits.length) return `Couldn't find an event matching "${data.title}".`;
        const ev = hits[0];
        const updates = {};
        if (data.new_title) updates.title = data.new_title;
        if (data.datetime) {
          updates.start_at = new Date(data.datetime);
          const duration = parseInt(data?.duration) || 60;
          updates.end_at = new Date(updates.start_at.getTime() + duration * 60 * 1000);
        }
        if (data.recurrence && ['none', 'daily', 'weekdays', 'weekly'].includes(data.recurrence)) {
          updates.recurrence = data.recurrence;
        }
        await memory.updateEvent(ev.id, updates);
        return `Updated event "${ev.title}".`;
      }

      case "list_todos": {
        const tagsToFilter = data?.tags || [];
        const todos = await memory.getPendingTodos();
        let filtered = todos;
        if (tagsToFilter.length > 0) {
          filtered = todos.filter(t => tagsToFilter.some(tag => (t.tags || []).includes(tag)));
        }
        if (filtered.length === 0) return "No pending todos.";
        let out = filtered.map((t, i) => `${i + 1}. ${t.content}${t.remind_at ? ' (⏰ ' + new Date(t.remind_at).toLocaleString() + ')' : ''}`).join('\n');
        return out;
      }

      case "list_notes": {
        const notes = await memory.getRecentNotes(tags[0] || null, 8);
        if (!notes.length) return 'No notes saved yet.';
        return `*Recent Notes* (${notes.length})\n\n` +
          notes.map((n, i) => `${i + 1}. ${n.content}`).join('\n');
      }

      case "list_learnings": {
        const learnings = await memory.getDueLearnings(8);
        if (!learnings.length) return "No learnings due for review right now. You're all caught up!";
        return `*Learnings for Review (Spaced Repetition)* (${learnings.length})\n\n` +
          learnings.map((l, i) => `${i + 1}. *${l.topic}*\n   ${l.content}\n   _(Id: ${l.id})_`).join('\n\n');
      }

      case "review_learning": {
        if (data?.id) {
          const gotRight = data.gotRight !== false;
          await memory.reviewLearning(data.id, gotRight);
          return `Reviewed learning. Next review scheduled.`;
        }
        return defaultReply;
      }

      case "summarise_conversation": {
        const convs = await memory.getConversationsLastWeek();
        if (!convs.length) return "No conversation history found for the last week.";
        
        const convsText = convs.map(c => `${c.role === 'user' ? 'Tarun' : 'Blu'}: ${c.content}`).join('\n');
        const prompt = `Here is the conversation history of Tarun and his agent Blu for the last week:\n\n${convsText}\n\nSummarize the key events, decisions, items captured (todos/notes/learnings), and status updates. Make it concise and easy to read on WhatsApp (under 10 lines).`;
        
        const synthesis = await callLLM([{ role: 'user', content: prompt }]);
        return synthesis.trim();
      }

      case "search": {
        const query = data?.content;
        if (!query) return 'What should I search for?';
        
        const entName = query.toLowerCase().replace(/what\s+do\s+i\s+know\s+about/i, '').replace(/find/i, '').replace(/search/i, '').trim();
        const entityKnowledge = await memory.getKnowledgeByEntity(entName);
        if (entityKnowledge.length) {
          return `*What I know about ${entName}*:\n\n` + 
            entityKnowledge.map((k, i) => `${i + 1}. ${k.fact}`).join('\n');
        }
        
        const embedding = await getEmbedding(query);
        const results = await memory.searchMemory(query, embedding);
        if (!results.length) return `Nothing found for "${query}".`;
        return `*Search: "${query}"* (${results.length} results)\n\n` +
          results.map((r, i) => `${i + 1}. [${r.type}] ${r.content}`).join('\n');
      }

      case "search_web": {
        const query = data?.content;
        if (!query) return 'What should I search for?';
        if (!process.env.SERPER_API_KEY) return 'Web search not configured (SERPER_API_KEY missing).';
        const results = await webSearch(query);
        if (!results.length) return `No results found for "${query}".`;

        const snippets = results.map(r => {
          if (r.type === 'answer' || r.type === 'knowledge') return `DIRECT ANSWER: ${r.text}`;
          return `${r.title}: ${r.snippet}`;
        }).join('\n\n');

        const synthesis = await callLLM([{
          role: 'user',
          content: `Query: "${query}"\n\nSearch results:\n${snippets}\n\nAnswer the query in plain text using only these results. Be concise (under 6 lines). No markdown except *bold*. If results are insufficient, say so.`,
        }]);

        // Persist stable facts so Blu never needs to search for them again
        if (data?.cache && data?.fact) {
          memory.saveKnowledge(data.fact).catch(() => {});
        }

        return synthesis.trim();
      }

      case "undo_last": {
        const last = await memory.getLastCreatedItem();
        if (!last) return "Nothing recent to undo.";
        if (last.type === 'todo') {
          await memory.completeTodo(last.id);
          return `Removed "${last.content}" from your todos.`;
        }
        if (last.type === 'note') {
          await memory.deleteNote(last.id);
          return `Deleted note: "${last.content.slice(0, 60)}${last.content.length > 60 ? '…' : ''}".`;
        }
        if (last.type === 'event') {
          await memory.deleteEvent(last.id);
          return `Removed "${last.content}" from your calendar.`;
        }
        return "Undo completed.";
      }

      case "generate_brief":
        return await generateStandup(data?.type || 'generic');

      case "create_skill": {
        const { skill_name, skill_desc, skill_instr } = data;
        if (!skill_name || !skill_desc || !skill_instr) return "I need a name, description, and instructions to learn a skill.";
        await memory.saveSkill(skill_name, skill_desc, skill_instr);
        return `I've learned the skill: *${skill_name}*. I can now ${skill_desc}.`;
      }

      case "run_skill": {
        const { skill_name, content } = data;
        const skills = await memory.getAllSkills();
        const skill = skills.find(s => s.name === skill_name);
        if (!skill) return `I don't know how to "${skill_name}" yet.`;

        const skillPrompt = `You are performing the skill: *${skill.name}*.
Description: ${skill.description}
Instructions: ${skill.instructions}

Input context: ${content || 'No specific input provided.'}

Follow the instructions exactly and return a clear, helpful response.`;

        return await callLLM([{ role: 'user', content: skillPrompt }]);
      }

      default:
        return defaultReply;
    }
  } catch (err) {
    console.error("Action execution error:", action, err.message);
    // Never fall back to defaultReply here. It is the optimistic confirmation written before the
    // work was attempted — the model's "Todo added: buy milk", or the prefilter's "Added to your
    // todos." — so returning it reports success for something that just failed. When the database
    // was unreachable this silently swallowed every capture while still telling Tarun it saved.
    // Same principle as complete_todo above: never claim success without checking what changed.
    return "Something went wrong on my end and that didn't go through — it's logged. Try again in a moment.";
  }
}

// ── Passive fact learning ─────────────────────────────────────────────────────
// learn_context only fires when Tarun states a fact outright and the model thinks to call it.
// Most of what is worth remembering arrives in passing — "Rohan handles dispatch", "the patient
// app is the hard part" — and nothing captured any of it. That is why the knowledge table held
// five facts from June after months of use: the agent had no way to become better informed, so
// every conversation started from the same near-empty base.
//
// This runs after the reply has already gone out, on the background route, and is deliberately
// stingy. A wrong fact is worse than a missing one — it gets retrieved and reasoned from for
// months, and there is no natural moment at which anyone reviews it.

const FACT_EXTRACTION_PROMPT = `Extract durable facts about the user's world from this exchange.

A durable fact is something still true in six months: people and their roles, projects and what
they involve, the user's work, the tools they use, their routines, preferences and constraints.

NOT facts: tasks or things to do, one-off events or appointments, questions the user asked,
anything the assistant said about itself, temporary states ("I'm tired", "I'm busy today"), and
anything you are inferring rather than being told directly.

Return JSON: {"facts": ["...", "..."]}
At most 2. Prefer none over a guess — return {"facts": []} when nothing qualifies.
Write each fact as a standalone sentence that still makes sense with no other context, in the
third person about the user. Never write a fact as "I" or "me": these are stored as things an
assistant knows about the user, and a first-person fact reads as the assistant describing itself.`;

// Commands and one-word acknowledgements never carry a durable fact, and every exchange that
// reaches the model costs a round trip. Kept separate so the rule is testable on its own.
function shouldExtractFacts(userMessage) {
  const msg = (userMessage || '').trim();
  if (msg.length < 25) return false;
  // Capture and retrieval commands — the content is a task or a query, not a fact.
  if (/^(todo|task|note|save|jot|done|finished|completed|remind me to|add|remember to)\b[:\s]/i.test(msg)) return false;
  if (/^(list|show|what|when|where|which|who|how|why|search|find)\b/i.test(msg)) return false;
  return true;
}

async function extractFactsFromExchange(userMessage, replyText) {
  if (!shouldExtractFacts(userMessage)) return;

  const raw = await callLLM(
    [{ role: 'user', content: `${FACT_EXTRACTION_PROMPT}\n\nUser: ${userMessage}\nAssistant: ${replyText}` }],
    true,
    'background'
  );

  const parsed = extractFirstJSON(raw);
  const facts = Array.isArray(parsed?.facts) ? parsed.facts.slice(0, 2) : [];

  for (const fact of facts) {
    await storeFactIfNew(fact);
  }
}

// Stores one fact unless something close enough is already known. Shared with the seeding script
// (src/seed_knowledge.js) so both paths dedupe the same way.
//
// Near-duplicates are not harmless: filterKnowledge ranks by word overlap, so three phrasings of
// the same fact crowd genuinely relevant ones out of the prompt window.
// Returns the new row id, or null when nothing was written.
async function storeFactIfNew(fact) {
  if (typeof fact !== 'string') return null;
  const clean = fact.trim();
  if (clean.length < 10) return null;

  const embedding = await getEmbedding(clean);
  if (embedding) {
    const matches = await memory.searchMemory(clean, embedding);
    if (matches.some(m => m.type === 'knowledge' && m.score > 0.9)) return null;
  } else {
    // Embeddings have been unavailable for months at a stretch on this project — a retired model
    // and a missing key (8f7a7f6). Without a fallback the dedupe silently disappears exactly when
    // facts are still being written, and the table fills with the near-duplicates this check
    // exists to prevent. Normalised equality is conservative: it misses paraphrases, but it
    // stops the same sentence being stored on every mention.
    const known = await memory.getAllKnowledge();
    const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const target = norm(clean);
    if (known.some(k => norm(k) === target)) return null;
  }

  const knowledgeId = await memory.saveKnowledge(clean, embedding, []);
  extractAndLinkEntities(clean, knowledgeId).catch(() => {});
  return knowledgeId;
}

// Bulk extraction for seeding: the same discipline as the per-exchange path, but over a
// deliberate brain dump rather than a passing remark, so it takes many facts instead of two.
const USER_NAME = process.env.USER_NAME || 'Tarun';

const SEED_EXTRACTION_PROMPT = `Split the user's description of their world into atomic facts.

Each fact must be a single standalone sentence that still makes sense with no other context —
name people and projects explicitly rather than writing "he", "it" or "the project".

Write every fact in the third person about ${USER_NAME}. The input is written in the first
person, so convert it: "I run X" becomes "${USER_NAME} runs X". Never write a fact as "I" or
"me" — these are stored as things an assistant knows about ${USER_NAME}, and a first-person
fact reads as the assistant describing itself.

Keep: people and their roles, projects and what they involve, ${USER_NAME}'s work, tools and
stack, routines and recurring commitments, preferences, and constraints.
Drop: one-off tasks, specific dated appointments, and anything you are inferring rather than
being told.

Return JSON: {"facts": ["...", "..."]}
Split compound statements into separate facts. Do not invent detail that is not present.`;

// A deliberate brain dump legitimately contains a lot; the per-exchange path is the stingy one.
async function extractFactsFromText(text, max = 30) {
  if (!text || !text.trim()) return [];

  const raw = await callLLM(
    [{ role: 'user', content: `${SEED_EXTRACTION_PROMPT}\n\n${text.trim()}` }],
    true,
    'background'
  );

  const parsed = extractFirstJSON(raw);
  if (!Array.isArray(parsed?.facts)) return [];

  return parsed.facts
    .filter(f => typeof f === 'string' && f.trim().length >= 10)
    .map(f => f.trim())
    .slice(0, max);
}

async function analyzePatterns() {
  const [history, stats] = await Promise.all([
    memory.getRecentHistory(40),
    memory.getSummaryStats(),
  ]);
  const historyText = history.map(h => `${h.role}: ${h.content}`).join('\n');
  const prompt = `Analyze this conversation history for Tarun's personal AI agent.
Extract 2-3 short behavioural insights about his patterns and habits.

History: ${historyText}
Stats: ${(stats.pendingTodos || []).length} pending todos, ${(stats.unreviewed || []).length} unreviewed learnings

Return ONLY a JSON array: ["insight 1", "insight 2"]`;

  const raw = await callLLM([{ role: "user", content: prompt }], false, 'background');
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    const insights = JSON.parse(match[0]);
    for (const insight of insights) await memory.saveInsight(insight);
  } catch { /* skip */ }
}

async function generateProactiveNudge() {
  const [stats, insights, openPRs, pendingGoal] = await Promise.all([
    memory.getSummaryStats(),
    memory.getRecentInsights(5),
    getOpenPRs(),
    memory.getPendingGoal(),
  ]);

  const prompt = `You are Blu, Tarun's Hermes Agent. Analyze his current state and decide if a proactive nudge is needed.

Priority 1 (Goal Check): If there is a pending "One Big Thing", nudge him about it if it's late evening.
Priority 2 (Automation): Look at his behavioural insights and recent tasks. Suggest ONE specific thing he could automate or a tool/skill I could learn to help him.
Priority 3 (General): Only if the above aren't urgent, mention a blocker or a stale item.

Data:
- Pending "One Big Thing": ${pendingGoal ? pendingGoal.content : 'none'}
- Recent Insights: ${insights.join(', ') || 'none'}
- Open PRs: ${openPRs.join(', ') || 'none'}
- Stats: ${(stats.pendingTodos || []).length} tasks pending.

If nothing truly valuable to say, reply SKIP.
Tone: Guardian-like, efficiency-obsessed, direct. Under 5 lines. No markdown except *bold*.`;

  const result = await callLLM([{ role: "user", content: prompt }], false, 'background');
  return result.trim() === 'SKIP' ? null : result;
}

async function generateStandup(type) {
  const [stats, openPRs, recentCommits] = await Promise.all([
    memory.getSummaryStats(),
    getOpenPRs(),
    getRecentCommits(),
  ]);

  const yesterday = await memory.getYesterdayActivity();
  
  let prompt = `You are Blu, Tarun's Hermes Agent. Generate a concise brief.\n\n`;
  prompt += `Structure:\n`;
  prompt += `1. *Recent Wins*: Summarize yesterday's key wins.\n`;
  prompt += `2. *On the Horizon*: Key open todos and PRs needing attention.\n\n`;
  prompt += `Data:\n`;
  prompt += `- Completed yesterday: ${(yesterday.completed || []).map(t => t.content).join(', ') || 'none'}\n`;
  prompt += `- Pending Todos: ${(stats.pendingTodos || []).map(t => t.content).join(', ') || 'none'}\n`;
  prompt += `- Open PRs: ${openPRs.join(', ') || 'none'}\n\n`;
  prompt += `Tone: Direct, professional, guardian-like. Plain text, no markdown except *bold*. Under 8 lines.`;

  return await callLLM([{ role: "user", content: prompt }], false, 'background');
}

async function autoTagNote(noteId, content) {
  const raw = await callLLM([{
    role: 'user',
    content: `Extract 3-5 short keyword tags from this note. Return ONLY a JSON array of lowercase strings.\nNote: "${content}"\nExample output: ["tag1", "tag2", "tag3"]`,
  }], true, 'background');
  try {
    const match = raw.match(/\[[\s\S]*?\]/);
    const tags = JSON.parse(match[0]);
    if (Array.isArray(tags)) await memory.updateNoteTags(noteId, tags);
  } catch { /* skip silently */ }
}

async function generateStaleAlert() {
  const stale = await memory.getStaleTodos(5);
  if (!stale.length) return null;

  let msg = `Heads up — ${stale.length} todo${stale.length > 1 ? 's have' : ' has'} been sitting for 5+ days:\n\n`;
  msg += stale.map((t, i) => `${i + 1}. ${t.content}`).join('\n') + '\n\n';
  msg += 'Still relevant? Mark done or drop them.';
  return msg;
}

async function generateWeeklyReview() {
  const [activity, openPRs, recentCommits] = await Promise.all([
    memory.getWeeklyActivity(),
    getOpenPRs(),
    getRecentCommits(),
  ]);

  const prompt = `Generate Tarun's weekly review in plain text (no markdown except *bold* headers).

Format:
*Weekly Review*

Shipped this week:
[completed todos + merged work]

Captured:
[learnings and notes added]

Progress:
[todos completed vs added ratio, honest assessment]

Still open:
[key pending items]

Data:
Completed todos (${activity.completedTodos.length}): ${activity.completedTodos.map(t => `[${t.context}] ${t.content}`).join(', ') || 'none'}
Added todos (${activity.addedTodos.length}): ${activity.addedTodos.map(t => t.content).join(', ') || 'none'}
New learnings (${activity.newLearnings.length}): ${activity.newLearnings.map(l => l.topic).join(', ') || 'none'}
New notes (${activity.newNotes.length})
Open PRs: ${openPRs.join(', ') || 'none'}
Recent commits: ${recentCommits.slice(0, 3).join(', ') || 'none'}

Keep it honest, practical, under 15 lines. Plain text only.`;

  return await callLLM([{ role: 'user', content: prompt }], false, 'background');
}

async function generateTechPulse() {
  if (!process.env.SERPER_API_KEY) return null;

  // 1. Fetch interests from permanent knowledge
  const knowledge = await memory.getAllKnowledge();
  const interestPrompt = `Based on these facts about Tarun, extract a list of 3-5 specific tech interests or people he follows on X/Twitter. 
Knowledge:
${knowledge.join('\n')}

Return ONLY a comma-separated list of keywords. If nothing found, return "AI Agents, GenAI, Web Dev".`;
  
  const interests = await callLLM([{ role: 'user', content: interestPrompt }], false, 'background');
  
  // 2. Search for latest updates using Serper
  const query = `latest tech trends and top tweets about ${interests} today`;
  const results = await webSearch(query);
  
  if (!results || results.length < 2) return null;

  // 3. Synthesize the Pulse
  const snippets = results.map(r => `${r.title}: ${r.snippet}`).join('\n\n');
  const synthesisPrompt = `You are Blu, the Hermes Agent. Tarun loves Tech Twitter. Based on these latest web results, give him a curated "Pulse" of what he'd find interesting today.

Interests: ${interests}
Latest Info:
${snippets}

Tone: Enthusiastic, high-signal, concise. Use *bold* for topics. Under 10 lines. Plain text only.`;

  return await callLLM([{ role: 'user', content: synthesisPrompt }], false, 'background');
}

async function detectContradiction(newFact, embedding) {
  if (!embedding) return null;
  const matches = await memory.searchMemory(newFact, embedding);
  const existingFacts = matches.filter(m => m.type === 'knowledge').map(m => m.content);
  if (!existingFacts.length) return null;
  
  const checkPrompt = `Compare this new fact against the existing facts about Tarun's world to see if there is any direct contradiction.
  
New Fact: "${newFact}"

Existing Facts:
${existingFacts.map(f => `- ${f}`).join('\n')}

Reply with "CONTRADICTION: [short explanation of what contradicts]" if there is a contradiction (e.g. conflicting info about names, tools, times, schedules). Otherwise, reply with exactly "NONE".`;
  
  try {
    const response = await callLLM([{ role: 'user', content: checkPrompt }]);
    const trimRes = response.trim();
    if (trimRes.startsWith('CONTRADICTION:')) {
      return trimRes;
    }
  } catch (err) {
    console.error('[Contradiction Check Error]:', err.message);
  }
  return null;
}

async function extractAndLinkEntities(factText, knowledgeId) {
  const prompt = `Extract all key entities (people, projects, tools, companies, locations) from this text:
  
Text: "${factText}"

Return a JSON array of objects representing the entities, where each object has:
- name: canonical name of the entity (e.g. "Rohan", "SmartResQ", "Gemini")
- type: "person", "project", "tool", "company", or "other"

Return ONLY the raw JSON array (e.g. [{"name": "Rohan", "type": "person"}]), nothing else.`;

  try {
    const raw = await callLLM([{ role: 'user', content: prompt }], true, 'background');
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    const entities = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    if (Array.isArray(entities)) {
      for (const ent of entities) {
        if (ent.name) {
          await memory.linkEntityToKnowledge(ent.name, ent.type, knowledgeId);
          console.log(`[Entity Graph] Linked entity "${ent.name}" (${ent.type}) to knowledge ${knowledgeId}`);
        }
      }
    }
  } catch (err) {
    console.error('[Entity Graph Link Error]:', err.message);
  }
}

async function autoSummarizeOldNotes() {
  try {
    const oldNotes = await memory.getOldNotes(30);
    if (!oldNotes.length) return;
    
    console.log(`[Notes Summarizer] Found ${oldNotes.length} notes older than 30 days. Summarizing...`);
    for (const note of oldNotes) {
      try {
        const prompt = `Convert the following temporary note into a concise, permanent factual statement about Tarun's life or work.
  
Note Content: "${note.content}"

Output only the single summarized factual statement, nothing else.`;
        
        const summaryFact = await callLLM([{ role: 'user', content: prompt }], false, 'background');
        const fact = summaryFact.trim();
        if (fact) {
          const embedding = await getEmbedding(fact);
          const knowledgeId = await memory.saveKnowledge(fact, embedding, note.context);
          await extractAndLinkEntities(fact, knowledgeId);
          await memory.deleteNote(note.id);
          console.log(`[Notes Summarizer] Note ${note.id} summarized and archived.`);
        }
      } catch (err) {
        console.error(`[Notes Summarizer] Error summarizing note ${note.id}:`, err.message);
      }
    }
  } catch (e) {
    console.error('[Notes Summarizer] Main loop failed:', e.message);
  }
}

module.exports = { 
  handleIncoming, 
  handleIncomingStream, 
  generateStandup, 
  generateProactiveNudge, 
  generateStaleAlert, 
  generateWeeklyReview, 
  generateTechPulse,
  autoSummarizeOldNotes,
  getEmbedding,
  // Exported for tests. Not part of the agent's runtime surface.
  executeAction,
  shouldExtractFacts,
  extractFactsFromExchange,
  extractFactsFromText,
  storeFactIfNew,
  extractFirstJSON,
  extractPartialReply,
  validateJsonSchema,
  filterKnowledge,
  selectKnowledge,
  // The live classifier prompt, so src/compare_models.js measures the real thing.
  CLASSIFIER_PROMPT,
  PREFILTER_RULES,
  COMPOUND_REQUEST,
};
