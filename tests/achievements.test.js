// Achievement-journal tests for Sanctuary's End.
//
// achApplyEvent (js/01-items.js, pure) is the engine behind the Journal: per-EVENT counters on
// character.ach.n, one-shot unlocks in character.ach.u. It runs on the hot _ev path, so its contract —
// cheap misses, idempotent unlocks, additive counters — is worth a regression net, plus the def table's
// shape (unique ids, known events, valid thresholds/checks).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CORE_FILES, makeSandbox, loadFiles, runSnippet } = require('./harness');

function loadAch() {
  const sandbox = makeSandbox();
  loadFiles(sandbox, CORE_FILES);
  return runSnippet(sandbox, ';(globalThis.__ach={ACH_DEFS,ACH_EV_INDEX,achApplyEvent,SAVE});');
}

const A = loadAch();

test('the def table is well-formed: unique ids, indexed events, thresholds or checks', () => {
  const ids = new Set();
  for (const d of A.ACH_DEFS) {
    assert.ok(!ids.has(d.id), `duplicate achievement id: ${d.id}`);
    ids.add(d.id);
    assert.ok(d.name && d.desc && d.ico, `${d.id} missing display fields`);
    assert.ok(d.ev, `${d.id} watches no event`);
    assert.ok(d.n >= 1 || typeof d.check === 'function', `${d.id} has neither a threshold nor a check`);
    assert.ok(A.ACH_EV_INDEX[d.ev].includes(d), `${d.id} not indexed under its event`);
  }
  assert.ok(A.ACH_DEFS.length >= 18, `journal should carry a real def set (got ${A.ACH_DEFS.length})`);
});

test('threshold defs count up and unlock exactly once', () => {
  const ch = A.SAVE.newCharacter('Ach', 'warrior');
  const first = A.achApplyEvent(ch, 'kill');
  assert.equal(first.length, 1, 'First Blood unlocks on the first kill');
  assert.equal(first[0].id, 'first_blood');
  assert.equal(ch.ach.n.kill, 1, 'counter recorded');
  for (let i = 0; i < 98; i++) assert.equal(A.achApplyEvent(ch, 'kill').length, 0, 'nothing between thresholds');
  const hundred = A.achApplyEvent(ch, 'kill');
  assert.equal(hundred.length, 1, 'Slayer unlocks at kill 100');
  assert.equal(hundred[0].id, 'slayer');
  assert.equal(ch.ach.u.first_blood, 1, 'earlier unlock persists');
  assert.equal(A.achApplyEvent(ch, 'kill').length, 0, 'unlocks never re-fire');
});

test('check defs re-test character stats when their event fires', () => {
  const ch = A.SAVE.newCharacter('Deep', 'rogue');
  ch.maxDepth = 9;
  assert.equal(A.achApplyEvent(ch, 'depth').length, 0, 'depth 9 unlocks nothing');
  ch.maxDepth = 26;
  const ups = A.achApplyEvent(ch, 'depth').map((d) => d.id);
  assert.ok(ups.includes('delver') && ups.includes('abysswalker'), 'both passed milestones fire together');
  assert.ok(!ups.includes('voidtreader'), 'unreached milestones stay locked');
});

test('unknown events and journal-less characters are free no-ops', () => {
  const ch = A.SAVE.newCharacter('Noop', 'mage');
  assert.equal(A.achApplyEvent(ch, 'float').length, 0, 'unwatched event does nothing');
  assert.equal(ch.ach.n.float, undefined, 'unwatched events are not even counted');
  assert.equal(A.achApplyEvent({}, 'kill').length, 0, 'pre-v8 character shape cannot throw');
  assert.equal(A.achApplyEvent(null, 'kill').length, 0, 'null character cannot throw');
});

test('journal state survives a save round-trip', () => {
  const ch = A.SAVE.newCharacter('Trip', 'warrior');
  A.achApplyEvent(ch, 'kill');
  const back = A.SAVE.migrate(JSON.parse(JSON.stringify(ch)));
  assert.equal(back.ach.u.first_blood, 1, 'unlock survives');
  assert.equal(back.ach.n.kill, 1, 'counter survives');
});
