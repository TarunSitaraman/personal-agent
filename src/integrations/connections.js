const memory = require('../agent/memory');

async function findConnections(callGroq, newContent, type, embedding = null) {
  try {
    // Pre-filter with pgvector when an embedding is available — sends only genuinely similar
    // items to the LLM instead of the 30 most recent regardless of relevance. Falls back to
    // recency when no embedding was computed (e.g. the embedding provider was unavailable).
    const existing = embedding
      ? await memory.getSimilarContent(embedding, 8)
      : await memory.getRecentContent(30);
    if (existing.length < 3) return;

    const list = existing
      .map((item, i) => `${i + 1}. [${item.type}] ${item.content}`)
      .join('\n');

    const raw = await callGroq([{
      role: 'user',
      content: `New ${type} just saved: "${newContent}"

Existing knowledge base:
${list}

Find 1-2 meaningful semantic connections between the new item and existing items. Only return connections that are genuinely relevant — skip if nothing connects well.

Return ONLY a JSON array of connection strings (empty array if none):
["New item connects to #3 because both relate to RAG pipeline architecture", "Similar to #7 — both cover SmartResQ auth flow"]`,
    }]);

    const match = raw.match(/\[[\s\S]*?\]/);
    if (!match) return;
    const connections = JSON.parse(match[0]);

    for (const c of connections) {
      if (c && c.length > 10) {
        await memory.saveInsight(`[connection] ${c}`);
      }
    }
  } catch {
    // silent — never block main flow
  }
}

module.exports = { findConnections };
