// Offhand + weapon-subtype tests for Sanctuary's End.
//
// The v50 offhand slot and weapon subtypes ride on three invariants: (1) offhand rolls carry a class-flavored
// kind identity (shield/tome/quiver) with the right base stats, (2) two-handedness is a stored roll flag that
// never appears on caster bases or offhands (an old saved "War Hammer" must stay one-handed), and (3) weapon
// speed derives at read time from it.base so pre-subtype items fold safely with no new field.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CORE_FILES, makeSandbox, loadFiles, runSnippet } = require('./harness');

function loadItems() {
  const sandbox = makeSandbox();
  loadFiles(sandbox, CORE_FILES);
  return runSnippet(
    sandbox,
    ';(globalThis.__it={SLOTS,SOCKET_MAX,WEAPON_BASES,SET_DEFS,UNIQUE_DEFS,RARE_EFFECTS,rollItem,reforgeItem,rerollAffix,imbueAffix,rerollAffixCost,imbueAffixCost,weaponSpeed,itemScore,setClass:(c)=>{character={class:c};}});',
  );
}

const IT = loadItems();

test('the offhand slot exists with sockets and rolls a class-flavored kind', () => {
  assert.ok(IT.SLOTS.includes('offhand'), 'offhand joined SLOTS');
  assert.equal(IT.SOCKET_MAX.offhand, 2, 'offhand can roll up to 2 sockets');

  // set/unique offhands are identity items without a kind — assert only on the common/magic/rare rolls
  const kinded = (it) => it.rarity !== 'set' && it.rarity !== 'unique';
  IT.setClass('warrior');
  for (let i = 0; i < 30; i++) {
    const it = IT.rollItem(10, 'offhand');
    assert.equal(it.slot, 'offhand');
    assert.ok(!it.h2, 'offhands are never two-handed');
    if (!kinded(it)) continue;
    assert.equal(it.ohKind, 'shield', 'warrior offhands are shields');
    assert.ok(it.baseStat > 0, 'shields roll an armor base stat');
    assert.ok(it.block >= 6, 'shields roll Block %');
  }
  IT.setClass('mage');
  for (let i = 0; i < 30; i++) {
    const it = IT.rollItem(10, 'offhand');
    if (!kinded(it)) continue;
    assert.equal(it.ohKind, 'tome', 'mage offhands are tomes');
    assert.equal(it.baseStat, 0, 'tomes have no base stat');
    assert.ok('skilldmg' in it.affixes || 'mp' in it.affixes, 'tomes guarantee a caster kit affix');
  }
  IT.setClass('rogue');
  for (let i = 0; i < 30; i++) {
    const it = IT.rollItem(10, 'offhand');
    if (!kinded(it)) continue;
    assert.equal(it.ohKind, 'quiver', 'rogue offhands are quivers');
    assert.ok('ias' in it.affixes || 'dmg' in it.affixes, 'quivers guarantee a ranged kit affix');
  }
});

test('two-handed is a rolled flag on melee/ranged bases only', () => {
  IT.setClass('warrior');
  const rolls = [];
  for (let i = 0; i < 200; i++) rolls.push(IT.rollItem(10, 'weapon'));
  assert.ok(
    rolls.some((w) => w.h2 === true),
    '~40% of melee weapons should roll two-handed',
  );
  for (const w of rolls) {
    if (w.h2) assert.ok(!IT.WEAPON_BASES.caster.includes(w.base), 'caster bases never roll 2H');
  }
  IT.setClass('mage');
  for (let i = 0; i < 100; i++) {
    const w = IT.rollItem(10, 'weapon');
    assert.ok(!w.h2, `caster weapon "${w.base}" must not be two-handed`);
  }
});

test('weapon speed derives from the base name and folds old-shape items safely', () => {
  assert.ok(IT.weaponSpeed({ base: 'Dagger' }) < 1, 'daggers are fast');
  assert.ok(IT.weaponSpeed({ base: 'War Hammer' }) > 1, 'war hammers are slow');
  assert.equal(IT.weaponSpeed({ base: 'Sword' }), 1, 'swords are the 1.0 baseline');
  // pre-subtype saved items: no base / unknown base / null all read as baseline speed
  assert.equal(IT.weaponSpeed({}), 1);
  assert.equal(IT.weaponSpeed({ base: 'Mystery Stick' }), 1);
  assert.equal(IT.weaponSpeed(null), 1);
});

