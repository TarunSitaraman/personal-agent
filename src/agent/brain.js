const axios = require("axios");
const { getCurrentMode, getModeDescription, setModeOverride } = require("./context");
const memory = require("./memory");
const { getOpenPRs, getRecentCommits, getOpenIssues } = require("../integrations/github");
const { findConnections } = require("../integrations/connections");
const { webSearch } = require("../integrations/search");
const { sendButtonMessage, sendListMessage } = require("../whatsapp/send");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL       = "https://api.groq.com/openai/v1/chat/completions";

// ── Model registry ────────────────────────────────────────────────────────────
// Ordered by preference. Groq is primary — fast, reliable, already keyed.
// OpenRouter free tier has shed most of its free models as of mid-2025.
const GROQ_MODELS = [
  { id: "deepseek-r1-distill-llama-70b", quality: "reasoning" }, // chain-of-thought, best contextual understanding
  { id: "llama-3.3-70b-versatile",       quality: "high" },
  { id: "llama-3.1-8b-instant",          quality: "fast" },
];
const OR_MODELS = [
  "openrouter/owl-alpha",
  "meta-llama/llama-3.3-70b-instruct:free", // fallback
];
const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"];

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

async function getEmbedding(text) {
  try {
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    console.error('[Embedding Error]:', err.message);
    return null;
  }
}

const PROMPT_VERSION = "v1.2";

const SYSTEM_PROMPT = `You are Blu, Tarun's Hermes Agent on WhatsApp — a context-bridge and second brain across his three life modes.

## Identity
You are not a task manager or chatbot. You are Tarun's guardian of context: you notice patterns, surface what matters, and proactively connect information across his world. Be sharp and direct, not polite and verbose.

## About Tarun
- Intern at Hexaware (10am–6pm weekdays)
- Founder/tech lead of SmartResQ — healthcare emergency response startup (evenings)
- Learning GenAI and agentic AI actively
- Wants low-friction capture and proactive intelligence

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
- "switch to X mode" → SWITCH_MODE
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
- After completing a todo → mention other related pending tasks in that context if any
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

Action names: add_todo | ask_context | add_note | add_learning | learn_context | list_todos | complete_todo | list_notes | list_learnings | search | search_web | set_reminder | add_event | list_events | delete_event | update_event | switch_mode | generate_brief | undo_last | create_skill | run_skill | set_goal | complete_goal | review_learning | summarise_conversation | none

Data fields:
- content: extracted content or search query
- topic: topic if learning
- source: source if mentioned
- context: hexaware | smartresq | personal | null
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
{"reply": "Got it, I'll add groceries to your personal todo list.", "action": "add_todo", "data": {"content": "buy groceries", "context": "personal"}, "confidence": 1.0}

User: renew my parking pass
{"reply": "Did you just renew your parking pass, or should I add it as a task?", "action": "ask_context", "data": {"content": "renew parking pass"}, "confidence": 0.5}

User: no i finished it
{"reply": "Understood, marking the parking pass todo as completed.", "action": "complete_todo", "data": {"content": "renew parking pass"}, "confidence": 0.9}

User: learned that Vite uses esbuild for dev bundler
{"reply": "Awesome learning saved about Vite using esbuild.", "action": "add_learning", "data": {"topic": "Vite dev bundler", "content": "uses esbuild for dev bundling"}, "confidence": 1.0}

User: delete the client meeting tomorrow
{"reply": "Are you sure you want to delete the event 'client meeting'?", "action": "delete_event", "data": {"title": "client meeting"}, "confidence": 0.7}

User: what's pending on Hexaware?
{"reply": "Here are your open Hexaware todos.", "action": "list_todos", "data": {"context": "hexaware"}, "confidence": 1.0}

User: reviewed learning 4a3e-2b1c yes
{"reply": "Awesome, I've scheduled your next review for this topic.", "action": "review_learning", "data": {"id": "4a3e-2b1c", "gotRight": true}, "confidence": 1.0}

User: summarise our last week of conversations
{"reply": "Synthesising conversation logs for the past 7 days...", "action": "summarise_conversation", "data": {}, "confidence": 1.0}`;

// Save the system prompt version in DB automatically on load
memory.savePromptVersion(PROMPT_VERSION, SYSTEM_PROMPT).catch(err => console.error('[Prompt Versioning] Save failed:', err.message));

// ── Individual model callers ──────────────────────────────────────────────────

