// Ability-bar loadout + per-skill rune-tree tests for Sanctuary's End.
//
// The action bar, save migration, and rune resolver all hang off three pure helpers: defaultLoadout (which
// backfills the 6 slots and must never lose the basic attack or duplicate a skill), the V7 SAVE.migrate
// (which must add loadout/skillRunes/abilityPoints without touching old fields), and resolveSkill/buildSkillTree/
// canAllocRune (the rune math + allocation rules that every cast reads). A bug here silently mis-stats a skill
// or bricks a save, so they earn a fast regression net. Loaded via the shared harness: the browser-free core
// files (js/00..03) hold defaultLoadout/SAVE, and js/14-runes.js holds the rune engine (buildSkillTree/
// resolveSkill/canAllocRune) — canAllocRune lives there, not with the abilities UI, so it stays browser-free.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CORE_FILES, RUNES_FILE, makeSandbox, loadFiles, runSnippet } = require('./harness');

function loadAbility() {
  const sandbox = makeSandbox();
  loadFiles(sandbox, CORE_FILES);
  // `clamp` + `let character` come from the core files; `player` is declared later in the real game, so the
  // rune file (canAllocRune/resolveSkill read it at call time) needs a stub in scope before it loads.
  runSnippet(sandbox, ';var player={level:99};');
  loadFiles(sandbox, [RUNES_FILE]);
  return runSnippet(
    sandbox,
    ';(globalThis.__ab={defaultLoadout,SAVE,SKILLDEFS,ACTIVE_ORDER,SKILL_RUNES,RUNE_FLAG_INFO,buildSkillTree,resolveSkill,invalidateRunes,canAllocRune,classAbilities,CLASS_ACTIVES,CLASSES,PTREE,setChar:(c)=>{character=c;invalidateRunes();},setLevel:(n)=>{player.level=n;}});',
  );
}

const AB = loadAbility();

test('save VERSION is bumped to 8 for the offhand/flags/journal migration', () => {
  assert.equal(AB.SAVE.VERSION, 8);
});

test('defaultLoadout locks the basic attack, honors activeSkillId, and never duplicates', () => {
  const lo = AB.defaultLoadout({ skills: { strike: 1, fireball: 1, frost: 1, nova: 1 }, activeSkillId: 'frost' });
  assert.equal(lo.length, 6);
  assert.equal(lo[0], 'strike', 'slot 0 must be the basic attack');
  assert.equal(lo[1], 'frost', 'the selected skill should land on the RMB slot');
  for (const id of ['fireball', 'nova']) assert.ok(lo.includes(id), `${id} should be backfilled`);
  const used = lo.filter(Boolean);
  assert.equal(new Set(used).size, used.length, 'no skill may appear in two slots');
});

test('defaultLoadout on a fresh character is just the basic attack', () => {
  const lo = AB.defaultLoadout({ skills: { strike: 1 }, activeSkillId: null });
  assert.equal(lo.length, 6);
  assert.equal(lo[0], 'strike');
  assert.ok(
    lo.slice(1).every((x) => x === null),
    'all non-basic slots empty',
  );
});

test('SAVE.migrate adds loadout/skillRunes/abilityPoints without disturbing existing fields', () => {
  const ch = {
    class: 'mage',
    level: 5,
    skills: { strike: 1, fireball: 1 },
    passives: ['start_int'],
    skillPoints: 4,
    activeSkillId: 'fireball',
  };
  const out = AB.SAVE.migrate(ch);
  assert.ok(Array.isArray(out.loadout) && out.loadout.length === 6, 'loadout array of 6');
  assert.equal(out.loadout[0], 'strike');
  assert.ok(out.loadout.includes('fireball'));
  assert.equal(Object.keys(out.skillRunes).length, 0, 'skillRunes starts empty');
  assert.equal(out.abilityPoints, 4, 'retroactive +1/level from L2 → level 5 gives 4');
  assert.equal(out.skillPoints, 4, 'existing passive points untouched');
  assert.equal(out.passives.length, 1, 'passives untouched');
  assert.equal(out.passives[0], 'start_int', 'passives untouched');
});

test('every active skill (except strike) gets a rune tree with a root and an exclusive branch set', () => {
  for (const id of AB.ACTIVE_ORDER) {
    if (id === 'strike') continue;
    const tree = AB.SKILL_RUNES[id];
    assert.ok(tree && tree.nodes[tree.root], `${id} missing tree/root`);
    const excl = {};
    for (const nid in tree.nodes) {
      const n = tree.nodes[nid];
      assert.ok(n.max >= 1 && n.cost >= 1, `${id}.${nid} bad max/cost`);
      if (n.excl) excl[n.excl] = (excl[n.excl] || 0) + 1;
    }
    assert.ok(
      Object.values(excl).some((c) => c >= 2),
      `${id} should offer a real choice (an excl group with 2+ runes)`,
    );
  }
});

