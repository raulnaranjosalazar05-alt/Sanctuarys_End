// Floor-bounty logic tests for Sanctuary's End.
//
// rollFloorObjective() / bountyProgress() are the pure state machine behind the soft "floor bounty"
// gate (slay N foes OR slay the floor Champion -> bonus loot). They live in the browser-free logic files
// (js/00..03), loaded in a vm sandbox via the shared harness, and we exercise the real functions.
//
// Not tested here: the goblin "escape drops nothing" rule. That is a structural guarantee — the despawn
// path in the monster loop removes the mesh directly and deliberately never calls killMonster() — not a
// pure function, so a unit test would just restate the code. It's covered by browser verification.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CORE_FILES, makeSandbox, loadFiles, runSnippet } = require('./harness');

function loadObjectives() {
  const sandbox = makeSandbox();
  loadFiles(sandbox, CORE_FILES);
  // Expose a Math.random seam from INSIDE the sandbox realm — the test realm's Math is a different object,
  // so overriding it here would not affect the sandbox's rollFloorObjective().
  return runSnippet(
    sandbox,
    ';(globalThis.__obj = { rollFloorObjective, rollWildObjective, bountyProgress, _orig: Math.random, setRandom(f){ Math.random = f; }, resetRandom(){ Math.random = this._orig; } });',
  );
}

const obj = loadObjectives();
const { rollFloorObjective, rollWildObjective, bountyProgress } = obj;

// Run fn with the SANDBOX's Math.random pinned to `val`, restoring afterwards.
function withRandom(val, fn) {
  obj.setRandom(() => val);
  try {
    return fn();
  } finally {
    obj.resetRandom();
  }
}

test('no bounty on boss floors or the opening floor', () => {
  for (const d of [0, 1, 5, 10, 15, 666]) {
    assert.equal(rollFloorObjective(d), null, `depth ${d} should have no bounty`);
  }
});

test('non-boss floors always produce a valid bounty', () => {
  const KINDS = new Set(['slay', 'champion', 'elites', 'shrines']);
  for (const d of [2, 3, 4, 6, 7, 8, 9, 11, 23, 97]) {
    // all non-boss (avoid multiples of 5)
    for (let i = 0; i < 50; i++) {
      const o = rollFloorObjective(d);
      assert.ok(o && KINDS.has(o.kind), `depth ${d} bad bounty: ${JSON.stringify(o)}`);
      assert.equal(o.done, false);
      if (o.kind === 'slay') {
        assert.equal(o.count, 0);
        assert.ok(o.target >= 6 && o.target <= 18, `slay target out of [6,18]: ${o.target}`);
      }
      if (o.kind === 'elites') assert.ok(o.target >= 2 && o.target <= 3, `elites target out of [2,3]`);
      if (o.kind === 'shrines') assert.equal(o.target, 2, 'shrine bounties always ask for 2 (floors spawn 2-3)');
    }
  }
});

test('slay target scales with depth and clamps at 18', () => {
  // force the slay branch (Math.random >= 0.5)
  assert.equal(withRandom(0.9, () => rollFloorObjective(2)).target, 7); // 6 + (2>>1)
  assert.equal(withRandom(0.9, () => rollFloorObjective(8)).target, 10); // 6 + 4
  assert.equal(withRandom(0.9, () => rollFloorObjective(62)).target, 18); // 6 + 31 -> clamped (62 is non-boss)
});

test('random branch selects champion vs slay', () => {
  assert.equal(withRandom(0.1, () => rollFloorObjective(4)).kind, 'champion');
  assert.equal(withRandom(0.9, () => rollFloorObjective(4)).kind, 'slay');
});

test('slay bounty completes exactly at target, once', () => {
  const o = { kind: 'slay', target: 3, count: 0, done: false };
  assert.equal(bountyProgress(o, 'kill'), false); // 1
  assert.equal(bountyProgress(o, 'kill'), false); // 2
  assert.equal(bountyProgress(o, 'kill'), true); // 3 -> complete (the transition)
  assert.equal(o.done, true);
  assert.equal(bountyProgress(o, 'kill'), false); // already done -> no re-trigger
});

test('slay bounty ignores champion kills; champion bounty ignores normal kills', () => {
  const slay = { kind: 'slay', target: 2, count: 0, done: false };
  assert.equal(bountyProgress(slay, 'champion'), false);
  assert.equal(slay.count, 0, 'champion kill must not advance a slay bounty');

  const champ = { kind: 'champion', done: false };
  assert.equal(bountyProgress(champ, 'kill'), false);
  assert.equal(champ.done, false, 'a normal kill must not complete a champion bounty');
  assert.equal(bountyProgress(champ, 'champion'), true);
  assert.equal(champ.done, true);
  assert.equal(bountyProgress(champ, 'champion'), false); // once
});

test('null / completed bounty is inert', () => {
  assert.equal(bountyProgress(null, 'kill'), false);
  assert.equal(bountyProgress({ kind: 'slay', target: 1, count: 5, done: true }, 'kill'), false);
});

test('elite and shrine bounties count only their own signal', () => {
  const el = { kind: 'elites', target: 2, count: 0, done: false };
  assert.equal(bountyProgress(el, 'kill'), false);
  assert.equal(el.count, 0, 'plain kills must not advance an elites bounty');
  assert.equal(bountyProgress(el, 'elite'), false);
  assert.equal(bountyProgress(el, 'elite'), true);
  assert.equal(bountyProgress(el, 'elite'), false, 'once');

  const sh = { kind: 'shrines', target: 2, count: 0, done: false };
  assert.equal(bountyProgress(sh, 'shrine'), false);
  assert.equal(bountyProgress(sh, 'kill'), false);
  assert.equal(sh.count, 1, 'kills must not advance a shrine bounty');
  assert.equal(bountyProgress(sh, 'shrine'), true);
});

test('wild hunts: hunt counts kills, stalker completes on the champion', () => {
  obj.setRandom(() => 0.1);
  const hunt = rollWildObjective(3);
  obj.resetRandom();
  assert.equal(hunt.kind, 'hunt');
  assert.ok(hunt.target >= 8 && hunt.target <= 14, `hunt target out of [8,14]: ${hunt.target}`);
  for (let i = 0; i < hunt.target - 1; i++) assert.equal(bountyProgress(hunt, 'kill'), false);
  assert.equal(bountyProgress(hunt, 'kill'), true, 'completes exactly at target');

  obj.setRandom(() => 0.9);
  const stalker = rollWildObjective(3);
  obj.resetRandom();
  assert.equal(stalker.kind, 'stalker');
  assert.equal(bountyProgress(stalker, 'kill'), false, 'plain kills do not end the hunt');
  assert.equal(bountyProgress(stalker, 'champion'), true, 'slaying the stalker does');
});
