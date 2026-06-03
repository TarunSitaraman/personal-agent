const axios = require("axios");
const { getCurrentMode, getModeDescription } = require("./context");
const memory = require("./memory");
const { getOpenPRs, getRecentCommits, getOpenIssues } = require("../integrations/github");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are Blu, Tarun's personal AI agent on WhatsApp.

About Tarun:
- Intern at Hexaware (10am–6pm weekdays)
- Founder/tech lead of SmartResQ — healthcare emergency response startup (evenings)
- Learning GenAI and agentic AI actively
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

REFERENCE RESOLUTION (critical):
- When Tarun says "add that", "save that", "put that in todos", "add the thing I mentioned" — look back through conversation history, identify what "that" refers to, and use it as the content. Never ask "what should I add?" if the context is in history.
- When Tarun says "add the meeting/task/thing from earlier" — resolve it from history.

IMPLICIT CAPTURE:
- If Tarun mentions a meeting, deadline, event, or task naturally in conversation (not as a command), proactively ask "Want me to add this to your todos?" in your reply and use action NONE. Do not save without confirmation.
- If Tarun confirms with "yes", "yeah", "sure", "do it" — check history for the pending item and save it as ADD_TODO.

INTENT DETECTION:
- "todo: X", "remember to X", "add task X", "add that/this to todos" → ADD_TODO. Resolve references from history. If project context not clear, use ASK_CONTEXT.
- "note: X", "save this: X", "jot down X" → ADD_NOTE
- "learned X", "learning: X", "concept: X" → ADD_LEARNING
- "my todos", "what's pending", "all todos" → LIST_TODOS (data.context = null for all)
- "hexaware todos" → LIST_TODOS (data.context = "hexaware")
- "smartresq todos" → LIST_TODOS (data.context = "smartresq")
- "done: X", "finished X", "mark X done" → COMPLETE_TODO
- "my notes", "what did I save" → LIST_NOTES
- "my learnings", "what have I learned" → LIST_LEARNINGS
- "find X", "search for X", "did I note X" → SEARCH (data.content = search query)
- "remind me in X to Y" → SET_REMINDER (data.minutes = duration in minutes, data.content = task)
- Otherwise → NONE

CRITICAL: Always respond with ONLY a single valid JSON object. No text before or after it. The "reply" field must be a plain conversational string — never put JSON, curly braces, or code inside "reply".
{
  "reply": "formatted WhatsApp message — plain text only, no JSON",
  "action": "add_todo | ask_context | add_note | add_learning | list_todos | complete_todo | list_notes | list_learnings | search | set_reminder | none",
  "data": {
    "content": "extracted content or search query",
    "topic": "topic if learning",
    "source": "source if mentioned",
    "context": "hexaware | smartresq | learning | personal | null",
    "minutes": 0
  }
}`;

async function callGroq(messages) {
  try {
    const response = await axios.post(
      GROQ_URL,
      { model: GROQ_MODEL, messages },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
    );
    return response.data.choices[0].message.content;
  } catch (err) {
    console.error("Groq API error:", JSON.stringify(err.response?.data || err.message));
    throw err;
  }
}

async function handleIncoming(userMessage) {
  const mode = getCurrentMode();
  const modeDesc = getModeDescription(mode);

  const [history, stats, openPRs, openIssues, insights, msgCount] = await Promise.all([
    memory.getRecentHistory(30),
    memory.getSummaryStats(),
    getOpenPRs(),
    getOpenIssues(),
    memory.getRecentInsights(5),
    memory.getMessageCount(),
  ]);

  const todoBlock = [
    ...stats.hexTodos.map(t => `[hexaware] ${t.content}`),
    ...stats.srqTodos.map(t => `[smartresq] ${t.content}`),
  ];

  const insightsBlock = insights.length
    ? `Behavioural insights:\n${insights.join('\n')}`
    : '';

  const contextBlock = `Current mode: ${mode}
${modeDesc}

Pending todos (${todoBlock.length}):
${todoBlock.length ? todoBlock.join('\n') : 'none'}

Unreviewed learnings: ${stats.unreviewed.length}
Open PRs (${openPRs.length}): ${openPRs.join(', ') || 'none'}
Open Issues (${openIssues.length}): ${openIssues.join(', ') || 'none'}
${insightsBlock}`;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map(h => ({
      role: h.role === "user" ? "user" : "assistant",
      content: h.content,
    })),
    { role: "user", content: `${contextBlock}\n\nUser message: ${userMessage}` },
  ];

  const raw = await callGroq(messages);

  let parsed;
  try {
    // Extract the outermost JSON object reliably
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON found');
    parsed = JSON.parse(raw.slice(start, end + 1));

    // Ensure reply is a plain string — if model leaked JSON into reply, strip it
    if (typeof parsed.reply !== 'string') {
      parsed.reply = String(parsed.reply);
    }
    const replyJsonStart = parsed.reply.indexOf('{');
    if (replyJsonStart !== -1) {
      parsed.reply = parsed.reply.slice(0, replyJsonStart).trim();
    }
    if (!parsed.reply) parsed.reply = 'Done.';
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
        return defaultReply;

      case "add_note":
        if (data?.content) await memory.addNote(data.content, context);
        return defaultReply;

      case "add_learning":
        if (data?.topic && data?.content)
          await memory.addLearning(data.topic, data.content, data.source);
        return defaultReply;

      case "complete_todo":
        if (data?.content) await memory.completeTodoByContent(data.content);
        return defaultReply;

      case "set_reminder": {
        const minutes = parseInt(data?.minutes) || 60;
        const remindAt = new Date(Date.now() + minutes * 60 * 1000);
        if (data?.content) await memory.addReminder(data.content, remindAt);
        return defaultReply;
      }

      case "list_todos": {
        const filterCtx = data?.context || null;
        const todos = await memory.getPendingTodos(filterCtx);
        if (!todos.length) return filterCtx
          ? `No pending todos for ${filterCtx}.`
          : 'No pending todos. All clear!';

        const hex = todos.filter(t => t.context === 'hexaware');
        const srq = todos.filter(t => t.context === 'smartresq');
        const other = todos.filter(t => t.context !== 'hexaware' && t.context !== 'smartresq');

        let out = '';
        if (!filterCtx || filterCtx === 'hexaware') {
          if (hex.length) out += `*Hexaware* (${hex.length})\n${hex.map((t, i) => `${i + 1}. ${t.content}`).join('\n')}\n\n`;
        }
        if (!filterCtx || filterCtx === 'smartresq') {
          if (srq.length) out += `*SmartResQ* (${srq.length})\n${srq.map((t, i) => `${i + 1}. ${t.content}`).join('\n')}\n\n`;
        }
        if (other.length) out += `*Other* (${other.length})\n${other.map((t, i) => `${i + 1}. ${t.content}`).join('\n')}`;
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

  const raw = await callGroq([{ role: "user", content: prompt }]);
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

  const result = await callGroq([{ role: "user", content: prompt }]);
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

  return await callGroq([{ role: "user", content: prompt }]);
}

module.exports = { handleIncoming, generateStandup, generateProactiveNudge };
