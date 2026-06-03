const { GoogleGenAI } = require('@google/genai');
const { getCurrentMode, getModeDescription } = require('./context');
const memory = require('./memory');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

  const contextBlock = `Current mode: ${mode}
${modeDesc}

Pending todos — Hexaware: ${stats.hexTodos.length}, SmartResQ: ${stats.srqTodos.length}
Unreviewed learnings: ${stats.unreviewed.length}`;

  const historyParts = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.content }],
  }));

  const chat = ai.chats.create({
    model: 'gemini-1.5-flash',
    history: historyParts,
    config: { systemInstruction: SYSTEM_PROMPT },
  });

  const fullMessage = `${contextBlock}\n\nUser message: ${userMessage}`;
  const result = await chat.sendMessage({ message: fullMessage });
  const raw = result.text;

  let parsed;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    await memory.saveMessage('user', userMessage);
    await memory.saveMessage('model', raw);
    return raw;
  }

  await executeAction(parsed.action, parsed.data, mode);
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
        if (data?.topic && data?.content)
          await memory.addLearning(data.topic, data.content, data.source);
        break;
    }
  } catch (err) {
    console.error('Action execution error:', action, err.message);
  }
}

async function generateBrief(type) {
  const stats = await memory.getSummaryStats();

  let prompt;
  if (type === 'morning') {
    prompt = `Generate a concise morning brief for Tarun in plain text (no markdown).
He is starting his Hexaware intern day.
Pending Hexaware todos: ${stats.hexTodos.map(t => t.content).join(', ') || 'none'}
Pending SmartResQ todos from last night: ${stats.srqTodos.map(t => t.content).join(', ') || 'none'}
Unreviewed learnings: ${stats.unreviewed.length}
Keep it under 5 lines. Be direct and practical.`;
  } else {
    prompt = `Generate a concise evening mode-switch message for Tarun in plain text (no markdown).
He is switching from Hexaware to SmartResQ work.
Pending SmartResQ todos: ${stats.srqTodos.map(t => t.content).join(', ') || 'none'}
Unreviewed learnings captured today: ${stats.unreviewed.length}
Keep it under 5 lines. Be direct and motivating.`;
  }

  const result = await ai.models.generateContent({
    model: 'gemini-1.5-flash',
    contents: prompt,
  });
  return result.text;
}

module.exports = { handleIncoming, generateBrief };
