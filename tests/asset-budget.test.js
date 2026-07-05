// Asset-size budget gate for Sanctuary's End.
//
// The whole GLB roster (heroes + NPCs + monsters + bosses), the shared prop kits, and the buildings are
// EAGER-loaded at boot (js/11-player.js -> loadRoster -> js/10-assets.js) and kept resident for the session.
// There is no runtime signal that this eager download has crept up — a new boss GLB or a re-exported model at
// 4x the size sails through green CI and just makes every player's cold boot slower. This test pins the
// declared eager-load byte total (the same sum js/10-assets.js computes at load) under a budget so growth
// fails CI, and checks every roster file actually exists on disk so the manifest can't drift from reality.
//
// When the tiered/lazy roster loader lands, only the boot-tier subset will be eager — tighten BUDGET_BYTES then.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', '10-assets.js'), 'utf8');

// Current declared eager total is ~27.4MB (roster ~20.3 + prop kits ~6.2 + buildings ~0.94). Budget gives
// ~10% headroom so a meaningful regression trips it without flapping on small asset tweaks.
const BUDGET_BYTES = 30 * 1024 * 1024;

function glbManifest() {
  const m = SRC.match(/const GLB_MANIFEST = (\{.*?\});\s*const GLB_BASE/s);
  assert.ok(m, 'GLB_MANIFEST literal not found in js/10-assets.js');
  let json;
  assert.doesNotThrow(() => {
    json = JSON.parse(m[1]);
  }, 'GLB_MANIFEST is not parseable JSON');
  return json;
}

// Sum every `bytes:` / `"bytes":` field inside a named manifest declaration (props/buildings use unquoted keys).
function sumBytesOf(declName) {
  const decl = SRC.match(new RegExp(`const ${declName} = (\\{[\\s\\S]*?\\});`));
  assert.ok(decl, `${declName} not found in js/10-assets.js`);
  let total = 0;
  const re = /["']?bytes["']?\s*:\s*(\d+)/g;
  let hit;
  while ((hit = re.exec(decl[1]))) total += Number(hit[1]);
  return total;
}

test('every eager-loaded roster GLB referenced in GLB_MANIFEST exists on disk', () => {
  const man = glbManifest();
  const base = path.join(ROOT, 'assets', 'models');
  for (const [role, entry] of Object.entries(man)) {
    assert.ok(entry && entry.file, `GLB_MANIFEST["${role}"] has no file`);
    assert.ok(
      fs.existsSync(path.join(base, entry.file)),
      `roster asset missing on disk: assets/models/${entry.file} (role ${role})`,
    );
    assert.ok(Number.isFinite(entry.bytes) && entry.bytes > 0, `GLB_MANIFEST["${role}"] has no positive byte count`);
  }
});

test('declared eager-load asset total stays under the boot budget', () => {
  const man = glbManifest();
  const rosterBytes = Object.values(man).reduce((a, e) => a + (e.bytes || 0), 0);
  const propBytes = sumBytesOf('PROP_KIT_MANIFEST');
  const buildingBytes = sumBytesOf('BUILDING_MANIFEST');
  const total = rosterBytes + propBytes + buildingBytes;
  assert.ok(
    total <= BUDGET_BYTES,
    `eager asset total ${(total / 1048576).toFixed(1)}MB exceeds budget ${(BUDGET_BYTES / 1048576).toFixed(0)}MB ` +
      `(roster ${(rosterBytes / 1048576).toFixed(1)} + props ${(propBytes / 1048576).toFixed(1)} + buildings ${(buildingBytes / 1048576).toFixed(1)})`,
  );
});
