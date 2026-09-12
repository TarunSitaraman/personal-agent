// Guards the feasibility-critical part of the item-state-awareness design: the diff must ignore
// volatile GitHub fields (raw updated_at, CI counters) and only fire on the allow-listed fields
// that represent a real event — otherwise every poll reads as "changed" and the feature that was
// built to kill PR noise just becomes a new source of it.
//
// See ~/.gstack/projects/TarunSitaraman-personal-agent/Tarun-master-design-20260912-122627.md

const test = require('node:test');
const assert = require('node:assert');

const { extractGithubSnapshot, diffSnapshot, shouldSurface } = require('../src/agent/itemTracking');

test('extractGithubSnapshot keeps only the allow-listed fields', () => {
  const pr = {
    number: 47,
    title: 'Fix the thing',
    state: 'open',
    draft: false,
    headSha: 'abc123',
    requestedReviewers: ['bob', 'alice'],
    updatedAt: '2026-09-12T00:00:00Z', // volatile — must not survive extraction
  };

  const snapshot = extractGithubSnapshot(pr);

  assert.deepStrictEqual(snapshot, {
    state: 'open',
    draft: false,
    headSha: 'abc123',
    requestedReviewers: ['alice', 'bob'], // sorted, order-independent
  });
  assert.ok(!('updatedAt' in snapshot), 'volatile field must not leak into the snapshot');
});

test('diffSnapshot treats a missing previous snapshot as first seen', () => {
  const current = extractGithubSnapshot({ state: 'open', draft: false, headSha: 'a', requestedReviewers: [] });
  const { changed, diffSummary } = diffSnapshot(null, current);

  assert.strictEqual(changed, true);
  assert.strictEqual(diffSummary, 'first seen');
});

test('diffSnapshot reports no change when nothing meaningful moved', () => {
  const pr = { state: 'open', draft: false, headSha: 'abc123', requestedReviewers: ['bob'] };
  const prev = extractGithubSnapshot(pr);
  const curr = extractGithubSnapshot({ ...pr }); // identical, fresh object

  const { changed, diffSummary } = diffSnapshot(prev, curr);

  assert.strictEqual(changed, false);
  assert.strictEqual(diffSummary, null);
});

test('diffSnapshot detects a new commit via headSha', () => {
  const prev = extractGithubSnapshot({ state: 'open', draft: false, headSha: 'abc123', requestedReviewers: [] });
  const curr = extractGithubSnapshot({ state: 'open', draft: false, headSha: 'def456', requestedReviewers: [] });

  const { changed, diffSummary } = diffSnapshot(prev, curr);

  assert.strictEqual(changed, true);
  assert.match(diffSummary, /new commit pushed/);
});

test('diffSnapshot detects a reviewer request change', () => {
  const prev = extractGithubSnapshot({ state: 'open', draft: false, headSha: 'a', requestedReviewers: [] });
  const curr = extractGithubSnapshot({ state: 'open', draft: false, headSha: 'a', requestedReviewers: ['alice'] });

  const { changed, diffSummary } = diffSnapshot(prev, curr);

  assert.strictEqual(changed, true);
  assert.match(diffSummary, /requested reviewers/);
});

test('diffSnapshot detects a merge/close state change', () => {
  const prev = extractGithubSnapshot({ state: 'open', draft: false, headSha: 'a', requestedReviewers: [] });
  const curr = extractGithubSnapshot({ state: 'closed', draft: false, headSha: 'a', requestedReviewers: [] });

  const { changed, diffSummary } = diffSnapshot(prev, curr);

  assert.strictEqual(changed, true);
  assert.match(diffSummary, /open -> closed/);
});

test('shouldSurface matches the design doc mapping exactly', () => {
  assert.strictEqual(shouldSurface('new'), true);
  assert.strictEqual(shouldSurface('changed'), true);
  assert.strictEqual(shouldSurface('stale_concerning'), true);
  assert.strictEqual(shouldSurface('unchanged'), false);
  assert.strictEqual(shouldSurface('stale_ok'), false);
});
