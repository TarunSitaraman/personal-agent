// Coverage for update_todo/delete_note — previously listed in CLAUDE.md as missing endpoints.
// Follows the same disambiguation shape already established by complete_todo/delete_event:
// zero matches says so, one match acts, multiple matches list themselves and ask which.
//
// memory is substituted, so this runs with no database (same convention as
// brain.executeAction.test.js). getEmbedding short-circuits to null without a network call
// because GEMINI_API_KEY is unset under the test runner.

const test = require('node:test');
const assert = require('node:assert');

const memory = require('../src/agent/memory');
const { executeAction } = require('../src/agent/brain');

test.afterEach(() => test.mock.restoreAll());

// ── update_todo ───────────────────────────────────────────────────────────────

test('update_todo requires both the target and the replacement text', async () => {
  const missingTarget = await executeAction('update_todo', { new_content: 'x' }, 'ok');
  assert.match(missingTarget, /no todo specified/i);

  const missingReplacement = await executeAction('update_todo', { content: 'x' }, 'ok');
  assert.match(missingReplacement, /no replacement text/i);
});

test('update_todo reports no match honestly rather than claiming success', async () => {
  test.mock.method(memory, 'findTodoByContent', async () => []);

  const reply = await executeAction('update_todo', { content: 'parking pass', new_content: 'renew at DMV' }, 'Updated');

  assert.notStrictEqual(reply, 'Updated');
  assert.match(reply, /couldn't find/i);
});

test('update_todo asks which one when several todos match', async () => {
  test.mock.method(memory, 'findTodoByContent', async () => [
    { id: '1', content: 'renew parking pass' },
    { id: '2', content: 'renew parking permit for office' },
  ]);

  const reply = await executeAction('update_todo', { content: 'parking', new_content: 'x' }, 'Updated');

  assert.match(reply, /which one/i);
  assert.match(reply, /renew parking pass/);
  assert.match(reply, /renew parking permit for office/);
});

test('update_todo updates the single match and confirms the actual change', async () => {
  test.mock.method(memory, 'findTodoByContent', async () => [{ id: '1', content: 'renew parking pass' }]);
  const updateCall = test.mock.method(memory, 'updateTodoContent', async () => {});

  const reply = await executeAction(
    'update_todo',
    { content: 'parking pass', new_content: 'renew parking pass at DMV, not online' },
    'Updated'
  );

  assert.strictEqual(updateCall.mock.calls.length, 1);
  assert.strictEqual(updateCall.mock.calls[0].arguments[0], '1');
  assert.strictEqual(updateCall.mock.calls[0].arguments[1], 'renew parking pass at DMV, not online');
  assert.match(reply, /renew parking pass/);
  assert.match(reply, /renew parking pass at DMV, not online/);
});

// ── delete_note ───────────────────────────────────────────────────────────────

test('delete_note reports no match honestly rather than claiming success', async () => {
  test.mock.method(memory, 'findNoteByContent', async () => []);

  const reply = await executeAction('delete_note', { content: 'Vite bundler' }, 'Deleted');

  assert.notStrictEqual(reply, 'Deleted');
  assert.match(reply, /couldn't find/i);
});

test('delete_note asks which one when several notes match', async () => {
  test.mock.method(memory, 'findNoteByContent', async () => [
    { id: '1', content: 'Vite uses esbuild for dev bundling' },
    { id: '2', content: 'Vite plugin ecosystem notes' },
  ]);

  const reply = await executeAction('delete_note', { content: 'Vite' }, 'Deleted');

  assert.match(reply, /which one/i);
  assert.match(reply, /esbuild/);
  assert.match(reply, /plugin ecosystem/);
});

test('delete_note deletes the single match and confirms what was removed', async () => {
  test.mock.method(memory, 'findNoteByContent', async () => [{ id: '1', content: 'Vite uses esbuild' }]);
  const deleteCall = test.mock.method(memory, 'deleteNote', async () => {});

  const reply = await executeAction('delete_note', { content: 'Vite' }, 'Deleted');

  assert.strictEqual(deleteCall.mock.calls.length, 1);
  assert.strictEqual(deleteCall.mock.calls[0].arguments[0], '1');
  assert.match(reply, /Vite uses esbuild/);
});
