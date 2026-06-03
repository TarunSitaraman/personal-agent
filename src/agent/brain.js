const axios = require("axios");
const { getCurrentMode, getModeDescription, setModeOverride } = require("./context");
const memory = require("./memory");
const { getOpenPRs, getRecentCommits, getOpenIssues } = require("../integrations/github");
const { findConnections } = require("../integrations/connections");
const { webSearch } = require("../integrations/search");
const { sendButtonMessage } = require("../whatsapp/send");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const MODEL_CHAIN = [
  "meta-llama/llama-3.3-70b-instruct",
  "qwen/qwen-2.5-72b-instruct",
  "google/gemini-2.0-flash-001",
  "nvidia/llama-3.1-nemotron-70b-instruct",
];

const SYSTEM_PROMPT = `You are Blu, Tarun's personal AI agent on WhatsApp.

About Tarun:
- Intern at Hexaware (10am–6pm weekdays)
- Founder/tech lead of SmartResQ — healthcare emergency response startup (evenings)
- Wants low-friction capture and proactive intelligence

CRITICAL DATA RULES:
- Only report data present in the context block. Never invent numbers or items.
- You do NOT have access to calendars or emails.

PROACTIVE BEHAVIOUR:
- If insights reveal a pattern worth flagging, mention it naturally — one observation max, only when relevant.

FORMATTING RULES (critical — WhatsApp messages must be readable):
- Use *bold* for section headers
- Use numbered lists for todos, notes, learnings (1. 2. 3.)
- Each item on its own line
- Separate sections with a blank line
- Keep replies concise — no long paragraphs
- Never use markdown (##, **, -, etc) except WhatsApp-native (*bold*, _italic_)

DISTINGUISHING NOTES FROM CONTEXT TEACHING (critical):
- If Tarun tells you a FACT about his world — who someone is, a relationship, a recurring event, background info ("Prashant sir is my SmartResQ mentor", "standup is at 8am", "BIZ-4 is a Hexaware ticket") — this is CONTEXT TEACHING. Store it as a personal knowledge insight using LEARN_CONTEXT. Do NOT save as a note or todo. Acknowledge naturally: "Got it, I'll remember that."
- A NOTE is something Tarun explicitly wants to capture for later reference ("note: the auth flow works like X", "save this: new API endpoint is Y").
- A TODO is a task to be done.
- When in doubt between context teaching vs note: if Tarun is describing his world to you, it's context. If he's capturing something to refer back to, it's a note.

REFERENCE RESOLUTION (critical):
- When Tarun says "add that", "save that", "put that in todos", "add the thing I mentioned" — look back through conversation history, identify what "that" refers to, and use it as the content. Never ask "what should I add?" if the context is in history.
- When Tarun says "add the meeting/task/thing from earlier" — resolve it from history.

IMPLICIT CAPTURE:
- If Tarun mentions a meeting, deadline, event, or task naturally in conversation (not as a command), proactively ask "Want me to add this to your todos?" in your reply and use action NONE. Do not save without confirmation.
- If Tarun confirms with "yes", "yeah", "sure", "do it" — check history for the pending item and save it as ADD_TODO.

INTENT DETECTION:
- "todo: X", "remember to X", "add task X", "add that/this to todos" → ADD_TODO. Resolve references from history. If project context not clear, use ASK_CONTEXT.
- "note: X", "save this: X", "jot down X" → ADD_NOTE
- Tarun describing people, relationships, facts about his world → LEARN_CONTEXT (data.content = the fact)
- "learned X", "learning: X", "concept: X" → ADD_LEARNING
- Any request to see todos — "my todos", "what's pending", "all todos", "show me everything", "can I get all of them" (referring to todos), "list tasks" → LIST_TODOS. data.context = null means ALL todos across all contexts. NEVER set data.context to "all" or any string other than "hexaware", "smartresq", "personal", or null.
- "hexaware todos" or request scoped to hexaware work → LIST_TODOS (data.context = "hexaware")
- "smartresq todos" or request scoped to smartresq work → LIST_TODOS (data.context = "smartresq")
- CRITICAL: Never generate a todo list yourself in the reply field. Always use LIST_TODOS action — the system handles formatting.
- "done: X", "finished X", "mark X done" → COMPLETE_TODO
- "my notes", "what did I save" → LIST_NOTES
- "my learnings", "what have I learned" → LIST_LEARNINGS
- "find X", "search for X", "did I note X", "what did I save about X" → SEARCH (data.content = search query — searches Tarun's own notes/todos/learnings only)
- Factual question about the external world → SEARCH_WEB only if ALL of these are true: (1) the answer requires live/current data (today's price, live score, current weather, breaking news) OR you are genuinely uncertain, AND (2) the answer is NOT already in the knowledge block above. If you already know it confidently — use NONE and answer directly. Never search for programming concepts, history, definitions, or anything stable you're sure about.
- When using SEARCH_WEB: set data.cache = true and data.fact = "one concise sentence summary" if the result is a STABLE fact worth remembering. Set data.cache = false for live/changing data (prices, scores, news, weather).
- "remind me in X to Y" → SET_REMINDER (data.minutes = duration in minutes, data.content = task)
- Tarun mentions a meeting, call, session, interview with a specific time → ADD_EVENT (data.title = event name, data.datetime = ISO datetime string in IST, data.duration = minutes default 60, data.recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' — detect from phrasing: "every weekday" → 'weekdays', "daily" → 'daily', "every week"/"weekly" → 'weekly', one-off → 'none')
- "my events", "what's on my calendar", "show events", "what do I have [this week/today]" → LIST_EVENTS (data.context = filter or null)
- "cancel X", "remove X from calendar", "delete the X event/meeting" → DELETE_EVENT (data.title = event name to match)
- "reschedule X to Y", "move X meeting to Y time", "change X to Yam" → UPDATE_EVENT (data.title = event to find, data.datetime = new ISO datetime if time changed, data.duration = new duration if changed, data.new_title = new name if renamed)
- Tarun signals a shift in where he is or what he's doing with his day — leaving work, arriving at office, winding down, heading out, going to sleep, starting a new work context — infer the appropriate mode from context and trigger SWITCH_MODE (data.mode = 'hexaware' | 'smartresq' | 'personal'). Do not require specific phrases. Reason: if he's heading to office → hexaware, leaving office or done for the day → smartresq, winding down/sleeping → personal. Override lasts until midnight.
- Otherwise → NONE

CRITICAL: Always respond with ONLY a single valid JSON object. No text before or after it. The "reply" field must be a plain conversational string — never put JSON, curly braces, or code inside "reply".
{
  "reply": "formatted WhatsApp message — plain text only, no JSON",
  "action": "add_todo | ask_context | add_note | add_learning | learn_context | list_todos | complete_todo | list_notes | list_learnings | search | search_web | set_reminder | add_event | list_events | delete_event | update_event | switch_mode | none",
  "data": {
    "content": "extracted content or search query",
    "topic": "topic if learning",
    "source": "source if mentioned",
    "context": "hexaware | smartresq | personal | null",
    "minutes": 0,
    "title": "event title if add/delete/update_event",
    "datetime": "ISO datetime string in IST if add/update_event",
    "duration": 60,
    "recurrence": "none | daily | weekdays | weekly",
    "new_title": "new event name if renaming via update_event",
    "cache": false,
    "fact": "concise one-line fact to save if cache=true"
  }
}

WHEN UNSURE: If you are uncertain about any detail — context, time, what to save, what was meant — always ask a clarifying question instead of guessing. A wrong action is worse than a clarifying question.`;

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
      if (status === 429 || status === 503 || status === 502 || status === 500) {
        console.warn(`[LLM] ${model} unavailable (${status}), trying next model...`);
        lastErr = err;
        continue;
      }
      console.error(`[LLM] ${model} error:`, JSON.stringify(err.response?.data || err.message));
      throw err;
    }
  }
  console.error('[LLM] All models exhausted');
  throw lastErr;
}

