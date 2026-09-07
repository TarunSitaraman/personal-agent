const axios = require('axios');

async function webSearch(query, numResults = 5) {
  const { data } = await axios.post(
    'https://google.serper.dev/search',
    { q: query, gl: 'in', hl: 'en', num: numResults },
    { headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' } }
  );

  const results = [];

  if (data.answerBox?.answer) {
    results.push({ type: 'answer', text: data.answerBox.answer });
  } else if (data.answerBox?.snippet) {
    results.push({ type: 'answer', text: data.answerBox.snippet });
  }

  if (data.knowledgeGraph?.description) {
    results.push({ type: 'knowledge', text: data.knowledgeGraph.description });
  }

  for (const r of (data.organic || []).slice(0, numResults)) {
    results.push({ type: 'organic', title: r.title, snippet: r.snippet, link: r.link });
  }

  return results;
}

module.exports = { webSearch };
