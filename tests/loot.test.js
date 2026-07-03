// Loot-luck composition tests for Sanctuary's End.
//
// Magic Find has two halves: zoneLuck (depth-based, written by setScale on zone entry) and lootLuck
// (gear MF %, written by recompute). In v49 both wrote the SAME global, so whichever ran last silently
// erased the other (enter a deep floor, then equip anything → depth luck gone). luckyRarity now composes
// them additively; these tests pin that contract with a scripted Math.random sequence.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CORE_FILES, makeSandbox, loadFiles, runSnippet } = require('./harness');

function loadLoot() {
  const sandbox = makeSandbox();
  loadFiles(sandbox, CORE_FILES);
  return runSnippet(
    sandbox,
    ';(globalThis.__loot={luckyRarity,setLuck:(z,g)=>{zoneLuck=z;lootLuck=g;},seq:(vals)=>{let i=0;Math.random=()=>vals[Math.min(i++,vals.length-1)];}});',
  );
}

test('zone luck and gear Magic Find compose additively in luckyRarity', () => {
  const L = loadLoot();
  // Sequence: rollRarity → 0.0 (common), bump roll → 0.45, second-bump roll → 0.99 (never).
  // Composed p = 0.3 (zone) + 0.2 (gear) = 0.5 → 0.45 < 0.5 → one bump → magic.
  L.setLuck(0.3, 0.2);
  L.seq([0.0, 0.45, 0.99]);
  assert.equal(L.luckyRarity(0), 'magic', 'a roll under the COMBINED luck must bump rarity');
});

test('either half alone would miss the bump the composed value catches', () => {
  const L = loadLoot();
  // Same 0.45 bump roll with only the gear half (0.2): 0.45 >= 0.2 → no bump. This is exactly the
  // last-writer-wins bug shape: if setScale's zone half is erased, deep-floor drops lose their luck.
  L.setLuck(0, 0.2);
  L.seq([0.0, 0.45, 0.99]);
  assert.equal(L.luckyRarity(0), 'common', 'gear MF alone must not cover the zone half');
});

test('composed luck is capped at 0.8', () => {
  const L = loadLoot();
  L.setLuck(0.6, 0.6); // 1.2 uncapped
  L.seq([0.0, 0.79, 0.99]);
  assert.equal(L.luckyRarity(0), 'magic', 'a 0.79 roll still bumps under the 0.8 cap');
  L.seq([0.0, 0.81, 0.99]);
  assert.equal(L.luckyRarity(0), 'common', 'a 0.81 roll must NOT bump — cap holds at 0.8');
});