async function handleIncoming(userMessage) {
  const mode = getCurrentMode();
  const modeDesc = getModeDescription(mode);

  const [history, stats, openPRs, openIssues, insights, knowledge, upcomingEvents, msgCount] = await Promise.all([
    memory.getRecentHistory(30),
    memory.getSummaryStats(),
    getOpenPRs(),
    getOpenIssues(),
    memory.getRecentInsights(5),
    memory.getAllKnowledge(),
    memory.getUpcomingEvents(24),
    memory.getMessageCount(),
  ]);

  const todoBlock = [
    ...stats.hexTodos.map(t => `[hexaware] ${t.content}`),
    ...stats.srqTodos.map(t => `[smartresq] ${t.content}`),
  ];

  const knowledgeBlock = knowledge.length
    ? `What I know about Tarun's world:\n${knowledge.join('\n')}`
    : '';

  const insightsBlock = insights.length
    ? `Behavioural insights:\n${insights.join('\n')}`
    : '';

  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
  const eventsBlock = upcomingEvents.length
    ? `Upcoming events (next 24h):\n${upcomingEvents.map(e => `- ${e.title} at ${new Date(e.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' })}`).join('\n')}`
    : '';

  const contextBlock = `Current time: ${now} IST
Current mode: ${mode}
${modeDesc}

Pending todos (${todoBlock.length}):
${todoBlock.length ? todoBlock.join('\n') : 'none'}

Unreviewed learnings: ${stats.unreviewed.length}
Open PRs (${openPRs.length}): ${openPRs.join(', ') || 'none'}
Open Issues (${openIssues.length}): ${openIssues.join(', ') || 'none'}
${eventsBlock}
${knowledgeBlock}
${insightsBlock}`;

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
    if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) parsed.reply = 'Done.';
  } catch {
    await memory.saveMessage("user", userMessage);
    await memory.saveMessage("model", raw);
    return raw;
  }

  const reply = await executeAction(parsed.action, parsed.data, mode, parsed.reply);
  await memory.saveMessage("user", userMessage);
  await memory.saveMessage("model", reply);

  if ((msgCount + 2) % 20 === 0) {
    analyzePatterns().catch(err => console.error('Insight analysis error:', err.message));
  }

  return reply;
}