test('resolveSkill folds numeric mods, clamps cdr, and unions flags', () => {
  AB.setLevel(99);
  AB.setChar({ skillRunes: { fireball: { fireball_dmg: 3 } } });
  let R = AB.resolveSkill('fireball');
  assert.ok(Math.abs(R.dmgMult - 1.21) < 1e-9, `+7%/rank × 3 → 1.21, got ${R.dmgMult}`);

  AB.setChar({ skillRunes: { fireball: { fireball_cdr: 3 } } }); // -5%/rank × 3 = -15% → 0.85
  R = AB.resolveSkill('fireball');
  assert.ok(Math.abs(R.cdrMult - 0.85) < 1e-9, `cdrMult should be 0.85, got ${R.cdrMult}`);

  AB.setChar({ skillRunes: { fireball: { fireball_sh0: 1 } } }); // Volatile (explodeOnImpact + addRadius:3)
  R = AB.resolveSkill('fireball');
  assert.ok(R.flags.has('explodeOnImpact'), 'flag rune should populate the flag set');
  assert.equal(R.addRadius, 3, 'numeric mod on a flag rune still folds');

  AB.setChar({ skillRunes: {} });
  R = AB.resolveSkill('fireball');
  assert.equal(R.dmgMult, 1, 'no runes → identity');
  assert.equal(R.flags.size, 0);
});

test('classAbilities lists a class’s actives ordered by unlock level, without strike', () => {
  AB.setChar({ class: 'warrior' });
  const list = AB.classAbilities();
  assert.ok(!list.includes('strike'), 'strike is the fixed basic attack, not in the unlock list');
  const reqs = list.map((id) => AB.CLASS_ACTIVES.warrior[id]);
  for (let i = 1; i < reqs.length; i++) assert.ok(reqs[i] >= reqs[i - 1], 'sorted by ascending unlock level');
  for (const id of list) assert.ok(AB.CLASS_ACTIVES.warrior[id] != null, `${id} belongs to the warrior unlock map`);
  assert.ok(list.includes('charge') && list.includes('whirlwind'), 'higher-tier warrior actives are surfaced');
});

test('the keystone is reachable from every shape node, not just the middle one', () => {
  AB.setLevel(99);
  // The three shapes are mutually exclusive; the keystone must link to all of them, or picking the
  // left/right shape would leave the middle blocked by exclusivity and the keystone unreachable forever.
  const tree = AB.SKILL_RUNES.fireball;
  for (const sh of ['fireball_sh0', 'fireball_sh1', 'fireball_sh2']) {
    assert.ok(tree.adj.fireball_key.includes(sh), `keystone should be adjacent to ${sh}`);
  }
  for (const sh of ['fireball_sh0', 'fireball_sh1', 'fireball_sh2']) {
    AB.setChar({
      abilityPoints: 99,
      skillRunes: { fireball: { fireball_dmg: 1, fireball_cdr: 1, fireball_mana: 1, [sh]: 1 } },
    });
    assert.equal(AB.canAllocRune('fireball', 'fireball_key'), true, `keystone must be allocatable after picking ${sh}`);
  }
});

test('the Extended (addDuration) rune folds into resolveSkill for util skills', () => {
  AB.setLevel(99);
  // warcry is a 'util' archetype tree whose sh2 is the +1.5s "Extended" rune; it must accumulate addDuration
  // (consumed by warcry's cast) rather than being an inert point sink.
  AB.setChar({ skillRunes: { warcry: { warcry_sh2: 1 } } });
  const R = AB.resolveSkill('warcry');
  assert.equal(R.addDuration, 1500, 'Extended rune should add 1500ms of duration');
});

test('every declared rune flag is obtainable on at least one tree', () => {
  // RUNE_FLAG_INFO is the full behavior-flag vocabulary; a flag with a handler but no node granting it
  // is dead content (the v49 state of chillNova/knockback/vampiric/lingering). Assert full coverage.
  const placed = new Set();
  for (const id in AB.SKILL_RUNES) {
    const tree = AB.SKILL_RUNES[id];
    for (const nid in tree.nodes) for (const f of tree.nodes[nid].flags || []) placed.add(f);
  }
  for (const flag in AB.RUNE_FLAG_INFO) {
    assert.ok(placed.has(flag), `flag "${flag}" is declared but no rune node grants it`);
  }
});

