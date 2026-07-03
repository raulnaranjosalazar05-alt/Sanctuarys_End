// Dungeon-layout generator tests for Sanctuary's End.
//
// genDungeonLayout (js/00-core.js, pure) turns the flat ±80 hall into a room-and-door floor plan. The
// invariants that keep a floor PLAYABLE are structural: every room reachable through doors (a sealed room
// with the descent portal inside soft-locks the run), the fixed player entry (world 0,0) inside a room,
// the portal off the spawn room, walls inside bounds. Hammer them across hundreds of generated floors.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CORE_FILES, makeSandbox, loadFiles, runSnippet } = require('./harness');

function loadLayout() {
  const sandbox = makeSandbox();
  loadFiles(sandbox, CORE_FILES);
  return runSnippet(sandbox, ';(globalThis.__lay={genDungeonLayout,layoutRoomAt,layoutSpawnPoint,layoutRoomPoint});');
}

const L = loadLayout();
const HALF = 80;

function bfsReach(lay) {
  const adj = new Map();
  for (const d of lay.doors) {
    if (!adj.has(d.a)) adj.set(d.a, []);
    if (!adj.has(d.b)) adj.set(d.b, []);
    adj.get(d.a).push(d.b);
    adj.get(d.b).push(d.a);
  }
  const seen = new Set([lay.spawnRoom]);
  const q = [lay.spawnRoom];
  while (q.length) {
    const r = q.shift();
    for (const n of adj.get(r) || []) {
      if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen;
}

test('500 generated floors: fully connected, portal off spawn, walls in bounds, doors sane', () => {
  for (let i = 0; i < 500; i++) {
    const lay = L.genDungeonLayout(HALF, 2 + (i % 60));
    assert.ok(lay.rooms.length >= 2, `floor ${i}: needs at least 2 rooms (got ${lay.rooms.length})`);
    // connectivity: every room reachable from the spawn room through doors
    const seen = bfsReach(lay);
    assert.equal(seen.size, lay.rooms.length, `floor ${i}: ${lay.rooms.length - seen.size} room(s) sealed off`);
    // spanning tree minimum
    assert.ok(lay.doors.length >= lay.rooms.length - 1, `floor ${i}: too few doors for connectivity`);
    // the fixed player entry is inside a valid room, and the portal room is elsewhere
    assert.ok(lay.spawnRoom >= 0 && lay.spawnRoom < lay.rooms.length, `floor ${i}: bad spawn room`);
    assert.notEqual(lay.portalRoom, lay.spawnRoom, `floor ${i}: portal spawned on top of the player`);
    assert.ok(lay.dist[lay.portalRoom] >= 1, `floor ${i}: portal room not deeper than spawn`);
    // portal coordinates sit inside the portal room
    assert.equal(
      L.layoutRoomAt(lay, lay.portal.x, lay.portal.z),
      lay.portalRoom,
      `floor ${i}: portal outside its room`,
    );
    // walls stay inside the hall and never degenerate
    for (const w of lay.walls) {
      for (const v of [w.x1, w.z1, w.x2, w.z2])
        assert.ok(v >= -HALF - 0.01 && v <= HALF + 0.01, `floor ${i}: wall out of bounds`);
      assert.ok(w.x1 === w.x2 || w.z1 === w.z2, `floor ${i}: wall not axis-aligned`);
    }
  }
});

test('layoutSpawnPoint stays in-bounds, off the player, and inside a reachable room', () => {
  for (let i = 0; i < 100; i++) {
    const lay = L.genDungeonLayout(HALF, 3);
    const p = L.layoutSpawnPoint(lay, 0, 0);
    assert.ok(p, 'always returns a point when a layout exists');
    assert.ok(Math.abs(p.x) <= HALF && Math.abs(p.z) <= HALF, 'in bounds');
    const room = L.layoutRoomAt(lay, p.x, p.z);
    const pr = L.layoutRoomAt(lay, 0, 0);
    const neighbors = new Set([pr]);
    for (const d of lay.doors) {
      if (d.a === pr) neighbors.add(d.b);
      if (d.b === pr) neighbors.add(d.a);
    }
    assert.ok(neighbors.has(room), 'spawn point lands in the player room or a door-neighbor');
  }
});

test('layoutRoomPoint respects the cell margin so placements never hug a wall', () => {
  for (let i = 0; i < 50; i++) {
    const lay = L.genDungeonLayout(HALF, 3);
    for (const rm of lay.rooms) {
      const p = L.layoutRoomPoint(lay, rm.id, 6);
      assert.equal(L.layoutRoomAt(lay, p.x, p.z), rm.id, 'point is inside the requested room');
      const cs = lay.cs;
      const lx = (p.x + HALF) % cs;
      const lz = (p.z + HALF) % cs;
      assert.ok(lx >= 5.99 && lx <= cs - 5.99, 'x margin held');
      assert.ok(lz >= 5.99 && lz <= cs - 5.99, 'z margin held');
    }
  }
});
