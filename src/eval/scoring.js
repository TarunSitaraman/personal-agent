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
// `rejected` is a list of action names the classifier must NOT produce. It comes from a captured
// correction, where the user's own undo or delete told us the routing was wrong but not what was
// right. `accept` wins when both are present: a hand-supplied label beats an inferred negative.
function scoreCase(actual, accept, rejected) {
  if (Array.isArray(accept) && accept.length) {
    const got = key(actual);
    return accept.some(alt => key(alt) === got);
  }
  if (Array.isArray(rejected) && rejected.length) {
    return !rejected.some(name => actual.includes(name));
  }
  return false;
}

// How a case's expectation reads in the failure printout. A correction case has no accept list,
// so the raw `accept.map(...)` in run_eval would throw on exactly the cases this feature adds.
function describeExpectation(c) {
  if (Array.isArray(c.accept) && c.accept.length) {
    return c.accept.map(a => a.join(' + ')).join(' | ');
  }
  if (Array.isArray(c.rejected) && c.rejected.length) {
    return `anything not ${c.rejected.join(' or ')}`;
  }
  return '(nothing asserted)';
}

module.exports = { actionsFrom, scoreCase, describeExpectation };
