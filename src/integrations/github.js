const axios = require('axios');

const REPO = process.env.GITHUB_REPO || 'TarunSitaraman/SmartResQ-dev';

function getHeaders() {
  if (!process.env.GITHUB_TOKEN) return {};
  return { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } };
}

// GitHub explains every refusal in the response body. err.message is only axios's generic
// "Request failed with status code 403", so logging that alone threw away the one detail needed
// to tell an expired token from a rate limit from an SSO block — which is why a recurring 403 on
// the morning and evening briefs sat unexplained in the runtime log for months.
function describeError(err) {
  const status = err.response?.status;
  const reason = err.response?.data?.message || err.message;
  // 403 here is never rate limiting in practice: these are three calls, twice a day.
  const hint = status === 403
    ? ' — GITHUB_TOKEN is being sent and rejected. Check it in the deployment environment: ' +
      'expired, revoked, or without repo scope for a private repository.'
    : '';
  return `${status || 'no status'} ${reason}${hint}`;
}

async function fetchFromRepo(label, path, map) {
  try {
    const { data } = await axios.get(`https://api.github.com/repos/${REPO}${path}`, getHeaders());
    return map(data);
  } catch (err) {
    // 401/404 is the ordinary "no token, private repo" case — the brief just omits GitHub data.
    if (err.response?.status === 404 || err.response?.status === 401) return [];
    console.error(`GitHub ${label} fetch error:`, describeError(err));
    return [];
  }
}

async function getOpenPRs() {
  return fetchFromRepo('PR', '/pulls?state=open&per_page=10', data =>
    data.map(pr => `#${pr.number} ${pr.title} (by ${pr.user.login})`)
  );
}

// Structured PR data for item-state tracking (standup/nudge only — see itemTracking.js).
// Deliberately omits review state and comment counts: both require a second API call per PR
// (the /pulls list endpoint doesn't carry them), which doubles GitHub API usage for signal this
// feature doesn't need yet. requestedReviewers + headSha + draft + state already distinguish
// "nothing happened" from "something happened" without that cost.
async function getOpenPRsDetailed() {
  return fetchFromRepo('PR', '/pulls?state=open&per_page=10', data =>
    data.map(pr => ({
      number: pr.number,
      title: pr.title,
      author: pr.user.login,
      url: pr.html_url,
      state: pr.state,
      draft: pr.draft,
      headSha: pr.head.sha,
      requestedReviewers: (pr.requested_reviewers || []).map(r => r.login).sort(),
      createdAt: pr.created_at,
    }))
  );
}

async function getRecentCommits() {
  return fetchFromRepo('commits', '/commits?per_page=5', data =>
    data.map(c => `${c.commit.message.split('\n')[0]} (${c.commit.author.name})`)
  );
}

async function getOpenIssues() {
  return fetchFromRepo('issues', '/issues?state=open&per_page=10', data =>
    // The issues API returns PRs too — filter them out.
    data
      .filter(i => !i.pull_request)
      .map(i => `#${i.number} ${i.title} (${i.labels.map(l => l.name).join(', ') || 'no labels'})`)
  );
}

module.exports = { getOpenPRs, getOpenPRsDetailed, getRecentCommits, getOpenIssues, describeError };
