// A recurring 403 on the morning and evening briefs went months without a diagnosis because the
// handler logged only axios's "Request failed with status code 403" and discarded GitHub's own
// explanation. These assert the log line carries enough to act on.

const test = require('node:test');
const assert = require('node:assert');

const { describeError } = require('../src/integrations/github');

test('prefers GitHub\'s explanation over the axios message', () => {
  const err = {
    message: 'Request failed with status code 403',
    response: { status: 403, data: { message: 'Bad credentials' } },
  };

  const out = describeError(err);
  assert.match(out, /403/);
  assert.match(out, /Bad credentials/, 'the actionable half must survive');
});

test('a 403 says which environment variable to go and check', () => {
  const err = { message: 'x', response: { status: 403, data: { message: 'Bad credentials' } } };

  assert.match(describeError(err), /GITHUB_TOKEN/);
});

test('falls back to the axios message when there is no response body', () => {
  assert.match(describeError({ message: 'socket hang up' }), /socket hang up/);
});

test('a network failure with no response does not claim a token problem', () => {
  const out = describeError({ message: 'ENOTFOUND api.github.com' });

  assert.doesNotMatch(out, /GITHUB_TOKEN/, 'only a real 403 should point at the token');
  assert.match(out, /no status/);
});
