const axios = require("axios");
const { getCurrentMode, getModeDescription, setModeOverride } = require("./context");
const memory = require("./memory");
const { getOpenPRs, getRecentCommits, getOpenIssues } = require("../integrations/github");
const { findConnections } = require("../integrations/connections");
const { webSearch } = require("../integrations/search");
const { sendButtonMessage } = require("../whatsapp/send");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const MODEL_CHAIN = [
  "openrouter/free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "meta-llama/llama-3.3-70b-instruct:free"
];

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

const SYSTEM_PROMPT = `You are Blu, Tarun's personal AI agent on WhatsApp — an evolved "Hermes Agent" who acts as a knowledgeable messenger and context-bridge between his life modes.

About Tarun:
- Intern at Hexaware (10am–6pm weekdays)
- Founder/tech lead of SmartResQ — healthcare emergency response startup (evenings)
- Learning GenAI and agentic AI actively
- Wants low-friction capture and proactive intelligence

CORE IDENTITY:
- You are not just a bot; you are a guardian of Tarun's context. 
- You bridge the gap between his morning (Hexaware) and evening (SmartResQ).
- You proactively learn the "who, what, where" of his world.

[TOOLBOX]
You have a dynamic toolbox of skills. Always check the available skills in the context block before acting.
- Hardcoded skills: add_todo, add_note, learn_context, add_learning, search, search_web, add_event, etc.
- Learned skills: (See the "Available Skills" section in context).

PROACTIVE BEHAVIOUR:
- RECURSIVE LEARNING: If Tarun mentions a new person, tool, or project entity for the first time, save it using LEARN_CONTEXT.
- SKILL ACQUISITION: If Tarun asks you to "be able to" do something new or "learn" a new ability, use CREATE_SKILL.

FORMATTING RULES:
- Use *bold* for headers, numbered lists for items. Use plain text only.

INTENT DETECTION:
- "todo: X", "remember to X" → ADD_TODO
- Past-tense completion ("renewed X", "finished X", "did X", "submitted X", "sent X", "fixed X", "completed X", "done with X") → COMPLETE_TODO (data.content = the thing completed). CRITICAL: past tense = task already done, NOT a new todo to add.
- "the one big thing is X", "my main focus is X", "goal: X" → SET_GOAL
- "goal done", "finished the big thing" → COMPLETE_GOAL
- "note: X", "save this: X" → ADD_NOTE
- Facts about the world/people → LEARN_CONTEXT
- "learned X", "learning: X" → ADD_LEARNING
- "find X", "search for X" → SEARCH
- Factual external world question → SEARCH_WEB
- Mentions of specific time/date → ADD_EVENT
- "learn a new skill: [name] - [description]" → CREATE_SKILL
- Tarun wants to use a "learned skill" (one not in the hardcoded list but in the "Available Skills" section) → RUN_SKILL (data.skill_name = the skill name).
- Otherwise → NONE

CORRECTION HANDLING:
- If Tarun says "no" or "no i completed it" or "no that was done" after you added something as a todo, he means you misclassified it. Look at his PREVIOUS message to identify what "it" refers to, and issue COMPLETE_TODO for that item instead. Do NOT default to the most recent completed item from history.

CRITICAL: Always respond with ONLY a single valid JSON object.
{
  "reply": "your conversation here",
  "action": "add_todo | ask_context | add_note | add_learning | learn_context | list_todos | complete_todo | list_notes | list_learnings | search | search_web | set_reminder | add_event | list_events | delete_event | update_event | switch_mode | generate_brief | undo_last | create_skill | run_skill | none",
  "data": {
    "content": "extracted content or search query",
    "topic": "topic if learning",
    "source": "source if mentioned",
    "context": "hexaware | smartresq | personal | null",
    "minutes": 0,
    "title": "event title",
    "datetime": "ISO datetime string in IST",
    "duration": 60,
    "recurrence": "none | daily | weekdays | weekly",
    "new_title": "new event name",
    "cache": false,
    "fact": "concise fact to save if cache=true",
    "skill_name": "name of skill to create/run",
    "skill_desc": "description of skill to create",
    "skill_instr": "detailed prompt/steps for the skill"
  }
}

WHEN UNSURE: Ask a clarifying question.`;

