// handleButtonAction's decision logic: which branch a tap selects, what it passes to memory,
// what the user is told, and whether it reports the tap as handled.
//
// memory, send and hub are substituted so this runs with no database and no network. The SQL
// those functions issue is deliberately out of scope — that belongs to memory.js and needs a
// real Postgres to mean anything. What is covered here is everything between the button id and
// the call, which is where the three drifted copies differed.

const test = require('node:test');
const assert = require('node:assert');

const memory = require('../src/agent/memory');
const send = require('../src/whatsapp/send');
const hub = require('../src/events/hub');
const brain = require('../src/agent/brain');
const { handleButtonAction } = require('../src/whatsapp/buttons');

const FROM = '911234567890';

// Substitutes every outbound dependency and records what it received.
// mock.restoreAll() in afterEach puts the real implementations back.
function stub() {
  const sent = [];
  const calls = {};

  const record = (name) => (...args) => {
    (calls[name] ||= []).push(args);
    return undefined;
  };

  test.mock.method(send, 'sendMessage', async (to, text) => { sent.push({ to, text }); });
  test.mock.method(hub, 'notify', record('notify'));

  for (const fn of ['completeTodo', 'updateTodoReminder', 'setTodoReminderByContent', 'addTodo']) {
    test.mock.method(memory, fn, async (...args) => { (calls[fn] ||= []).push(args); });
  }
  test.mock.method(memory, 'getEventById', async () => ({ id: 'ev1', title: 'Standup', tags: ['work'] }));

  return { sent, calls };
}

test.afterEach(() => test.mock.restoreAll());

test('ltdone_ completes the tapped todo and refreshes the dashboard', async () => {
  const { sent, calls } = stub();

  assert.strictEqual(await handleButtonAction('ltdone_todo-1', FROM), true);
  assert.deepStrictEqual(calls.completeTodo, [['todo-1']]);
  assert.deepStrictEqual(sent, [{ to: FROM, text: 'Done. Removed from your list.' }]);
  assert.strictEqual(calls.notify.length, 1, 'dashboard must refresh after a completion');
});

test('rdone_ completes the todo the reminder was about', async () => {
  const { calls } = stub();

  assert.strictEqual(await handleButtonAction('rdone_todo-2', FROM), true);
  assert.deepStrictEqual(calls.completeTodo, [['todo-2']]);
  assert.strictEqual(calls.notify.length, 1);
});

test('an id containing underscores survives prefix stripping', async () => {
  const { calls } = stub();

  await handleButtonAction('rdone_a_b_c', FROM);
  assert.deepStrictEqual(calls.completeTodo, [['a_b_c']]);
});

test('rsnooze_ pushes the reminder out by the encoded interval', async () => {
  const { sent, calls } = stub();
  const before = Date.now();

  assert.strictEqual(await handleButtonAction('rsnooze_60_todo-3', FROM), true);

  const [todoId, remindAt] = calls.updateTodoReminder[0];
  assert.strictEqual(todoId, 'todo-3');
  const offsetMin = (remindAt.getTime() - before) / 60000;
  assert.ok(offsetMin >= 59.9 && offsetMin <= 60.1, `expected ~60 min out, got ${offsetMin}`);
  assert.deepStrictEqual(sent, [{ to: FROM, text: 'Snoozed 60 min.' }]);
});

test('rsnooze_ honours a non-default interval', async () => {
  const { sent, calls } = stub();
  const before = Date.now();

  await handleButtonAction('rsnooze_15_todo-4', FROM);

  const offsetMin = (calls.updateTodoReminder[0][1].getTime() - before) / 60000;
  assert.ok(offsetMin >= 14.9 && offsetMin <= 15.1, `expected ~15 min out, got ${offsetMin}`);
  assert.strictEqual(sent[0].text, 'Snoozed 15 min.');
});

test('evnoted_ acknowledges without touching storage', async () => {
  const { sent, calls } = stub();

  assert.strictEqual(await handleButtonAction('evnoted_ev1', FROM), true);
  assert.deepStrictEqual(sent, [{ to: FROM, text: 'Good luck!' }]);
  assert.strictEqual(calls.completeTodo, undefined, 'acknowledging must not mutate anything');
});

