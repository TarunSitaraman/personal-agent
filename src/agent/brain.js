const axios = require("axios");
const { getCurrentMode, getModeDescription } = require("./context");
const memory = require("./memory");
const { getOpenPRs, getRecentCommits } = require("../integrations/github");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are Blu, Tarun's personal AI agent accessible via WhatsApp.

About Tarun:
- Intern at Hexaware (10am–6pm weekdays)
- Founder/tech lead of SmartResQ — a healthcare emergency response startup (works evenings)
- Learning GenAI and agentic AI actively
- Wants low-friction capture and proactive intelligence

CRITICAL DATA RULES:
- You only know what is in the context block (todos, notes, learnings, and GitHub PR data)
- You do NOT have access to calendars or emails
- NEVER make up numbers or data not present in the context block. If something isn't there, say you don't have that information.

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

async function callGroq(messages) {
  try {
    const response = await axios.post(
      GROQ_URL,
      { model: GROQ_MODEL, messages },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } },
    );
    return response.data.choices[0].message.content;
  } catch (err) {
    console.error(
      "Groq API error:",
      JSON.stringify(err.response?.data || err.message),
    );
    throw err;
  }
}

async function handleIncoming(userMessage) {
  const mode = getCurrentMode();
  const modeDesc = getModeDescription(mode);
  const [history, stats, openPRs] = await Promise.all([
    memory.getRecentHistory(20),
    memory.getSummaryStats(),
    getOpenPRs(),
  ]);

  const prBlock = openPRs.length
    ? `Open PRs (${openPRs.length}):\n${openPRs.join('\n')}`
    : 'Open PRs: none';

  const contextBlock = `Current mode: ${mode}
${modeDesc}

Pending todos — Hexaware: ${stats.hexTodos.length}, SmartResQ: ${stats.srqTodos.length}
Unreviewed learnings: ${stats.unreviewed.length}
${prBlock}`;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((h) => ({
      role: h.role === "user" ? "user" : "assistant",
      content: h.content,
    })),
    {
      role: "user",
      content: `${contextBlock}\n\nUser message: ${userMessage}`,
    },
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
    }
  } catch (err) {
    console.error("Action execution error:", action, err.message);
  }
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
Pending Hexaware todos: ${stats.hexTodos.map((t) => t.content).join(", ") || "none"}
Pending SmartResQ todos from last night: ${stats.srqTodos.map((t) => t.content).join(", ") || "none"}
Unreviewed learnings: ${stats.unreviewed.length}
Open SmartResQ PRs: ${openPRs.join(", ") || "none"}
Keep it under 6 lines. Be direct and practical.`;
  } else {
    prompt = `Generate a concise evening mode-switch message for Tarun in plain text (no markdown).
He is switching from Hexaware to SmartResQ work.
Pending SmartResQ todos: ${stats.srqTodos.map((t) => t.content).join(", ") || "none"}
Unreviewed learnings captured today: ${stats.unreviewed.length}
Open PRs needing review: ${openPRs.join(", ") || "none"}
Recent commits: ${recentCommits.slice(0, 3).join(", ") || "none"}
Keep it under 6 lines. Be direct and motivating.`;
  }

  return await callGroq([{ role: "user", content: prompt }]);
}

module.exports = { handleIncoming, generateBrief };
