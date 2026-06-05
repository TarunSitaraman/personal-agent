const axios = require('axios');

const REPO = 'TarunSitaraman/SmartResQ-dev';

function getHeaders() {
  if (!process.env.GITHUB_TOKEN) return {};
  return { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } };
}

async function getOpenPRs() {
  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${REPO}/pulls?state=open&per_page=10`,
      getHeaders()
    );
    return data.map(pr => `#${pr.number} ${pr.title} (by ${pr.user.login})`);
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 401) return [];
    console.error('GitHub PR fetch error:', err.message);
    return [];
  }
}

async function getRecentCommits() {
  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${REPO}/commits?per_page=5`,
      getHeaders()
    );
    return data.map(c => `${c.commit.message.split('\n')[0]} (${c.commit.author.name})`);
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 401) return [];
    console.error('GitHub commits fetch error:', err.message);
    return [];
  }
}

async function getOpenIssues() {
  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${REPO}/issues?state=open&per_page=10`,
      getHeaders()
    );
    // GitHub issues API returns PRs too — filter them out
    return data
      .filter(i => !i.pull_request)
      .map(i => `#${i.number} ${i.title} (${i.labels.map(l => l.name).join(', ') || 'no labels'})`);
  } catch (err) {
    // 404 means the repo is private or doesn't exist. Don't crash the bot.
    if (err.response?.status === 404 || err.response?.status === 401) return [];
    console.error('GitHub issues fetch error:', err.message);
    return [];
  }
}

module.exports = { getOpenPRs, getRecentCommits, getOpenIssues };
