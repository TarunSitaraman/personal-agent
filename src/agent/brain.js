const axios = require("axios");
const { getCurrentMode, getModeDescription } = require("./context");
const memory = require("./memory");
const { getOpenPRs, getRecentCommits, getOpenIssues } = require("../integrations/github");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are Blu, Tarun's personal AI agent accessible via WhatsApp.

About Tarun:
- Intern at Hexaware (10am–6pm weekdays)
- Founder/tech lead of SmartResQ — a healthcare emergency response startup (works evenings)
- Learning GenAI and agentic AI actively
- Wants low-friction capture and proactive intelligence

CRITICAL DATA RULES:
- You only know what is in the context block (todos, notes, learnings, GitHub PR/issue data, and insights)
- You do NOT have access to calendars or emails
- NEVER make up numbers or data not in the context block

PROACTIVE BEHAVIOUR:
- If insights reveal a pattern worth flagging, mention it naturally in your reply
- If todos are piling up in one context, gently surface it
- If learnings haven't been reviewed in a while, nudge Tarun
- Keep it conversational — one proactive observation max per reply, only when relevant

Intent detection rules:
- "remember to X", "todo: X", "add task X" → ADD_TODO
- "note: X", "save this: X", "jot down X" → ADD_NOTE
- "learned X", "learning: X", "concept: X" → ADD_LEARNING
- "what's pending", "my todos", "what do I have" → LIST_TODOS
- "done: X", "completed X", "finished X", "mark X done" → COMPLETE_TODO
- "my notes", "what did I save" → LIST_NOTES
- "my learnings", "what have I learned" → LIST_LEARNINGS
- "remind me in X to Y", "set a reminder" → SET_REMINDER (extract duration in minutes as data.minutes, task as data.content)
- Otherwise → NONE

CRITICAL: Always respond with valid JSON in this exact format:
{
  "reply": "your natural WhatsApp message here",
  "action": "add_todo | add_note | add_learning | list_todos | complete_todo | list_notes | list_learnings | set_reminder | none",
  "data": {
    "content": "extracted content",
    "topic": "topic if learning",
    "source": "source if mentioned",
    "context": "hexaware | smartresq | learning | personal",
    "minutes": 0
  }
}

Keep replies short. Use line breaks. No markdown. Plain text only.`;

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
    memory.getRecentHistory(20),
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
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    await memory.saveMessage("user", userMessage);
    await memory.saveMessage("model", raw);
    return raw;
  }

  await executeAction(parsed.action, parsed.data, mode);
  await memory.saveMessage("user", userMessage);
  await memory.saveMessage("model", parsed.reply);

  // Run insight analysis every 20 messages
  if ((msgCount + 2) % 20 === 0) {
    analyzePatterns().catch(err => console.error('Insight analysis error:', err.message));
  }

  return parsed.reply;
}

async function executeAction(action, data, currentMode) {
  const context = data?.context || currentMode;
  try {
    switch (action) {
      case "add_todo":
        if (data?.content) await memory.addTodo(data.content, context);
        break;
      case "add_note":
        if (data?.content) await memory.addNote(data.content, context);
        break;
      case "add_learning":
        if (data?.topic && data?.content)
          await memory.addLearning(data.topic, data.content, data.source);
        break;
      case "complete_todo":
        if (data?.content) await memory.completeTodoByContent(data.content);
        break;
      case "set_reminder": {
        const minutes = parseInt(data?.minutes) || 60;
        const remindAt = new Date(Date.now() + minutes * 60 * 1000);
        if (data?.content) await memory.addReminder(data.content, remindAt);
        break;
      }
    }
  } catch (err) {
    console.error("Action execution error:", action, err.message);
  }
}

async function analyzePatterns() {
  const [history, stats] = await Promise.all([
    memory.getRecentHistory(40),
    memory.getSummaryStats(),
  ]);

  const historyText = history.map(h => `${h.role}: ${h.content}`).join('\n');

  const prompt = `Analyze this conversation history and usage data for Tarun's personal AI agent.
Extract 2-3 short, specific behavioural insights about his patterns, habits, or tendencies.
Focus on: what he captures most, when he's most active, what he forgets, what context he works in.

Conversation history:
${historyText}

Stats: ${stats.hexTodos.length} Hexaware todos, ${stats.srqTodos.length} SmartResQ todos, ${stats.unreviewed.length} unreviewed learnings

Return ONLY a JSON array of insight strings, e.g.:
["insight 1", "insight 2", "insight 3"]`;

  const raw = await callGroq([{ role: "user", content: prompt }]);
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    const insights = JSON.parse(match[0]);
    for (const insight of insights) {
      await memory.saveInsight(insight);
    }
  } catch {
    // silently skip if parsing fails
  }
}

async function generateProactiveNudge() {
  const [stats, insights, openPRs] = await Promise.all([
    memory.getSummaryStats(),
    memory.getRecentInsights(5),
    getOpenPRs(),
  ]);

  const prompt = `You are Blu, Tarun's personal AI agent. Based on the data below, decide if there's something worth proactively telling Tarun right now. Be specific and useful, not generic. If there's nothing genuinely worth saying, reply with exactly: SKIP

Data:
Hexaware todos: ${stats.hexTodos.map(t => t.content).join(', ') || 'none'}
SmartResQ todos: ${stats.srqTodos.map(t => t.content).join(', ') || 'none'}
Unreviewed learnings: ${stats.unreviewed.length}
Open PRs: ${openPRs.join(', ') || 'none'}
Insights: ${insights.join(', ') || 'none'}

Plain text only. Under 4 lines. No markdown.`;

  const result = await callGroq([{ role: "user", content: prompt }]);
  return result.trim() === 'SKIP' ? null : result;
}

async function generateBrief(type) {
  const [stats, openPRs, recentCommits] = await Promise.all([
    memory.getSummaryStats(),
    getOpenPRs(),
    getRecentCommits(),
  ]);

  let prompt;
  if (type === "morning") {
    prompt = `Generate a concise morning brief for Tarun in plain text (no markdown).
He is starting his Hexaware intern day.
Pending Hexaware todos: ${stats.hexTodos.map(t => t.content).join(", ") || "none"}
Pending SmartResQ todos from last night: ${stats.srqTodos.map(t => t.content).join(", ") || "none"}
Unreviewed learnings: ${stats.unreviewed.length}
Open SmartResQ PRs: ${openPRs.join(", ") || "none"}
Keep it under 6 lines. Be direct and practical.`;
  } else {
    prompt = `Generate a concise evening mode-switch message for Tarun in plain text (no markdown).
He is switching from Hexaware to SmartResQ work.
Pending SmartResQ todos: ${stats.srqTodos.map(t => t.content).join(", ") || "none"}
Unreviewed learnings captured today: ${stats.unreviewed.length}
Open PRs needing review: ${openPRs.join(", ") || "none"}
Recent commits: ${recentCommits.slice(0, 3).join(", ") || "none"}
Keep it under 6 lines. Be direct and motivating.`;
  }

  return await callGroq([{ role: "user", content: prompt }]);
}

module.exports = { handleIncoming, generateBrief, generateProactiveNudge };