async function callLLMStream(messages, onToken) {
  let lastErr;
  for (const model of MODEL_CHAIN) {
    try {
      const response = await axios.post(
        OPENROUTER_URL,
        { model, messages, stream: true },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': process.env.RENDER_EXTERNAL_URL || 'https://personal-agent',
            'X-Title': 'Personal Agent',
          },
          responseType: 'stream',
          timeout: 60000,
        }
      );
      return await new Promise((resolve, reject) => {
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
    } catch (err) {
      console.warn(`[LLM stream] ${model} failed (${err.response?.status || err.message}), trying next...`);
      lastErr = new Error(`OpenRouter Stream Error (${err.response?.status}): ${model} - ${err.message}`);
    }
  }
  throw lastErr || new Error('All models failed');
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

async function callLLM(messages, jsonMode = false) {
  let lastErr;
  for (const model of MODEL_CHAIN) {
    try {
      const body = { model, messages };
      if (jsonMode) body.response_format = { type: 'json_object' };
      const response = await axios.post(
        OPENROUTER_URL,
        body,
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': process.env.RENDER_EXTERNAL_URL || 'https://personal-agent',
            'X-Title': 'Personal Agent',
          },
        }
      );
      const content = response.data.choices[0].message.content;
      if (content) return content;
    } catch (err) {
      const status = err.response?.status;
      console.warn(`[LLM] ${model} failed (${status || err.code || err.message}), trying next...`);
      lastErr = err;
      continue;
    }
  }
  console.error('[LLM] All models exhausted');
  throw lastErr;
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

async function handleIncoming(userMessage) {
  const mode = getCurrentMode();
  const modeDesc = getModeDescription(mode);

  const [history, stats, openPRs, openIssues, insights, knowledge, upcomingEvents, msgCount, contextSummary, learnedSkills] = await Promise.all([
    memory.getRecentHistory(10),
    memory.getSummaryStats(),
    getOpenPRs(),
    getOpenIssues(),
    memory.getRecentInsights(5),
    memory.getAllKnowledge(),
    memory.getUpcomingEvents(24),
    memory.getMessageCount(),
    memory.getContextSummary(),
    memory.getAllSkills(),
  ]);

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
${skillsBlock}
${knowledgeBlock}
${insightsBlock}
${summaryBlock}`;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map(h => ({
      role: h.role === "user" ? "user" : "assistant",
      content: h.content,
    })),
    { role: "user", content: `${contextBlock}\n\nUser message: ${userMessage}` },
  ];

  // JSON mode forces the model to return only valid JSON — no leakage possible
  const raw = await callLLM(messages, true);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = extractFirstJSON(raw);
  }

  if (!parsed) {
    await memory.saveMessage("user", userMessage);
    await memory.saveMessage("model", raw);
    return "Sorry, I got confused there. Could you try again?";
  }

  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) parsed.reply = 'Done.';

  const reply = await executeAction(parsed.action, parsed.data, mode, parsed.reply);
  await memory.saveMessage("user", userMessage);
  await memory.saveMessage("model", reply);

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

async function executeAction(action, data, currentMode, defaultReply) {
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
          const noteId = await memory.addNote(data.content, context, [], embedding);
          autoTagNote(noteId, data.content).catch(() => {});
          findConnections(callLLM, data.content, 'note').catch(() => {});
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
          await memory.saveKnowledge(data.content, embedding, context);
        }
        return defaultReply;

      case "complete_todo":
        if (data?.content) await memory.completeTodoByContent(data.content);
        return defaultReply;

      case "set_reminder": {
        const minutes = parseInt(data?.minutes) || 60;
        const remindAt = new Date(Date.now() + minutes * 60 * 1000);
        if (data?.content) await memory.addTodo(data.content, context, remindAt);
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
        const learnings = await memory.getUnreviewedLearnings(8);
        if (!learnings.length) return 'No unreviewed learnings. You\'re all caught up!';
        return `*Unreviewed Learnings* (${learnings.length})\n\n` +
          learnings.map((l, i) => `${i + 1}. *${l.topic}*\n   ${l.content}`).join('\n\n');
      }

      case "search": {
        const query = data?.content;
        if (!query) return 'What should I search for?';
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

module.exports = { handleIncoming, handleIncomingStream, generateStandup, generateProactiveNudge, generateStaleAlert, generateWeeklyReview, generateTechPulse };
