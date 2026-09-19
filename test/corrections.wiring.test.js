// The detector is unit-tested in corrections.test.js. This pins the wiring: that a capture leaves
// a breadcrumb the next turn can read, that a retraction actually records against it, and that
// none of it can break the reply the user is waiting for.
//
// The undo_last test is the one that matters most. Detection lives inside executeAction rather
// than at a call site because there are eight call sites and undo_last runs down the classifier
// path, not Path A — an earlier draft of this feature hooked the Path A dispatch and would have
// silently recorded nothing while every detector test still passed.

const test = require('node:test');
const assert = require('node:assert');

const memory = require('../src/agent/memory');
const { executeAction } = require('../src/agent/brain');

test.afterEach(() => test.mock.restoreAll());

test('a capture action leaves a breadcrumb for the next turn', async () => {
  const saved = [];
  test.mock.method(memory, 'addTodo', async () => {});
  test.mock.method(memory, 'saveState', async (key, value, ttl) => { saved.push({ key, value, ttl }); });

  await executeAction('add_todo', { content: 'buy milk' }, null);

  const crumb = saved.find(s => s.key === 'last_capture');
  assert.ok(crumb, 'add_todo must leave a last_capture breadcrumb');
  assert.strictEqual(crumb.value.action, 'add_todo');
  assert.strictEqual(crumb.value.itemType, 'todo');
  assert.strictEqual(crumb.value.msg, 'buy milk');
  assert.strictEqual(crumb.ttl, 10, 'the TTL is the correction window');
});

test('a retrieval action leaves no breadcrumb', async () => {
  const saved = [];
  test.mock.method(memory, 'getPendingTodos', async () => []);
  test.mock.method(memory, 'saveState', async (key, value) => { saved.push({ key, value }); });

  await executeAction('list_todos', {}, null);

  assert.strictEqual(saved.find(s => s.key === 'last_capture'), undefined);
});

test('a breadcrumb failure does not break the reply', async () => {
  test.mock.method(memory, 'addTodo', async () => {});
  test.mock.method(memory, 'saveState', async () => { throw new Error('state table down'); });

  const reply = await executeAction('add_todo', { content: 'buy milk' }, null);

  assert.match(reply, /buy milk/, 'the user still gets their confirmation');
});

test('undo_last records a correction against the previous capture', async () => {
  const recorded = [];
  test.mock.method(memory, 'getState', async key =>
    key === 'last_capture' ? { action: 'add_todo', itemType: 'todo', msg: 'buy milk' } : null);
  test.mock.method(memory, 'getLastCreatedItem', async () => null);
  test.mock.method(memory, 'recordCorrection', async c => { recorded.push(c); });

  await executeAction('undo_last', {}, null);

  assert.strictEqual(recorded.length, 1);
  assert.deepStrictEqual(recorded[0].rejected, ['add_todo']);
  assert.strictEqual(recorded[0].signal, 'undo_last');
});

test('an ordinary action reads no breadcrumb', async () => {
  // The read is gated to the three retraction actions, so the common path costs no extra query.
  const reads = [];
  test.mock.method(memory, 'getPendingTodos', async () => []);
  test.mock.method(memory, 'getState', async key => { reads.push(key); return null; });

  await executeAction('list_todos', {}, null);

  assert.strictEqual(reads.includes('last_capture'), false);
});

test('a failure to record a correction does not break the reply', async () => {
  test.mock.method(memory, 'getState', async () => ({ action: 'add_todo', itemType: 'todo', msg: 'x' }));
  test.mock.method(memory, 'getLastCreatedItem', async () => null);
  test.mock.method(memory, 'recordCorrection', async () => { throw new Error('insert failed'); });

  const reply = await executeAction('undo_last', {}, null);

  assert.ok(typeof reply === 'string' && reply.length, 'the user still gets a reply');
});

test('the breadcrumb stores what the user sent, not what the classifier extracted', async () => {
  // End to end through handleIncoming, via the prefilter so no LLM is called. The prefilter rule
  // for "remind me to X" hands executeAction only X — the exact gap this pins. The first real
  // production correction (a stray voice note saved as a note) happened to dodge it only because
  // a note's content is the whole message.
  const { handleIncoming } = require('../src/agent/brain');
  const saved = [];
  test.mock.method(memory, 'addTodo', async () => {});
  test.mock.method(memory, 'saveMessage', async () => {});
  test.mock.method(memory, 'saveState', async (key, value) => { saved.push({ key, value }); });

  await handleIncoming('remind me to call the bank');

  const crumb = saved.find(s => s.key === 'last_capture');
  assert.ok(crumb, 'the prefiltered capture must leave a breadcrumb');
  assert.strictEqual(crumb.value.msg, 'remind me to call the bank');
});
