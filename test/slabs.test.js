import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, AIR, STONE, WATER, PLANKS, SLAB, UPPER_SLAB, LANTERN, buildBlock, blockBounds, overlapsBlock, stepPlayer } from '../src/world.js';
import { EditHistory } from '../src/history.js';
import { slabPlacement } from '../src/slabs.js';
import { buildTerrainGeometry } from '../src/terrain.js';
import { faceTile, TILES, tileUVs } from '../src/textures.js';
import { soundRecipe } from '../src/sound.js';

function ground() {
  const world = new World({ generate: false });
  for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) world.set(x, 0, z, STONE);
  return world;
}
const playerAt = (x = 8.5, y = 1, z = 8.5) => ({ x, y, z, vy: 0, grounded: true, flying: false });
function advance(player, world, frames, input = {}) {
  for (let i = 0; i < frames; i++) stepPlayer(player, world, input, 1 / 120);
}
const target = (normal, height = 1.25) => ({ x: 8, y: 1, z: 8, normal, point: { x: 8.5, y: height, z: 8.5 } });

test('slab placement follows top, underside, and upper/lower side aim', () => {
  const world = ground();
  world.set(8, 1, 8, PLANKS);
  assert.deepEqual(slabPlacement(world, target({ x: 0, y: 1, z: 0 })), { x: 8, y: 2, z: 8, block: SLAB });
  world.set(8, 0, 8, AIR);
  assert.deepEqual(slabPlacement(world, target({ x: 0, y: -1, z: 0 })), { x: 8, y: 0, z: 8, block: UPPER_SLAB });
  for (const [height, block] of [[1.25, SLAB], [1.5, UPPER_SLAB], [1.75, UPPER_SLAB]]) {
    assert.deepEqual(slabPlacement(world, target({ x: 1, y: 0, z: 0 }, height)), { x: 9, y: 1, z: 8, block });
  }
  world.set(9, 1, 8, PLANKS);
  assert.equal(slabPlacement(world, target({ x: 1, y: 0, z: 0 })), null);
});

test('complementary halves merge into planks, and undo restores the exact half', () => {
  const world = ground(), history = new EditHistory(world);
  for (const [half, normal] of [[SLAB, { x: 0, y: 1, z: 0 }], [UPPER_SLAB, { x: 0, y: -1, z: 0 }]]) {
    world.set(8, 1, 8, half);
    const edit = slabPlacement(world, target(normal));
    assert.equal(history.edit(edit.x, edit.y, edit.z, edit.block).ok, true);
    assert.equal(world.get(8, 1, 8), PLANKS);
    assert.equal(history.undo().ok, true);
    assert.equal(world.get(8, 1, 8), half);
    assert.equal(history.redo().ok, true);
  }
  world.set(9, 1, 8, UPPER_SLAB);
  assert.deepEqual(slabPlacement(world, target({ x: 1, y: 0, z: 0 })), { x: 9, y: 1, z: 8, block: PLANKS });
  world.set(9, 1, 8, SLAB);
  assert.equal(slabPlacement(world, target({ x: 1, y: 0, z: 0 })), null);
});

test('merging and redo respect player clearance; placement undo restores water', () => {
  const world = ground(), history = new EditHistory(world);
  world.set(8, 1, 8, WATER);
  assert.equal(history.edit(8, 1, 8, SLAB, playerAt(8.5, 1.5)).ok, true);
  assert.equal(history.edit(8, 1, 8, PLANKS, playerAt(8.5, 1.5)).reason, 'blocked');
  assert.equal(history.undo().ok, true);
  assert.equal(world.get(8, 1, 8), WATER);
  assert.equal(history.redo(playerAt()).reason, 'blocked');
  assert.equal(history.redo(playerAt(15)).ok, true);
});

test('walk and sprint climb a staircase of half-block rises on either axis', () => {
  for (const axis of ['x', 'z']) for (const sprint of [false, true]) {
    const world = ground();
    for (let n = 10; n <= 16; n++) {
      const height = (n - 9) * 0.5;
      for (let y = 1; y <= Math.ceil(height); y++) {
        world.set(axis === 'x' ? n : 8, y, axis === 'z' ? n : 8, y > height ? SLAB : PLANKS);
      }
    }
    const player = playerAt();
    let highest = player.y;
    for (let i = 0; i < 150; i++) {
      stepPlayer(player, world, axis === 'x' ? { strafe: 1, sprint } : { forward: -1, sprint }, 1 / 120);
      highest = Math.max(highest, player.y);
      assert.ok(player.vy <= 0, 'climbing requires no jump');
    }
    assert.ok(player[axis] > 14, JSON.stringify(player));
    assert.ok(highest >= 3.5, `never climbed stairs: ${JSON.stringify(player)}`);
  }
});

test('half steps cannot bypass low ceilings, full-block walls, or flight collision', () => {
  for (const fixture of ['ceiling', 'wall', 'flight']) {
    const world = ground(), player = playerAt();
    world.set(10, 1, 8, fixture === 'wall' ? PLANKS : SLAB);
    if (fixture === 'ceiling') for (let x = 8; x <= 11; x++) world.set(x, 3, 8, STONE);
    player.flying = fixture === 'flight';
    advance(player, world, 120, { strafe: 1, sprint: true });
    assert.ok(Math.abs(player.x - 9.7) < 0.00001, `${fixture}: ${JSON.stringify(player)}`);
    assert.equal(player.y, 1);
  }
});