test('set/unique defs reference only real slots, and six-piece sets carry 2/4/6 bonuses', () => {
  for (const sid in IT.SET_DEFS) {
    const sd = IT.SET_DEFS[sid];
    for (const p of sd.pieces) assert.ok(IT.SLOTS.includes(p), `${sid} piece "${p}" is not a slot`);
    for (const thr in sd.bonuses)
      assert.ok(+thr >= 2 && +thr <= sd.pieces.length, `${sid} bonus ${thr}pc exceeds its pieces`);
  }
  const six = Object.values(IT.SET_DEFS).filter((s) => s.pieces.length === 6);
  assert.ok(six.length >= 3, 'three six-piece class sets shipped');
  for (const s of six) assert.ok(s.bonuses[6], `${s.name} missing its 6pc capstone`);
  for (const u of IT.UNIQUE_DEFS) assert.ok(IT.SLOTS.includes(u.slot), `${u.name} bad slot`);
  assert.ok(
    IT.UNIQUE_DEFS.some((u) => u.effect === 'echo'),
    'the Spell Echo unique exists',
  );
  assert.ok(
    IT.UNIQUE_DEFS.some((u) => u.effect === 'chillaura'),
    'the chill-aura unique exists',
  );
});

test('targeted crafting: rerollAffix keeps siblings, imbueAffix adds a chosen key', () => {
  IT.setClass('warrior');
  const it = {
    slot: 'helm',
    rarity: 'rare',
    ilvl: 15,
    base: 'Helm',
    baseStat: 10,
    affixes: { hp: 20, crit: 3, armor: 8 },
    upgrade: 0,
  };
  assert.equal(IT.rerollAffix(it, 'hp'), true);
  assert.equal(it.affixes.crit, 3, 'sibling affix untouched');
  assert.equal(it.affixes.armor, 8, 'sibling affix untouched');
  assert.ok(it.affixes.hp >= 1, 'rerolled value is a real roll');
  assert.equal(IT.rerollAffix(it, 'dex'), false, 'cannot reroll an affix the item lacks');
  assert.equal(IT.imbueAffix(it, 'dex'), true, 'imbue adds a chosen affix');
  assert.ok(it.affixes.dex >= 1);
  assert.equal(IT.imbueAffix(it, 'bogus'), false, 'unknown keys are rejected');
  assert.ok(
    IT.rerollAffixCost(it) > 0 && IT.imbueAffixCost(it) > IT.rerollAffixCost(it),
    'imbue costs more than a reroll',
  );
});

test('deep rares can roll a legendary effect from the curated pool', () => {
  IT.setClass('rogue');
  const keys = new Set(IT.RARE_EFFECTS.map((e) => e.effect));
  let found = 0;
  for (let i = 0; i < 400; i++) {
    const it = IT.rollItem(15, 'helm');
    if (it.rarity === 'rare' && it.effect) {
      found++;
      assert.ok(keys.has(it.effect), `rare rolled an uncurated effect: ${it.effect}`);
      assert.ok(it.effectDesc, 'legendary-touched rares describe their effect');
    }
  }
  assert.ok(found > 0, '400 ilvl-15 rolls should produce at least one legendary-touched rare');
  for (let i = 0; i < 100; i++) {
    const it = IT.rollItem(5, 'helm');
    if (it.rarity === 'rare') assert.ok(!it.effect, 'below ilvl 12 rares never roll effects');
  }
});

test('reforging a shield preserves its kind identity (base stat + Block)', () => {
  IT.setClass('warrior');
  let shield = null;
  for (let i = 0; i < 60 && !shield; i++) {
    const it = IT.rollItem(12, 'offhand');
    if (it.rarity === 'common' || it.rarity === 'magic' || it.rarity === 'rare') shield = it;
  }
  assert.ok(shield, 'rolled a reforgeable shield');
  const b0 = shield.baseStat;
  const blk = shield.block;
  IT.reforgeItem(shield);
  assert.equal(shield.baseStat, b0, 'reforge must not zero a shield base stat');
  assert.equal(shield.block, blk, 'reforge must not strip Block');
});
