// executeAction is the dispatcher for everything the LLM decides to do, and the point where a
// wrong reply becomes a lie about stored data. Two bugs have already shipped here — complete_todo
// ignoring the rows it updated (dfe0288), and the catch-all reporting success for work that
// failed — so the emphasis is on what the user is told versus what actually happened.
//
// memory is substituted, so this runs with no database. getEmbedding short-circuits to null
// without a network call because GEMINI_API_KEY is unset under the test runner.

const test = require('node:test');
const assert = require('node:assert');

const memory = require('../src/agent/memory');
const { executeAction } = require('../src/agent/brain');

test.afterEach(() => test.mock.restoreAll());

// ── Never claim success for work that failed ─────────────────────────────────

test('a storage failure is reported honestly, not as success', async () => {
  // The Neon compute quota ran out once and every query started failing. Each capture below
  // answered with its optimistic confirmation while saving nothing.
  test.mock.method(memory, 'addTodo', async () => { throw new Error('exceeded the compute time quota'); });

  const reply = await executeAction('add_todo', { content: 'buy milk' }, 'Added to your todos.');

  assert.notStrictEqual(reply, 'Added to your todos.', 'must not echo the optimistic confirmation');
  assert.match(reply, /went wrong|didn't go through/i);
});

test('the honest failure applies to every mutating action', async () => {
  const boom = async () => { throw new Error('db down'); };
  for (const [fn, action, data, optimistic] of [
    ['addTodo', 'add_todo', { content: 'x' }, 'Todo added: "x"'],
    ['addNote', 'add_note', { content: 'x' }, 'Note saved: "x"'],
    ['saveGoal', 'set_goal', { content: 'x' }, 'Goal set: "x".'],
    ['saveKnowledge', 'learn_context', { content: 'x' }, 'Got it: "x"'],
    ['completeTodoByContent', 'complete_todo', { content: 'x' }, 'Marked as done'],
  ]) {
    test.mock.method(memory, fn, boom);
    const reply = await executeAction(action, data, optimistic);
    assert.notStrictEqual(reply, optimistic, `${action} must not claim success`);
    test.mock.restoreAll();
  }
});

// ── complete_todo: the dfe0288 regression site ───────────────────────────────

test('complete_todo confirms the content that actually changed', async () => {
  test.mock.method(memory, 'completeTodoByContent', async () => [{ content: 'buy oat milk' }]);

  const reply = await executeAction('complete_todo', { content: 'milk' }, 'done');
  // Echoes the stored wording, not what the user typed.
  assert.match(reply, /buy oat milk/);
});

test('complete_todo names every item when a keyword hits several', async () => {
  test.mock.method(memory, 'completeTodoByContent', async () => [
    { content: 'call the bank' }, { content: 'call mom' },
  ]);

  const reply = await executeAction('complete_todo', { content: 'call' }, 'done');
  assert.match(reply, /2/);
  assert.match(reply, /call the bank/);
  assert.match(reply, /call mom/);
});

test('complete_todo does not claim success when nothing matched', async () => {
  test.mock.method(memory, 'completeTodoByContent', async () => []);
  test.mock.method(memory, 'getPendingTodos', async () => [{ content: 'submit the tax return' }]);

  const reply = await executeAction('complete_todo', { content: 'submit the report' }, 'done');

  assert.doesNotMatch(reply, /marked as done/i, 'nothing changed, so nothing may be confirmed');
  assert.match(reply, /submit the tax return/, 'offers the closest pending item');
});

test('complete_todo says so plainly when nothing is even close', async () => {
  test.mock.method(memory, 'completeTodoByContent', async () => []);
  test.mock.method(memory, 'getPendingTodos', async () => [{ content: 'water the plants' }]);

  const reply = await executeAction('complete_todo', { content: 'deploy the release' }, 'done');

  assert.match(reply, /nothing was changed/i);
  // The suggestion list is scored on word overlap. A zero-overlap todo must not be offered —
  // guessing at an unrelated item is how the user ends up completing the wrong thing.
  assert.doesNotMatch(reply, /water the plants/, 'must not suggest a todo with no words in common');
  assert.doesNotMatch(reply, /did you mean/i);
});

test('complete_todo distinguishes an empty list from a failed match', async () => {
  test.mock.method(memory, 'completeTodoByContent', async () => []);
  test.mock.method(memory, 'getPendingTodos', async () => []);

  assert.match(await executeAction('complete_todo', { content: 'x' }, 'done'), /no pending todos/i);
});

// ── Capture paths ────────────────────────────────────────────────────────────

test('add_todo stores the content and the inferred tags', async () => {
  const seen = [];
  test.mock.method(memory, 'addTodo', async (...args) => { seen.push(args); });

  const reply = await executeAction('add_todo', { content: 'buy milk', tags: ['errands'] }, null);

  const [content, tags, remindAt] = seen[0];
  assert.strictEqual(content, 'buy milk');
  assert.deepStrictEqual(tags, ['errands'], 'tags are stored as an array, not a context string');
  assert.strictEqual(remindAt, null, 'a plain todo carries no reminder');
  assert.match(reply, /buy milk/);
});

test('capture actions refuse empty content instead of storing a blank row', async () => {
  const seen = [];
  test.mock.method(memory, 'addTodo', async (...a) => { seen.push(a); });
  test.mock.method(memory, 'addNote', async (...a) => { seen.push(a); });

  assert.match(await executeAction('add_todo', {}, null), /no todo content/i);
  assert.match(await executeAction('add_note', {}, null), /no note content/i);
  assert.match(await executeAction('add_learning', { topic: 'x' }, null), /required/i);
  assert.strictEqual(seen.length, 0, 'nothing may be written');
});

test('set_reminder defaults to an hour out when no time is given', async () => {
  const seen = [];
  test.mock.method(memory, 'addTodo', async (...a) => { seen.push(a); });
  const before = Date.now();

  await executeAction('set_reminder', { content: 'call the bank' }, null);

  const offsetMin = (seen[0][2].getTime() - before) / 60000;
  assert.ok(offsetMin >= 59.9 && offsetMin <= 60.1, `expected ~60 min, got ${offsetMin}`);
});

test('set_reminder honours an explicit minute offset', async () => {
  const seen = [];
  test.mock.method(memory, 'addTodo', async (...a) => { seen.push(a); });
  const before = Date.now();

  await executeAction('set_reminder', { content: 'x', minutes: '30' }, null);

  const offsetMin = (seen[0][2].getTime() - before) / 60000;
  assert.ok(offsetMin >= 29.9 && offsetMin <= 30.1, `expected ~30 min, got ${offsetMin}`);
});

// ── Listing ──────────────────────────────────────────────────────────────────

test('list_todos filters by tag and leaves untagged items out', async () => {
  test.mock.method(memory, 'getPendingTodos', async () => [
    { content: 'ship the api', tags: ['work'] },
    { content: 'buy milk', tags: ['errands'] },
    { content: 'untagged item', tags: null },
  ]);

  const reply = await executeAction('list_todos', { tags: ['work'] }, null);

  assert.match(reply, /ship the api/);
  assert.doesNotMatch(reply, /buy milk/);
  assert.doesNotMatch(reply, /untagged item/, 'a null tags column must not throw or leak through');
});

test('list_todos returns everything when no tag is given', async () => {
  test.mock.method(memory, 'getPendingTodos', async () => [
    { content: 'a', tags: ['work'] }, { content: 'b', tags: [] },
  ]);

  const reply = await executeAction('list_todos', {}, null);
  assert.match(reply, /a/);
  assert.match(reply, /b/);
});

test('empty lists read as empty rather than as an error', async () => {
  test.mock.method(memory, 'getPendingTodos', async () => []);
  test.mock.method(memory, 'getRecentNotes', async () => []);
  test.mock.method(memory, 'listEvents', async () => []);

  assert.match(await executeAction('list_todos', {}, null), /no pending todos/i);
  assert.match(await executeAction('list_notes', {}, null), /no notes/i);
  assert.match(await executeAction('list_events', {}, null), /nothing on your calendar/i);
});

// ── Events ───────────────────────────────────────────────────────────────────

test('add_event derives the end time from the duration', async () => {
  const seen = [];
  test.mock.method(memory, 'addEvent', async (...a) => { seen.push(a); });

  await executeAction(
    'add_event',
    { title: 'Standup', datetime: '2026-03-01T09:00:00.000Z', duration: '30' },
    null
  );

  const [title, startAt, endAt, , recurrence] = seen[0];
  assert.strictEqual(title, 'Standup');
  assert.strictEqual((endAt - startAt) / 60000, 30);
  assert.strictEqual(recurrence, 'none', 'unspecified recurrence defaults to none');
});

test('add_event rejects a recurrence the schema does not allow', async () => {
  const seen = [];
  test.mock.method(memory, 'addEvent', async (...a) => { seen.push(a); });

  await executeAction(
    'add_event',
    { title: 'x', datetime: '2026-03-01T09:00:00.000Z', recurrence: 'hourly' },
    null
  );

  assert.strictEqual(seen[0][4], 'none', 'an unknown recurrence falls back rather than reaching the DB');
});

test('delete_event asks which one when the title is ambiguous', async () => {
  const deleted = [];
  test.mock.method(memory, 'findEventByTitle', async () => [
    { id: 1, title: 'Sync', start_at: '2026-03-01T09:00:00.000Z' },
    { id: 2, title: 'Sync', start_at: '2026-03-02T09:00:00.000Z' },
  ]);
  test.mock.method(memory, 'deleteEvent', async (id) => { deleted.push(id); });

  const reply = await executeAction('delete_event', { title: 'Sync' }, null);

  assert.strictEqual(deleted.length, 0, 'an ambiguous delete must not guess');
  assert.match(reply, /which one/i);
});

test('delete_event removes it outright when exactly one matches', async () => {
  const deleted = [];
  test.mock.method(memory, 'findEventByTitle', async () => [{ id: 7, title: 'Sync', start_at: '2026-03-01T09:00:00.000Z' }]);
  test.mock.method(memory, 'deleteEvent', async (id) => { deleted.push(id); });

  await executeAction('delete_event', { title: 'Sync' }, null);
  assert.deepStrictEqual(deleted, [7]);
});

// ── Fallthrough ──────────────────────────────────────────────────────────────

test('an unknown action passes the model reply through untouched', async () => {
  assert.strictEqual(await executeAction('no_such_action', {}, 'Just chatting.'), 'Just chatting.');
});
