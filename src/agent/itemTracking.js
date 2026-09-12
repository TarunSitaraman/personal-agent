// Item-state awareness: the fix for Jarvis re-announcing the same open PR as "news" on every
// brief. See ~/.gstack/projects/TarunSitaraman-personal-agent/Tarun-master-design-20260912-122627.md.
//
// Pure logic only — no DB, no network, no LLM — so it's unit-testable without a database, matching
// this repo's existing convention (schema.tags.test.js, schema.scoping.test.js).

// The allow-list is the feasibility-critical part of this design: a raw snapshot diff against the
// full GitHub API response would register volatile fields (updated_at, CI check counters) as
// "changed" on every poll and defeat the point of tracking state at all.
function extractGithubSnapshot(pr) {
  return {
    state: pr.state,
    draft: pr.draft,
    headSha: pr.headSha,
    requestedReviewers: [...(pr.requestedReviewers || [])].sort(),
  };
}

function diffSnapshot(prevSnapshot, currentSnapshot) {
  if (!prevSnapshot) {
    return { changed: true, diffSummary: 'first seen' };
  }

  const changes = [];
  if (prevSnapshot.state !== currentSnapshot.state) {
    changes.push(`state ${prevSnapshot.state} -> ${currentSnapshot.state}`);
  }
  if (prevSnapshot.draft !== currentSnapshot.draft) {
    changes.push(currentSnapshot.draft ? 'marked draft' : 'marked ready for review');
  }
  if (prevSnapshot.headSha !== currentSnapshot.headSha) {
    changes.push('new commit pushed');
  }
  const prevReviewers = (prevSnapshot.requestedReviewers || []).join(',');
  const currReviewers = (currentSnapshot.requestedReviewers || []).join(',');
  if (prevReviewers !== currReviewers) {
    changes.push(`requested reviewers: [${prevReviewers}] -> [${currReviewers}]`);
  }

  return changes.length
    ? { changed: true, diffSummary: changes.join('; ') }
    : { changed: false, diffSummary: null };
}

// should_surface = true iff attention_state is new, changed, or stale_concerning. `unchanged`
// and `stale_ok` never surface — see the design doc's "status/attention_state/should_surface
// mapping" section.
const SURFACING_ATTENTION_STATES = new Set(['new', 'changed', 'stale_concerning']);

function shouldSurface(attentionState) {
  return SURFACING_ATTENTION_STATES.has(attentionState);
}

module.exports = { extractGithubSnapshot, diffSnapshot, shouldSurface };