test('the side notables (vampiric / knockback / chill-burst) hang off the utility arms and gate correctly', () => {
  AB.setLevel(99);
  // fireball is a proj tree → gets _vamp off the Quicken arm; multishot is multiproj → _cnova + _kb.
  assert.ok(AB.SKILL_RUNES.fireball.nodes.fireball_vamp, 'proj tree has the Vampiric notable');
  assert.ok(AB.SKILL_RUNES.multishot.nodes.multishot_cnova, 'multiproj tree has the Frost Burst notable');
  assert.ok(AB.SKILL_RUNES.multishot.nodes.multishot_kb, 'multiproj tree has the Concussive notable');
  AB.setChar({ abilityPoints: 99, skillRunes: { fireball: {} } });
  assert.equal(AB.canAllocRune('fireball', 'fireball_vamp'), false, 'side notable needs its arm allocated first');
  AB.setChar({ abilityPoints: 99, skillRunes: { fireball: { fireball_dmg: 1, fireball_cdr: 1 } } });
  assert.equal(AB.canAllocRune('fireball', 'fireball_vamp'), true, 'reachable via Empower → Quicken');
  AB.setChar({ skillRunes: { fireball: { fireball_vamp: 1 } } });
  const R = AB.resolveSkill('fireball');
  assert.ok(R.flags.has('vampiric'), 'allocated side notable folds its flag');
});

test('Ground Slam carries the stun on-hit tag', () => {
  assert.equal(AB.SKILLDEFS.groundslam.onHit, 'stun', 'groundslam is the player stun source');
});

test('the barbarian is a complete class: kit, unlock map, creation, loadout', () => {
  assert.ok(AB.CLASSES.barbarian, 'CLASSES.barbarian exists');
  const map = AB.CLASS_ACTIVES.barbarian;
  assert.ok(map, 'barbarian unlock map exists');
  for (const id of Object.keys(map)) assert.ok(AB.SKILLDEFS[id], `barbarian unlock "${id}" is not a skill`);
  for (const id of ['rend', 'frenzy', 'shockwave']) {
    assert.ok(AB.SKILLDEFS[id], `new active ${id} defined`);
    assert.ok(AB.ACTIVE_ORDER.includes(id), `${id} is in ACTIVE_ORDER`);
    assert.ok(AB.SKILL_RUNES[id], `${id} has a rune tree`);
  }
  const c = AB.SAVE.newCharacter('Grom', 'barbarian');
  assert.equal(c.class, 'barbarian');
  assert.equal(c.passives[0], AB.PTREE.starts.barbarian, 'starts in the fury sector');
  assert.equal(c.loadout[1], 'rend', 'granted skill lands on the RMB slot');
  AB.setChar({ class: 'barbarian' });
  const list = AB.classAbilities();
  assert.ok(
    list.includes('rend') && list.includes('shockwave') && list.includes('frenzy'),
    'kit surfaces in the abilities list',
  );
});

test('every keystone in the forest is reachable from every class start', () => {
  const { nodes, adj, starts } = AB.PTREE;
  for (const cls in starts) {
    const start = starts[cls];
    assert.ok(nodes[start], `${cls} start node missing`);
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const n = q.shift();
      for (const nb of adj[n] || []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          q.push(nb);
        }
      }
    }
    for (const id in nodes) {
      if (nodes[id].type === 'keystone') assert.ok(seen.has(id), `keystone ${id} unreachable from ${cls} start`);
    }
  }
});

test('canAllocRune enforces connectivity, exclusivity, and level gates', () => {
  AB.setLevel(99);
  AB.setChar({ abilityPoints: 99, skillRunes: { fireball: {} } });
  assert.equal(AB.canAllocRune('fireball', 'fireball_dmg'), true, 'root is allocatable from scratch');
  assert.equal(AB.canAllocRune('fireball', 'fireball_sh0'), false, 'a shape rune needs an allocated neighbor first');

  // Build a path to a shape rune, then verify its sibling shape rune is locked out by exclusivity.
  AB.setChar({ abilityPoints: 99, skillRunes: { fireball: { fireball_dmg: 1, fireball_cdr: 1, fireball_sh0: 1 } } });
  assert.equal(AB.canAllocRune('fireball', 'fireball_sh1'), false, 'only one rune per exclusive shape slot');

  // Level gate: shape runes require level base+2; at level 1 they are locked even with a neighbor.
  AB.setLevel(1);
  AB.setChar({ abilityPoints: 99, skillRunes: { fireball: { fireball_dmg: 1, fireball_cdr: 1 } } });
  assert.equal(AB.canAllocRune('fireball', 'fireball_sh0'), false, 'level requirement blocks early allocation');
});
