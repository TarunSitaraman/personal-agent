// The user scope every database call runs inside.
//
// This is the load-bearing safety property of the multi-user work: a query that runs without a
// scope would otherwise read or overwrite *every* user's rows. The scope is therefore required,
// not defaulted, and these assertions pin that — especially the ones about failing loudly.

const test = require('node:test');
const assert = require('node:assert');

const { runAsUser, currentUser, currentUserId, currentTz } = require('../src/agent/context');

const ALICE = { id: 'aaaaaaaa-0000-0000-0000-000000000001', wa_number: '911', name: 'Alice', tz: 'Asia/Kolkata' };
const BOB   = { id: 'bbbbbbbb-0000-0000-0000-000000000002', wa_number: '922', name: 'Bob',   tz: 'Europe/Berlin' };

test('currentUserId throws outside a scope rather than guessing an owner', () => {
  // The whole point. A silent fallback would turn a forgotten runAsUser into a cross-user leak
  // that looks exactly like working software.
  assert.throws(() => currentUserId(), /No user in scope/);
  assert.strictEqual(currentUser(), null);
});

test('the scope survives awaits, timers and nesting', async () => {
  await runAsUser(ALICE, async () => {
    assert.strictEqual(currentUserId(), ALICE.id);

    await new Promise(resolve => setTimeout(resolve, 5));
    assert.strictEqual(currentUserId(), ALICE.id, 'lost across an await');

    // Timers matter: scheduler/timers.js arms a setTimeout inside the scope and delivers from it
    // much later, so the reminder must still know whose it is.
    await new Promise(resolve => setTimeout(() => {
      assert.strictEqual(currentUserId(), ALICE.id, 'lost inside a timer callback');
      resolve();
    }, 5));
  });
});

test('two concurrent scopes do not bleed into each other', async () => {
  // One queue drain can carry messages from several senders, handled concurrently.
  const seen = [];

  await Promise.all([
    runAsUser(ALICE, async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      seen.push(['alice', currentUserId()]);
    }),
    runAsUser(BOB, async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      seen.push(['bob', currentUserId()]);
    }),
  ]);

  const byName = Object.fromEntries(seen);
  assert.strictEqual(byName.alice, ALICE.id);
  assert.strictEqual(byName.bob, BOB.id);
});

test('a nested scope restores the outer one on exit', async () => {
  await runAsUser(ALICE, async () => {
    await runAsUser(BOB, async () => {
      assert.strictEqual(currentUserId(), BOB.id);
    });
    assert.strictEqual(currentUserId(), ALICE.id, 'inner scope escaped');
  });
});

test('the scope does not outlive runAsUser', async () => {
  await runAsUser(ALICE, async () => currentUserId());
  assert.throws(() => currentUserId(), /No user in scope/);
});

test('a user without an id is refused', () => {
  // Better to fail at the entry point than to enter a scope whose id is undefined and have every
  // query silently match nothing.
  assert.throws(() => runAsUser({ wa_number: '999' }, () => {}), /requires a user with an id/);
  assert.throws(() => runAsUser(null, () => {}), /requires a user with an id/);
});

test('timezone comes from the user, not the process', async () => {
  // Brief scheduling and the recurrence walk both reason in local time. Once there are two users
  // in two zones, the process zone is the wrong answer for at least one of them.
  await runAsUser(BOB, () => {
    assert.strictEqual(currentTz(), 'Europe/Berlin');
  });
});

test('an error inside the scope propagates and still unwinds it', async () => {
  await assert.rejects(
    runAsUser(ALICE, async () => { throw new Error('boom'); }),
    /boom/
  );
  assert.throws(() => currentUserId(), /No user in scope/);
});
