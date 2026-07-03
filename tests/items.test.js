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
    ';(globalThis.__it={SLOTS,SOCKET_MAX,WEAPON_BASES,rollItem,reforgeItem,weaponSpeed,itemScore,setClass:(c)=>{character={class:c};}});',
  );
}

const IT = loadItems();

test('the offhand slot exists with sockets and rolls a class-flavored kind', () => {
  assert.ok(IT.SLOTS.includes('offhand'), 'offhand joined SLOTS');
  assert.equal(IT.SOCKET_MAX.offhand, 2, 'offhand can roll up to 2 sockets');

  IT.setClass('warrior');
  for (let i = 0; i < 30; i++) {
    const it = IT.rollItem(10, 'offhand');
    assert.equal(it.slot, 'offhand');
    assert.equal(it.ohKind, 'shield', 'warrior offhands are shields');
    assert.ok(it.baseStat > 0, 'shields roll an armor base stat');
    assert.ok(it.block >= 6, 'shields roll Block %');
    assert.ok(!it.h2, 'offhands are never two-handed');
  }
  IT.setClass('mage');
  for (let i = 0; i < 30; i++) {
    const it = IT.rollItem(10, 'offhand');
    assert.equal(it.ohKind, 'tome', 'mage offhands are tomes');
    assert.equal(it.baseStat, 0, 'tomes have no base stat');
    assert.ok('skilldmg' in it.affixes || 'mp' in it.affixes, 'tomes guarantee a caster kit affix');
  }
  IT.setClass('rogue');
  for (let i = 0; i < 30; i++) {
    const it = IT.rollItem(10, 'offhand');
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
