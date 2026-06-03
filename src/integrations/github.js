const axios = require('axios');

const REPO = 'TarunSitaraman/SmartResQ-dev';

async function getOpenPRs() {
  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${REPO}/pulls?state=open&per_page=10`,
      { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } }
    );
    return data.map(pr => `#${pr.number} ${pr.title} (by ${pr.user.login})`);
  } catch (err) {
    console.error('GitHub PR fetch error:', err.response?.data?.message || err.message);
    return [];
  }
}

async function getRecentCommits() {
  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${REPO}/commits?per_page=5`,
      { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } }
    );
    return data.map(c => `${c.commit.message.split('\n')[0]} (${c.commit.author.name})`);
  } catch (err) {
    console.error('GitHub commits fetch error:', err.response?.data?.message || err.message);
    return [];
  }
}

module.exports = { getOpenPRs, getRecentCommits };