async function executeAction(action, data, currentMode, defaultReply) {
  const context = data?.context || currentMode;
  try {
    switch (action) {
      case "add_todo":
        if (data?.content) await memory.addTodo(data.content, context);
        return defaultReply;

      case "ask_context":
        await sendButtonMessage(process.env.MY_WHATSAPP_NUMBER, defaultReply, [
          { id: 'ctx_hex', title: 'Hexaware' },
          { id: 'ctx_srq', title: 'SmartResQ' },
          { id: 'ctx_per', title: 'Personal' },
        ]);
        return null;

      case "add_note":
        if (data?.content) {
          const noteId = await memory.addNote(data.content, context);
          autoTagNote(noteId, data.content).catch(() => {});
          findConnections(callLLM, data.content, 'note').catch(() => {});
        }
        return defaultReply;

      case "add_learning":
        if (data?.topic && data?.content) {
          await memory.addLearning(data.topic, data.content, data.source);
          findConnections(callLLM, `${data.topic}: ${data.content}`, 'learning').catch(() => {});
        }
        return defaultReply;

      case "learn_context":
        if (data?.content) await memory.saveKnowledge(data.content);
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
        const results = await memory.searchMemory(query);
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

      case "switch_mode": {
        const newMode = data?.mode;
        if (newMode && ['hexaware', 'smartresq', 'personal'].includes(newMode)) {
          await setModeOverride(newMode);
        }
        return defaultReply;
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
  const [stats, insights, openPRs] = await Promise.all([
    memory.getSummaryStats(),
    memory.getRecentInsights(5),
    getOpenPRs(),
  ]);
  const prompt = `You are Blu, Tarun's AI agent. Based on the data, decide if there's something worth proactively telling Tarun. Be specific. If nothing genuinely worth saying, reply SKIP.

Hexaware todos: ${stats.hexTodos.map(t => t.content).join(', ') || 'none'}
SmartResQ todos: ${stats.srqTodos.map(t => t.content).join(', ') || 'none'}
Unreviewed learnings: ${stats.unreviewed.length}
Open PRs: ${openPRs.join(', ') || 'none'}
Insights: ${insights.join(', ') || 'none'}

Plain text. Under 4 lines. No markdown.`;

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
    prompt = `Generate Tarun's Hexaware standup in plain text. Format exactly like this:

*Hexaware Standup*

Yesterday:
[list what was done — use completed todos and notes]

Today:
[list pending hexaware todos]

Blockers:
[mention any if evident from notes, else say None]

Data:
Completed yesterday: ${yesterday.completed.map(t => t.content).join(', ') || 'none'}
Notes from yesterday: ${yesterday.notes.map(n => n.content).join(', ') || 'none'}
Today's todos: ${stats.hexTodos.map(t => t.content).join(', ') || 'none'}

Keep each section to 1-3 bullet points. Plain text, no markdown except *bold* headers.`;
  } else {
    const yesterday = await memory.getYesterdayActivity('smartresq');
    prompt = `Generate Tarun's SmartResQ standup in plain text. Format exactly like this:

*SmartResQ Standup*

Shipped / worked on:
[recent completed todos + commits]

In progress:
[current open todos]

PRs needing attention:
[list open PRs]

Data:
Completed recently: ${yesterday.completed.map(t => t.content).join(', ') || 'none'}
Open todos: ${stats.srqTodos.map(t => t.content).join(', ') || 'none'}
Open PRs: ${openPRs.join(', ') || 'none'}
Recent commits: ${recentCommits.slice(0, 3).join(', ') || 'none'}

Keep each section to 1-3 bullet points. Plain text, no markdown except *bold* headers.`;
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

module.exports = { handleIncoming, generateStandup, generateProactiveNudge, generateStaleAlert, generateWeeklyReview };