test('evsnooze_ re-queues the event as a todo 15 minutes out', async () => {
  const { sent, calls } = stub();
  const before = Date.now();

  assert.strictEqual(await handleButtonAction('evsnooze_ev1', FROM), true);

  const [content, tags, remindAt] = calls.addTodo[0];
  assert.strictEqual(content, 'Upcoming: Standup');
  assert.deepStrictEqual(tags, ['work'], "the event's tags carry over to the todo");
  const offsetMin = (remindAt.getTime() - before) / 60000;
  assert.ok(offsetMin >= 14.9 && offsetMin <= 15.1, `expected ~15 min out, got ${offsetMin}`);
  assert.strictEqual(sent[0].text, "I'll remind you again in 15 minutes.");
});

test('evsnooze_ still replies when the event has been deleted', async () => {
  const { sent, calls } = stub();
  test.mock.method(memory, 'getEventById', async () => null);

  assert.strictEqual(await handleButtonAction('evsnooze_gone', FROM), true);
  assert.strictEqual(calls.addTodo, undefined, 'nothing to re-queue');
  assert.strictEqual(sent.length, 1, 'the user still gets an answer');
});

test('rem_tonight_ sets 9pm and decodes the content keyword', async () => {
  const { sent, calls } = stub();

  assert.strictEqual(await handleButtonAction('rem_tonight_buy_milk', FROM), true);

  const [keyword, remindAt] = calls.setTodoReminderByContent[0];
  assert.strictEqual(keyword, 'buy milk');
  assert.strictEqual(remindAt.getHours(), 21);
  assert.strictEqual(remindAt.getMinutes(), 0);
  assert.ok(remindAt > new Date(), '9pm today would already be past — must roll to tomorrow');
  assert.strictEqual(sent[0].text, 'Reminder set for 9pm.');
});

test('rem_tmrw_ sets 8am on the following day', async () => {
  const { sent, calls } = stub();

  assert.strictEqual(await handleButtonAction('rem_tmrw_ship_it', FROM), true);

  const [keyword, remindAt] = calls.setTodoReminderByContent[0];
  assert.strictEqual(keyword, 'ship it');
  assert.strictEqual(remindAt.getHours(), 8);

  const today = new Date();
  assert.strictEqual(
    remindAt.getDate(),
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getDate()
  );
  assert.strictEqual(sent[0].text, 'Reminder set for tomorrow 8am.');
});

test('acknowledgement-only taps reply and change nothing', async () => {
  for (const [id, expected] of [
    ['rem_no', 'Ok, no reminder.'],
    ['stale_dismiss', 'Got it.'],
    ['stale_snooze', "Noted — I'll check back in a couple of days."],
    ['obt_skip', 'No problem. Have a focused session.'],
  ]) {
    const { sent, calls } = stub();
    assert.strictEqual(await handleButtonAction(id, FROM), true, `${id} should be handled`);
    assert.strictEqual(sent[0].text, expected, `${id} copy`);
    assert.strictEqual(calls.completeTodo, undefined);
    test.mock.restoreAll();
  }
});

test('obt_set routes through the LLM and relays its reply', async () => {
  const { sent, calls } = stub();
  test.mock.method(brain, 'handleIncoming', async () => 'What is your One Big Thing?');

  assert.strictEqual(await handleButtonAction('obt_set', FROM), true);
  assert.strictEqual(sent[0].text, 'What is your One Big Thing?');
  assert.strictEqual(calls.notify.length, 1);
});

test('obt_set stays silent when the LLM returns nothing', async () => {
  const { sent } = stub();
  test.mock.method(brain, 'handleIncoming', async () => null);

  assert.strictEqual(await handleButtonAction('obt_set', FROM), true);
  assert.strictEqual(sent.length, 0, 'an empty reply must not send a blank message');
});

test('an unrecognised id falls through to the LLM', async () => {
  const { sent } = stub();

  assert.strictEqual(await handleButtonAction('something_else', FROM), false);
  assert.strictEqual(sent.length, 0);
});

test('a storage failure is contained and reported as unhandled', async () => {
  const { sent } = stub();
  test.mock.method(memory, 'completeTodo', async () => { throw new Error('db down'); });

  // Must not reject: an unhandled rejection here would take down the webhook.
  assert.strictEqual(await handleButtonAction('rdone_todo-9', FROM), false);
  assert.strictEqual(sent.length, 0, 'no confirmation for work that did not happen');
});
