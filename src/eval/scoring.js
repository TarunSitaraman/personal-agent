// Pure scoring for the classifier eval harness (src/eval/run_eval.js). No network, no DB.

// Mirrors how handleIncoming reads a classifier response: a primary `action`, plus an optional
// `actions` array for compound requests. Order is not meaningful, duplicates are collapsed.
function actionsFrom(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  const names = [];
  if (typeof parsed.action === 'string') names.push(parsed.action);
  if (Array.isArray(parsed.actions)) {
    for (const a of parsed.actions) if (a && typeof a.action === 'string') names.push(a.action);
  }
  return [...new Set(names)];
}

const key = list => [...new Set(list)].sort().join('+');

// `accept` is a list of acceptable action sets, e.g. [["list_todos"], ["none"]].
function scoreCase(actual, accept) {
  const got = key(actual);
  return accept.some(alt => key(alt) === got);
}

module.exports = { actionsFrom, scoreCase };
