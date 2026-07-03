// Monster/elite table-shape tests for Sanctuary's End.
//
// v50 moved elite-affix behavior out of scattered name checks into hooks on ELITE_MODS (onAI/onHitPlayer/
// onDeath) and gave monster types signature moves via MTYPES.onAI. Combat correctness lives in the browser,
// but the TABLES are pure data — these tests pin their shape so a malformed entry (the kind the spawn loop
// dereferences blind) fails fast, plus the resist math that scales them with depth.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CORE_FILES, makeSandbox, loadFiles, runSnippet } = require('./harness');

function loadMonsters() {
  // js/12-monsters.js needs THREE at top level only for a Raycaster/Vector pair — stub those.
  class Stub {}
  const sandbox = makeSandbox({ THREE: { Raycaster: Stub, Vector2: Stub, Vector3: Stub } });
  loadFiles(sandbox, CORE_FILES);
  loadFiles(sandbox, ['js/12-monsters.js']);
  return runSnippet(sandbox, ';(globalThis.__mon={MTYPES,ELITE_MODS,deepenResist,monsterResistMult,normElem});');
}

const M = loadMonsters();

test('every elite affix is well-formed and behavioral affixes expose hooks, not name checks', () => {
  const ids = Object.keys(M.ELITE_MODS);
  assert.ok(ids.length >= 10, `elite pool grew to 10+ affixes (got ${ids.length})`);
  for (const id of ids) {
    const md = M.ELITE_MODS[id];
    assert.equal(typeof md.name, 'string', `${id} needs a display name`);
    assert.equal(typeof md.col, 'number', `${id} needs an aura color`);
    for (const h of ['onAI', 'onHitPlayer', 'onDeath']) {
      if (md[h] !== undefined) assert.equal(typeof md[h], 'function', `${id}.${h} must be callable`);
    }
  }
  // the three new zoning affixes exist and are behavioral
  assert.equal(typeof M.ELITE_MODS.molten.onAI, 'function');
  assert.equal(typeof M.ELITE_MODS.waller.onAI, 'function');
  assert.equal(typeof M.ELITE_MODS.vortex.onAI, 'function');
  // migrated v49 behaviors live on hooks now
  assert.equal(typeof M.ELITE_MODS.fiery.onDeath, 'function');
  assert.equal(typeof M.ELITE_MODS.frozen.onHitPlayer, 'function');
  assert.equal(typeof M.ELITE_MODS.arcane.onAI, 'function');
});

test('monster types carry signature moves and the totem is a harmless stationary healer', () => {
  for (const t of ['brute', 'hellhound', 'shaman', 'wraith', 'totem']) {
    assert.equal(typeof M.MTYPES[t].onAI, 'function', `${t} should have a signature move`);
  }
  const totem = M.MTYPES.totem;
  assert.equal(totem.stationary, true, 'totems never chase');
  assert.equal(totem.dmg, 0, 'totems never attack');
  for (const t in M.MTYPES) {
    const d = M.MTYPES[t];
    assert.ok(d.hp > 0 && d.r > 0 && typeof d.name === 'string', `${t} malformed`);
  }
});

test('deepenResist strengthens resists with depth, floors at 0.25, and leaves vulnerabilities alone', () => {
  const r = { fire: 0.5, frost: 1.25 };
  const deep = M.deepenResist(r, 10, false);
  assert.ok(deep.fire < 0.5, 'resist deepens with depth');
  assert.equal(deep.frost, 1.25, 'vulnerability untouched');
  const floor = M.deepenResist({ fire: 0.3 }, 100, true);
  assert.equal(floor.fire, 0.25, 'floored — depth can never make a monster immune');
  assert.equal(r.fire, 0.5, 'input map is cloned, not mutated');
});

test('monsterResistMult handles legacy strings, maps, aliases and shields', () => {
  assert.equal(M.monsterResistMult({ resist: 'fire' }, 'fire'), 0.5, 'legacy string resist halves matched damage');
  assert.equal(M.monsterResistMult({ resist: 'fire' }, 'frost'), 1);
  assert.equal(M.monsterResistMult({ resist: { frost: 0.4 } }, 'cold'), 0.4, "'cold' aliases to frost");
  assert.equal(
    M.monsterResistMult({ resist: { fire: 0.5 }, shield: 10, shieldMul: 0.5 }, 'frost'),
    0.5,
    'shield halves everything',
  );
});
