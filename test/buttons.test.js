// Button id parsing, and the round trip against the ids scheduler/delivery.js actually emits.
// These two files are a wire contract split across the outbound and inbound halves of the app —
// they drifted once already, so the contract is asserted here rather than assumed.

const test = require('node:test');
const assert = require('node:assert');

const { parseSnooze, decodeKeyword, parseInteractive } = require('../src/whatsapp/buttons');
const { formatTodoReminder, formatEventReminder } = require('../src/scheduler/delivery');

test('parseSnooze recovers the interval and the todo id', () => {
  assert.deepStrictEqual(parseSnooze('rsnooze_60_abc123'), { mins: 60, todoId: 'abc123' });
  assert.deepStrictEqual(parseSnooze('rsnooze_15_abc123'), { mins: 15, todoId: 'abc123' });
});

test('parseSnooze keeps underscores inside a uuid intact', () => {
  // Splitting on "_" and taking parts[2] alone would truncate an id like this.
  assert.deepStrictEqual(parseSnooze('rsnooze_60_a_b_c'), { mins: 60, todoId: 'a_b_c' });
});

test('parseSnooze falls back to 60 minutes on a malformed interval', () => {
  assert.strictEqual(parseSnooze('rsnooze_xx_abc').mins, 60);
});

test('decodeKeyword turns an encoded id back into spaced content', () => {
  assert.strictEqual(decodeKeyword('rem_tonight_buy_milk', 'rem_tonight_'), 'buy milk');
  assert.strictEqual(decodeKeyword('rem_tmrw_ship_the_thing', 'rem_tmrw_'), 'ship the thing');
});

test('parseInteractive reads a button reply', () => {
  const payload = { type: 'button_reply', button_reply: { id: 'rdone_1', title: 'Done' } };
  assert.deepStrictEqual(parseInteractive(payload), { buttonId: 'rdone_1', buttonTitle: 'Done' });
});

test('parseInteractive reads a list reply', () => {
  const payload = { type: 'list_reply', list_reply: { id: 'ltdone_9', title: 'buy milk' } };
  assert.deepStrictEqual(parseInteractive(payload), { buttonId: 'ltdone_9', buttonTitle: 'buy milk' });
});

test('parseInteractive yields undefined fields rather than throwing on junk', () => {
  assert.deepStrictEqual(parseInteractive(undefined), { buttonId: undefined, buttonTitle: undefined });
  assert.deepStrictEqual(parseInteractive({ type: 'nope' }), { buttonId: undefined, buttonTitle: undefined });
});

// ── Wire contract: every id delivery.js emits must be parseable here ──────────

test('todo reminder button ids round trip', () => {
  const { buttons } = formatTodoReminder({ id: 'todo_with_underscores', content: 'x' });
  const [done, snooze] = buttons;

  assert.strictEqual(done.id.slice('rdone_'.length), 'todo_with_underscores');
  assert.deepStrictEqual(parseSnooze(snooze.id), { mins: 60, todoId: 'todo_with_underscores' });
});

test('event reminder button ids round trip', () => {
  const ev = { id: 'ev_1', title: 'Sync', start_at: new Date().toISOString() };
  const [noted, snooze] = formatEventReminder(ev, Date.now()).buttons;

  assert.strictEqual(noted.id.slice('evnoted_'.length), 'ev_1');
  assert.strictEqual(snooze.id.slice('evsnooze_'.length), 'ev_1');
});

test('emitted prefixes match the ones the handler dispatches on', () => {
  // Guards a rename on one side that is not mirrored on the other.
  const { buttons: todoButtons } = formatTodoReminder({ id: 'x', content: 'c' });
  const { buttons: eventButtons } = formatEventReminder(
    { id: 'y', title: 't', start_at: new Date().toISOString() },
    Date.now()
  );
  const emitted = [...todoButtons, ...eventButtons].map(b => b.id);

  const known = ['rdone_', 'rsnooze_', 'evnoted_', 'evsnooze_'];
  for (const id of emitted) {
    assert.ok(known.some(p => id.startsWith(p)), `no handler prefix matches emitted id "${id}"`);
  }
});