test('stepping down settles on the lower surface and airborne movement does not step up', () => {
  const world = ground();
  world.set(8, 1, 8, SLAB);
  const player = playerAt(8.5, 1.5);
  advance(player, world, 60, { strafe: 1 });
  assert.equal(player.y, 1);
  assert.equal(player.grounded, true);
  world.set(10, 1, 8, SLAB);
  const falling = playerAt(9.7, 1.1);
  falling.grounded = false;
  falling.vy = -1;
  stepPlayer(falling, world, { strafe: 1 }, 1 / 120);
  assert.ok(Math.abs(falling.x - 9.7) < 0.00001);
  assert.ok(falling.y < 1.1);
});

test('falling lands on the actual slab top and upper slabs leave space underneath', () => {
  const world = ground();
  world.set(8, 1, 8, SLAB);
  const player = playerAt(8.5, 8);
  player.grounded = false;
  advance(player, world, 180);
  assert.equal(player.y, 1.5);
  assert.equal(world.surface(8, 8), 1.5);
  assert.equal(overlapsBlock(playerAt(8.5, 1.5), 8, 1, 8, SLAB), false);
  world.set(8, 3, 8, UPPER_SLAB);
  const below = playerAt(8.5, 1.5);
  assert.equal(overlapsBlock(below, 8, 3, 8, UPPER_SLAB), false);
  stepPlayer(below, world, { jump: true }, 1 / 120);
  advance(below, world, 6);
  assert.ok(below.y + 1.75 <= 3.5);
});

test('only upper slabs support doors and lanterns, with atomic support removal', () => {
  const world = ground(), history = new EditHistory(world);
  world.set(8, 1, 8, SLAB);
  assert.equal(history.placeLantern(8, 2, 8).ok, false);
  assert.equal(history.placeDoor(8, 2, 8, 0).ok, false);
  world.set(8, 1, 8, UPPER_SLAB);
  assert.equal(history.placeLantern(8, 2, 8).ok, true);
  assert.equal(history.edit(8, 1, 8, AIR).changes.length, 2);
  assert.equal(world.get(8, 2, 8), AIR);
  assert.equal(history.undo().ok, true);
  assert.equal(world.get(8, 1, 8), UPPER_SLAB);
  assert.equal(world.get(8, 2, 8), LANTERN);
  history.undo();
  assert.equal(history.placeDoor(8, 2, 8, 0).ok, true);
  assert.equal(history.edit(8, 1, 8, AIR).changes.length, 3);
});

test('both half shapes pick at their real surfaces and preserve full-block texture scale', () => {
  for (const half of [SLAB, UPPER_SLAB]) {
    const world = new World({ generate: false });
    world.set(8, 1, 8, half);
    const geometry = buildTerrainGeometry(world), material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(geometry, material);
    geometry.computeBoundingBox();
    const bounds = blockBounds(half, 8, 1, 8);
    assert.equal(geometry.boundingBox.min.y, bounds.minY);
    assert.equal(geometry.boundingBox.max.y, bounds.maxY);
    const ray = new THREE.Raycaster(new THREE.Vector3(8.5, 5, 8.5), new THREE.Vector3(0, -1, 0));
    assert.equal(ray.intersectObject(mesh)[0].point.y, bounds.maxY);
    const uv = geometry.getAttribute('uv'), normals = geometry.getAttribute('normal'), positions = geometry.getAttribute('position');
    const tile = tileUVs(TILES.PLANKS);
    for (let i = 0; i < positions.count; i++) if (normals.getY(i) === 0) {
      assert.ok(Math.abs(uv.getY(i) - (tile[0][1] + (positions.getY(i) - 1) * (tile[2][1] - tile[0][1]))) < 0.000001);
    }
    assert.equal(buildBlock(half), SLAB);
    assert.equal(faceTile(half, 1), TILES.PLANKS);
    geometry.dispose(); material.dispose();
  }
  assert.deepEqual(soundRecipe(UPPER_SLAB, 'step'), soundRecipe(SLAB, 'step'));
});

test('partial neighbors do not hide exposed tops, undersides, or cube faces', () => {
  const cases = [
    [[8, 1, 8, SLAB], [8, 2, 8, STONE], 12], // gap above lower half
    [[8, 2, 8, UPPER_SLAB], [8, 1, 8, STONE], 12], // gap below upper half
    [[8, 1, 8, SLAB], [9, 1, 8, SLAB], 10],
    [[8, 1, 8, SLAB], [9, 1, 8, UPPER_SLAB], 12],
    [[8, 1, 8, SLAB], [9, 1, 8, STONE], 11],
    [[8, 1, 8, UPPER_SLAB], [8, 2, 8, SLAB], 10],
  ];
  for (const [a, b, faces] of cases) {
    const world = new World({ generate: false });
    world.set(...a); world.set(...b);
    const geometry = buildTerrainGeometry(world);
    assert.equal(geometry.index.count, faces * 6, JSON.stringify([a, b]));
    geometry.dispose();
  }
});
