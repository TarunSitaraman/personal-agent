// Live probe of every configured LLM provider. Shared by the Express route (/api/llm-health) and
// the Vercel function (api/llm-health.js) — on Vercel the Express router is not deployed, so the
// route existed locally and 404'd in production.
const axios = require('axios');
const { MODEL_LADDERS } = require('./brain');

const PROBE = [{ role: 'user', content: 'Reply with only: OK' }];

const OPENAI_COMPATIBLE = {
  groq:       { url: 'https://api.groq.com/openai/v1/chat/completions', headers: k => ({ Authorization: `Bearer ${k}` }) },
  nvidia:     { url: 'https://integrate.api.nvidia.com/v1/chat/completions', headers: k => ({ Authorization: `Bearer ${k}` }) },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', headers: k => ({ Authorization: `Bearer ${k}`, 'HTTP-Referer': 'https://personal-agent', 'X-Title': 'Personal Agent' }) },
};

async function probeModel(provider, key, model) {
  if (provider === 'gemini') {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env[key]);
    const r = await Promise.race([
      genAI.getGenerativeModel({ model }).generateContent('Reply with only: OK'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    return r.response.text().trim();
  }
  const { url, headers } = OPENAI_COMPATIBLE[provider];
  // gpt-oss reasons inside the completion: a 10-token budget is spent thinking and the content
  // comes back empty, which read as an outage. Mirror what callGroqModel sends.
  const body = { model, messages: PROBE, max_tokens: 256 };
  if (model.includes('gpt-oss')) body.reasoning_effort = 'low';
  const r = await axios.post(url, body, { headers: headers(process.env[key]), timeout: 8000 });
  // OpenRouter reports upstream failures inside a 200 body.
  if (r.data?.error) throw new Error(r.data.error.message);
  return r.data?.choices?.[0]?.message?.content?.trim();
}

// Resolves to { results, anyOk }. Never throws: a dead provider is a result, not an error.
async function probeAllProviders() {
  const results = {};
  const tests = [];

  for (const [provider, { key, models }] of Object.entries(MODEL_LADDERS)) {
    if (!process.env[key]) continue;
    for (const model of models) {
      tests.push(async () => {
        const label = `${provider}:${model}`;
        const start = Date.now();
        try {
          const reply = await probeModel(provider, key, model);
          results[label] = { ok: !!reply, ms: Date.now() - start, reply: reply?.slice(0, 20) };
        } catch (e) {
          results[label] = { ok: false, error: (e.response?.data?.error?.message || e.message)?.slice(0, 80) };
        }
      });
    }
  }

  await Promise.all(tests.map(t => t()));

  results._env = Object.fromEntries(
    Object.entries(MODEL_LADDERS).map(([provider, { key }]) => [provider, !!process.env[key]])
  );

  const anyOk = Object.entries(results).some(([k, v]) => k !== '_env' && v.ok);
  return { results, anyOk };
}

module.exports = { probeAllProviders };