async function callGroqModel(modelId, messages, jsonMode) {
  const isReasoning = modelId.includes('deepseek-r1');
  const body = { model: modelId, messages, max_tokens: 2048 };
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

async function callOpenRouterModel(modelId, messages) {
  const r = await axios.post(OPENROUTER_URL, { model: modelId, messages, max_tokens: 1024 }, {
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

async function callLLM(messages, jsonMode = false) {
  const hasGroq   = !!process.env.GROQ_API_KEY;
  const hasOR     = !!process.env.OPENROUTER_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;

  // ── Round 1: Groq primary + secondary in parallel (fast, reliable) ──────
  if (hasGroq) {
    const available = GROQ_MODELS.filter(m => !isModelCoolingDown(m.id));
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
            const r = await callOpenRouterModel(id, messages);
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
    for (const modelId of GEMINI_MODELS) {
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
    GROQ_MODELS.forEach(m => modelFailCache.delete(m.id));
    try {
      return await callGroqModel(GROQ_MODELS[GROQ_MODELS.length - 1].id, messages, jsonMode);
    } catch (e) {
      console.error('[LLM] Final Groq retry failed:', e.message);
    }
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

// ── Intent pre-filter ─────────────────────────────────────────────────────────
// Handles unambiguous common commands without touching any LLM.
// Returns a reply string, or null to fall through to LLM.

// ctx: null = all contexts, 'mode' = current mode
const PREFILTER_RULES = [
  {
    match: /\b(todos?|tasks?|pending|what.*(do i have|should i do)|my list|show.*todos?)\b/i,
    action: 'list_todos', ctx: null,
  },
  {
    match: /\b(notes?|what.*(did i (save|note)|have i noted)|show.*notes?|my notes?)\b/i,
    action: 'list_notes', ctx: null,
  },
  {
    match: /\b(learnings?|what.*(did i learn|have i learned)|show.*learning|my learnings?)\b/i,
    action: 'list_learnings', ctx: null,
  },
  {
    match: /\b(events?|calendar|schedule|what.*(do i have.*today|upcoming|on my calendar))\b/i,
    action: 'list_events', ctx: null,
  },
  {
    match: /\b(what.*mode|current mode|which mode|mode.*now)\b/i,
    action: '_mode', ctx: null,
  },
  // Explicit completion — "done: X", "finished X", "done with X"
  {
    match: /^(done|finished|completed|done with|just (did|finished|completed)|marked.*done)[:\s]+(.+)/i,
    action: 'complete_todo', ctx: null,
    dataFn: (m) => ({ content: m[3].trim() }),
    reply: (data) => `Marked "${data.content}" as done.`,
  },
  // Quick note: prefix
  {
    match: /^(note|save|jot)[:\s]+(.+)/i,
    action: 'add_note', ctx: 'mode',
    dataFn: (m) => ({ content: m[2].trim() }),
    reply: (data) => `Saved as a note.`,
  },
  // Quick todo: prefix
  {
    match: /^(todo|task|remind me to|add|remember to)[:\s]+(.+)/i,
    action: 'add_todo', ctx: 'mode',
    dataFn: (m) => ({ content: m[2].trim() }),
    reply: (data) => `Added to your todos.`,
  },
];

async function tryPrefilter(userMessage, mode, replyTo) {
  const msg = userMessage.trim();
  for (const rule of PREFILTER_RULES) {
    const m = msg.match(rule.match);
    if (!m) continue;

    if (rule.action === '_mode') {
      return `Current mode: *${mode}*\n${getModeDescription(mode)}`;
    }

    const data = rule.dataFn ? rule.dataFn(m) : {};
    const ctx = rule.ctx === 'mode' ? mode : rule.ctx; // null or specific
    const defaultReply = rule.reply ? rule.reply(data) : null;
    const result = await executeAction(rule.action, { context: ctx, ...data }, mode, defaultReply, replyTo);
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
  const mode = getCurrentMode();
  const modeDesc = getModeDescription(mode);

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
          const noteId = await memory.addNote(pending.newContent, pending.context, [], embedding);
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
          const reply = await executeAction(action, data, currentMode, defaultReply, replyTo);
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
  const prefiltered = await tryPrefilter(userMessage, mode, replyTo);
  if (prefiltered !== undefined) {
    const promptLen = Math.ceil(userMessage.length / 4);
    const replyLen = prefiltered ? Math.ceil(prefiltered.length / 4) : 0;
    await memory.saveMessage('user', userMessage, PROMPT_VERSION, promptLen, 0);
    if (prefiltered !== null) await memory.saveMessage('model', prefiltered, PROMPT_VERSION, 0, replyLen);
    return prefiltered;
  }

  const msgEmbedding = await getEmbedding(userMessage);

  // GitHub calls are best-effort — don't let them block or crash the whole flow
  const [openPRs, openIssues] = await Promise.all([
    getOpenPRs().catch(() => []),
    getOpenIssues().catch(() => []),
  ]);

  const [history, stats, insights, knowledge, upcomingEvents, msgCount, contextSummary, learnedSkills] = await Promise.all([
    memory.getRecentHistory(8),
    memory.getSummaryStats(),
    memory.getRecentInsights(3),
    memory.getAllKnowledge(),
    memory.getUpcomingEvents(24),
    memory.getMessageCount(),
    memory.getContextSummary(),
    memory.getAllSkills(),
  ]);

  const semanticMatches = msgEmbedding
    ? await memory.searchMemory(userMessage, msgEmbedding, mode)
    : [];
  const semanticBlock = semanticMatches.length
    ? `Relevant past memory:\n${semanticMatches.slice(0, 5).map(r => `[${r.type}][${r.context}] ${r.content}`).join('\n')}`
    : '';

  const todoBlock = [
    ...stats.hexTodos.map(t => `[hexaware] ${t.content}`),
    ...stats.srqTodos.map(t => `[smartresq] ${t.content}`),
  ];

  const knowledgeBlock = knowledge.length
    ? `What I know about Tarun's world:\n${filterKnowledge(knowledge, userMessage).join('\n')}`
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
Current mode: ${mode}
${modeDesc}

Pending todos (${todoBlock.length}):
${todoBlock.length ? todoBlock.join('\n') : 'none'}

Unreviewed learnings: ${stats.unreviewed.length}
Open PRs (${openPRs.length}): ${openPRs.join(', ') || 'none'}
Open Issues (${openIssues.length}): ${openIssues.join(', ') || 'none'}
${eventsBlock}
${semanticBlock}
${skillsBlock}
${knowledgeBlock}
${insightsBlock}
${summaryBlock}`;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map(h => ({
      role: h.role === "user" ? "user" : "assistant",
      content: h.content.length > 600 ? h.content.slice(0, 600) + '…' : h.content,
    })),
    { role: "user", content: `${contextBlock}\n\nUser message: ${userMessage}` },
  ];

  const inputCharCount = messages.reduce((acc, msg) => acc + (msg.content?.length || 0), 0);
  const tokensInput = Math.ceil(inputCharCount / 4);

  // JSON mode forces the model to return only valid JSON
  let raw;
  try {
    raw = await callLLM(messages, true);
  } catch (err) {
    console.error('[Brain] All LLMs failed:', err.message);
    await memory.saveMessage("user", userMessage, PROMPT_VERSION, tokensInput, 0);
    // Item 4: Graceful LLM degradation
    return "I'm offline right now, I've saved your message and will process it when I'm back.";
  }

  const tokensOutput = Math.ceil(raw.length / 4);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = extractFirstJSON(raw);
  }

  // Item 18: Validate JSON schema
  if (!parsed || !validateJsonSchema(parsed)) {
    console.warn('[Brain] Malformed JSON response validation failed:', raw);
    await memory.saveMessage("user", userMessage, PROMPT_VERSION, tokensInput, 0);
    await memory.saveMessage("model", raw, PROMPT_VERSION, 0, tokensOutput);
    return "Sorry, I got confused there. Could you try again?";
  }

  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) parsed.reply = 'Done.';

  // Item 17: Confidence scoring for destructive actions
  const primaryAction = Array.isArray(parsed.actions) ? parsed.actions[0]?.action : parsed.action;
  const primaryData = Array.isArray(parsed.actions) ? parsed.actions[0]?.data : parsed.data;
  const confidence = parsed.confidence !== undefined ? parsed.confidence : 1.0;

  if (replyTo && confidence < 0.8 && ['complete_todo', 'delete_event'].includes(primaryAction)) {
    await memory.saveState(`pending_clarification:${replyTo}`, {
      type: 'destructive_action',
      data: { action: primaryAction, data: primaryData, currentMode: mode, defaultReply: parsed.reply }
    });

    let confirmationQuestion = `Are you sure you want to complete the task "${primaryData?.content || ''}"?`;
    if (primaryAction === 'delete_event') {
      confirmationQuestion = `Are you sure you want to delete the event "${primaryData?.title || ''}"?`;
    }

    await memory.saveMessage("user", userMessage, PROMPT_VERSION, tokensInput, 0);
    await memory.saveMessage("model", confirmationQuestion, PROMPT_VERSION, 0, Math.ceil(confirmationQuestion.length / 4));
    return confirmationQuestion;
  }

  let reply;
  if (Array.isArray(parsed.actions) && parsed.actions.length) {
    for (const item of parsed.actions) {
      await executeAction(item.action, item.data, mode, parsed.reply, replyTo);
    }
    reply = parsed.reply;
  } else {
    reply = await executeAction(parsed.action, parsed.data, mode, parsed.reply, replyTo);
  }

  await memory.saveMessage("user", userMessage, PROMPT_VERSION, tokensInput, 0);
  const finalModelMessage = reply || parsed.reply || "(action executed)";
  if (reply != null) await memory.saveMessage("model", finalModelMessage, PROMPT_VERSION, 0, Math.ceil(finalModelMessage.length / 4));

  // After adding a todo, offer a reminder button so the user doesn't have to ask
  if (replyTo) {
    const primaryAction = Array.isArray(parsed.actions) ? parsed.actions[0]?.action : parsed.action;
    const primaryData = Array.isArray(parsed.actions) ? parsed.actions[0]?.data : parsed.data;
    if (primaryAction === 'add_todo' && primaryData?.content) {
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
  }

  if ((msgCount + 2) % 20 === 0) {
    analyzePatterns().catch(err => console.error('Insight analysis error:', err.message));
    refreshContextSummary().catch(err => console.error('Summary refresh error:', err.message));
  }

  return reply;
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
  const mode = getCurrentMode();
  const modeDesc = getModeDescription(mode);

  const [history, stats, openPRs, openIssues, insights, knowledge, upcomingEvents, msgCount, learnedSkills] = await Promise.all([
    memory.getRecentHistory(10),
    memory.getSummaryStats(),
    getOpenPRs(),
    getOpenIssues(),
    memory.getRecentInsights(5),
    memory.getAllKnowledge(),
    memory.getUpcomingEvents(24),
    memory.getMessageCount(),
    memory.getAllSkills(),
  ]);

  const todoBlock = [
    ...stats.hexTodos.map(t => `[hexaware] ${t.content}`),
    ...stats.srqTodos.map(t => `[smartresq] ${t.content}`),
  ];

  const skillsBlock = learnedSkills.length
    ? `Available Skills (Learned):\n${learnedSkills.map(s => `- ${s.name}: ${s.description}`).join('\n')}`
    : '';

  const knowledgeBlock = knowledge.length
    ? `What I know about Tarun's world:\n${filterKnowledge(knowledge, userMessage).join('\n')}` : '';
  
  const insightsBlock = insights.length ? `Behavioural insights:\n${insights.join('\n')}` : '';
  
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
  const eventsBlock = upcomingEvents.length
    ? `Upcoming events (next 24h):\n${upcomingEvents.map(e => `- ${e.title} at ${new Date(e.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' })}`).join('\n')}` : '';

  const contextBlock = `Current time: ${now} IST
Current mode: ${mode}
${modeDesc}

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

  const reply = await executeAction(parsed.action, parsed.data, mode, parsed.reply);
  const finalModelMessage = reply || parsed.reply || "(action executed)";
  await memory.saveMessage("user", userMessage);
  await memory.saveMessage("model", finalModelMessage);

  if ((msgCount + 2) % 20 === 0) {
    analyzePatterns().catch(err => console.error('Insight analysis error:', err.message));
  }

  return reply;
}

async function executeAction(action, data, currentMode, defaultReply, replyTo = null) {
  const context = data?.context || currentMode;
  try {
    switch (action) {
      case "set_goal":
        if (data?.content) await memory.saveGoal(data.content, context);
        return defaultReply;

      case "complete_goal": {
        const goal = await memory.getPendingGoal();
        if (goal) {
          await memory.completeGoal(goal.id);
          return `Awesome work finishing the **One Big Thing**: ${goal.content}! Goal cleared.`;
        }
        return "You don't have an active 'One Big Thing' set for today.";
      }

      case "ask_context":
        await sendButtonMessage(process.env.MY_WHATSAPP_NUMBER, defaultReply, [
          { id: 'ctx_hex', title: 'Hexaware' },
          { id: 'ctx_srq', title: 'SmartResQ' },
          { id: 'ctx_per', title: 'Personal' },
        ]);
        return null;

      case "add_note":
        if (data?.content) {
          const embedding = await getEmbedding(data.content);
          const matches = embedding ? await memory.searchMemory(data.content, embedding, context) : [];
          const similarNote = matches.find(m => m.type === 'note' && m.score > 0.85);

          if (similarNote && replyTo) {
            await memory.saveState(`pending_clarification:${replyTo}`, {
              type: 'note_merge',
              data: {
                newContent: data.content,
                existingId: similarNote.id,
                existingContent: similarNote.content,
                context
              }
            });
            return `I found a similar note: "${similarNote.content}". Would you like to merge this new note with the existing one? (Reply "yes" to merge, "no" to save as separate)`;
          }

          const noteId = await memory.addNote(data.content, context, [], embedding);
          autoTagNote(noteId, data.content).catch(() => {});
          findConnections(callLLM, data.content, 'note').catch(() => {});
        }
        return defaultReply;

      case "add_todo":
        if (data?.content) {
          const embedding = await getEmbedding(data.content);
          await memory.addTodo(data.content, context, null, embedding);
        }
        return defaultReply;

      case "add_learning":
        if (data?.topic && data?.content) {
          const embedding = await getEmbedding(`${data.topic}: ${data.content}`);
          await memory.addLearning(data.topic, data.content, data.source, embedding);
          findConnections(callLLM, `${data.topic}: ${data.content}`, 'learning').catch(() => {});
        }
        return defaultReply;

      case "learn_context":
        if (data?.content) {
          const embedding = await getEmbedding(data.content);
          const contradiction = await detectContradiction(data.content, embedding);
          const knowledgeId = await memory.saveKnowledge(data.content, embedding, context);
          
          extractAndLinkEntities(data.content, knowledgeId).catch(err => console.error('[Entity Graph] Error:', err.message));

          if (contradiction) {
            return `${defaultReply}\n\n*Note:* This contradicts what I already know:\n${contradiction.replace('CONTRADICTION:', '').trim()}`;
          }
        }
        return defaultReply;

      case "complete_todo":
        if (data?.content) await memory.completeTodoByContent(data.content);
        return defaultReply;

      case "set_reminder": {
        if (!data?.content) return defaultReply;
        const remindAt = data?.datetime
          ? new Date(data.datetime)
          : new Date(Date.now() + (parseInt(data?.minutes) || 60) * 60 * 1000);
        const embedding = await getEmbedding(data.content);
        await memory.addTodo(data.content, context, remindAt, embedding);
        return defaultReply;
      }

      case "add_event": {
        if (data?.title && data?.datetime) {
          const startAt = new Date(data.datetime);
          const duration = parseInt(data?.duration) || 60;
          const endAt = new Date(startAt.getTime() + duration * 60 * 1000);
          const recurrence = ['none', 'daily', 'weekdays', 'weekly'].includes(data?.recurrence)
            ? data.recurrence : 'none';
          await memory.addEvent(data.title, startAt, endAt, context, recurrence);
        }
        return defaultReply;
      }

      case "list_events": {
        const events = await memory.listEvents(data?.context || null, 10);
        if (!events.length) return 'Nothing on your calendar yet.';
        const fmtEvent = ev => {
          const timeStr = new Date(ev.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
          const rec = ev.recurrence !== 'none' ? ` _(${ev.recurrence})_` : '';
          return `${ev.title} — ${timeStr}${rec}`;
        };
        return `*Calendar* (${events.length})\n\n` + events.map((ev, i) => `${i + 1}. ${fmtEvent(ev)}`).join('\n');
      }

      case "delete_event": {
        if (!data?.title) return defaultReply;
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
        if (!data?.title) return defaultReply;
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
        return defaultReply;
      }

      case "list_todos": {
        const VALID_CONTEXTS = ['hexaware', 'smartresq', 'personal'];
        const filterCtx = VALID_CONTEXTS.includes(data?.context) ? data.context : null;
        const todos = await memory.getPendingTodos(filterCtx);
        if (!todos.length) return filterCtx
          ? `No pending todos for ${filterCtx}.`
          : 'No pending todos. All clear!';

        const hex = todos.filter(t => t.context === 'hexaware');
        const srq = todos.filter(t => t.context === 'smartresq');
        const other = todos.filter(t => t.context !== 'hexaware' && t.context !== 'smartresq');

        // On WhatsApp, send a tappable list so items can be completed in one tap
        if (replyTo) {
          const sections = [];
          if (hex.length) sections.push({
            title: 'Hexaware',
            rows: hex.map(t => ({ id: `ltdone_${t.id}`, title: t.content.slice(0, 24), description: 'Tap to mark done' })),
          });
          if (srq.length) sections.push({
            title: 'SmartResQ',
            rows: srq.map(t => ({ id: `ltdone_${t.id}`, title: t.content.slice(0, 24), description: 'Tap to mark done' })),
          });
          if (other.length) sections.push({
            title: 'Personal',
            rows: other.map(t => ({ id: `ltdone_${t.id}`, title: t.content.slice(0, 24), description: 'Tap to mark done' })),
          });
          await sendListMessage(replyTo, `You have ${todos.length} open todo${todos.length === 1 ? '' : 's'}.`, 'See todos', sections);
          return null; // interactive message sent directly, no text reply needed
        }

        const fmt = t => {
          const reminder = t.remind_at
            ? ` _(reminder: ${new Date(t.remind_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })})_`
            : '';
          return `${t.content}${reminder}`;
        };

        let out = '';
        if (!filterCtx || filterCtx === 'hexaware') {
          if (hex.length) out += `*Hexaware* (${hex.length})\n${hex.map((t, i) => `${i + 1}. ${fmt(t)}`).join('\n')}\n\n`;
        }
        if (!filterCtx || filterCtx === 'smartresq') {
          if (srq.length) out += `*SmartResQ* (${srq.length})\n${srq.map((t, i) => `${i + 1}. ${fmt(t)}`).join('\n')}\n\n`;
        }
        if (other.length) out += `*Personal* (${other.length})\n${other.map((t, i) => `${i + 1}. ${fmt(t)}`).join('\n')}`;
        return out.trim();
      }

      case "list_notes": {
        const notes = await memory.getRecentNotes(data?.context || null, 8);
        if (!notes.length) return 'No notes saved yet.';
        return `*Recent Notes* (${notes.length})\n\n` +
          notes.map((n, i) => `${i + 1}. [${n.context}] ${n.content}`).join('\n');
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
          results.map((r, i) => `${i + 1}. [${r.type}][${r.context}] ${r.content}`).join('\n');
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
        return defaultReply;
      }

      case "generate_brief": {
        const briefType = data?.type;
        if (briefType === 'both') {
          const [hex, srq] = await Promise.all([generateStandup('hexaware'), generateStandup('smartresq')]);
          return hex + '\n\n---\n\n' + srq;
        }
        const type = briefType === 'smartresq' ? 'smartresq' : 'hexaware';
        return await generateStandup(type);
      }

      case "switch_mode": {
        const newMode = data?.mode;
        if (newMode && ['hexaware', 'smartresq', 'personal'].includes(newMode)) {
          await setModeOverride(newMode);
        }
        return defaultReply;
      }

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
    return defaultReply;
  }
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
Stats: ${stats.hexTodos.length} Hexaware todos, ${stats.srqTodos.length} SmartResQ todos, ${stats.unreviewed.length} unreviewed learnings

Return ONLY a JSON array: ["insight 1", "insight 2"]`;

  const raw = await callLLM([{ role: "user", content: prompt }]);
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
- Stats: ${stats.hexTodos.length} Hexaware, ${stats.srqTodos.length} SmartResQ tasks pending.

If nothing truly valuable to say, reply SKIP.
Tone: Guardian-like, efficiency-obsessed, direct. Under 5 lines. No markdown except *bold*.`;

  const result = await callLLM([{ role: "user", content: prompt }]);
  return result.trim() === 'SKIP' ? null : result;
}

async function generateStandup(type) {
  const [stats, openPRs, recentCommits] = await Promise.all([
    memory.getSummaryStats(),
    getOpenPRs(),
    getRecentCommits(),
  ]);

  let prompt;
  if (type === 'hexaware') {
    const yesterday = await memory.getYesterdayActivity('hexaware');
    prompt = `You are Blu, Tarun's Hermes Agent. Generate a concise morning "Bridge Brief" for his Hexaware day.

Structure:
1. *Morning Pivot*: Summarize yesterday's key Hexaware wins and notes.
2. *On the Horizon*: List today's pending Hexaware tasks.
3. *Mental Space*: Mention any blockers or recurring themes from notes.

Data:
- Completed yesterday: ${yesterday.completed.map(t => t.content).join(', ') || 'none'}
- Notes from yesterday: ${yesterday.notes.map(n => n.content).join(', ') || 'none'}
- Today's tasks: ${stats.hexTodos.map(t => t.content).join(', ') || 'none'}

Tone: Direct, professional, guardian-like. Plain text, no markdown except *bold*. Under 8 lines.`;
  } else {
    const yesterdayHex = await memory.getYesterdayActivity('hexaware');
    const yesterdaySrq = await memory.getYesterdayActivity('smartresq');
    
    prompt = `You are Blu, Tarun's Hermes Agent. It's transition time: Hexaware is done, SmartResQ begins.

Structure:
1. *Hexaware Wrap*: A 1-sentence summary of his wins at Hexaware today.
2. *SmartResQ Pulse*: Key open todos and PRs needing attention.
3. *The Hermes Question*: Ask Tarun: "What's the *One Big Thing* you want to move forward for SmartResQ tonight?"

Data:
- Today's Hexaware Wins: ${yesterdayHex.completed.map(t => t.content).join(', ') || 'none'}
- SmartResQ Todos: ${stats.srqTodos.map(t => t.content).join(', ') || 'none'}
- Open PRs: ${openPRs.join(', ') || 'none'}
- Recent Commits: ${recentCommits.slice(0, 3).join(', ') || 'none'}

Tone: Transition-aware, motivating, conceptual. Plain text, no markdown except *bold*. Under 8 lines.`;
  }

  return await callLLM([{ role: "user", content: prompt }]);
}

async function autoTagNote(noteId, content) {
  const raw = await callLLM([{
    role: 'user',
    content: `Extract 3-5 short keyword tags from this note. Return ONLY a JSON array of lowercase strings.\nNote: "${content}"\nExample output: ["tag1", "tag2", "tag3"]`,
  }]);
  try {
    const match = raw.match(/\[[\s\S]*?\]/);
    const tags = JSON.parse(match[0]);
    if (Array.isArray(tags)) await memory.updateNoteTags(noteId, tags);
  } catch { /* skip silently */ }
}

async function generateStaleAlert() {
  const stale = await memory.getStaleTodos(5);
  if (!stale.length) return null;

  const hex = stale.filter(t => t.context === 'hexaware');
  const srq = stale.filter(t => t.context === 'smartresq');
  const other = stale.filter(t => t.context !== 'hexaware' && t.context !== 'smartresq');

  let msg = `Heads up — ${stale.length} todo${stale.length > 1 ? 's have' : ' has'} been sitting for 5+ days:\n\n`;
  if (hex.length) msg += `*Hexaware*\n${hex.map((t, i) => `${i + 1}. ${t.content}`).join('\n')}\n\n`;
  if (srq.length) msg += `*SmartResQ*\n${srq.map((t, i) => `${i + 1}. ${t.content}`).join('\n')}\n\n`;
  if (other.length) msg += `*Other*\n${other.map((t, i) => `${i + 1}. ${t.content}`).join('\n')}\n\n`;
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

  return await callLLM([{ role: 'user', content: prompt }]);
}

async function generateTechPulse() {
  if (!process.env.SERPER_API_KEY) return null;

  // 1. Fetch interests from permanent knowledge
  const knowledge = await memory.getAllKnowledge();
  const interestPrompt = `Based on these facts about Tarun, extract a list of 3-5 specific tech interests or people he follows on X/Twitter. 
Knowledge:
${knowledge.join('\n')}

Return ONLY a comma-separated list of keywords. If nothing found, return "AI Agents, GenAI, Web Dev".`;
  
  const interests = await callLLM([{ role: 'user', content: interestPrompt }]);
  
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

  return await callLLM([{ role: 'user', content: synthesisPrompt }]);
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
    const raw = await callLLM([{ role: 'user', content: prompt }], true);
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
        
        const summaryFact = await callLLM([{ role: 'user', content: prompt }]);
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
  autoSummarizeOldNotes
};
