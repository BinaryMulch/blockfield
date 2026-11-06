import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, SIZE, HEIGHT, AIR, STONE, SAND, WATER, BRICKS, GLASS, DOOR, doorBlock, blockBounds, buildBlock, overlapsBlock, stepPlayer } from '../src/world.js';
import { EditHistory } from '../src/history.js';
import { buildTerrainGeometry, buildGlassGeometry } from '../src/terrain.js';
import { TILES, generateTextureTiles } from '../src/textures.js';

function floor() {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  return world;
}
function move(player, world, input) {
  for (let frame = 0; frame < 120; frame++) stepPlayer(player, world, input, 1 / 120);
}

test('two-block door placement, toggling either half, and breaking replay atomically', () => {
  const world = floor(), history = new EditHistory(world);
  assert.equal(history.placeDoor(8, 1, 8, 0).changes.length, 2);
  assert.equal(world.doorAt(8, 2, 8).y, 1);
  assert.equal(world.doors().length, 1);
  assert.equal(history.undo().ok, true);
  assert.equal(world.get(8, 1, 8), AIR);
  assert.equal(world.get(8, 2, 8), AIR);
  history.redo();
  history.toggleDoor(8, 2, 8);
  assert.equal(world.doorAt(8, 1, 8).open, true);
  history.undo();
  assert.equal(world.doorAt(8, 2, 8).open, false);
  history.redo();
  assert.equal(history.edit(8, 2, 8, AIR).changes.length, 2);
  assert.equal(world.get(8, 1, 8), AIR);
  assert.equal(world.get(8, 2, 8), AIR);
  history.undo();
  assert.equal(world.doorAt(8, 1, 8).open, true);
  assert.equal(buildBlock(world.get(8, 2, 8)), DOOR);
});

test('blocked or unsupported placements and ceiling limits never leave half a door', () => {
  const world = new World({ generate: false }), history = new EditHistory(world);
  assert.equal(history.placeDoor(8, 2, 8, 0).ok, false);
  world.set(8, 1, 8, STONE);
  world.set(8, 3, 8, BRICKS);
  assert.equal(history.placeDoor(8, 2, 8, 0).ok, false);
  assert.equal(world.get(8, 2, 8), AIR);
  assert.equal(world.get(8, 3, 8), BRICKS);
  world.set(8, 3, 8, AIR);
  world.set(8, HEIGHT - 2, 8, STONE);
  assert.equal(history.placeDoor(8, HEIGHT - 1, 8, 0).ok, false);
  assert.equal(world.get(8, HEIGHT - 1, 8), AIR);
  assert.equal(history.undoStack.length, 0);
});

test('removing a support removes both halves and undo restores the entire structure', () => {
  const world = floor(), history = new EditHistory(world);
  world.set(8, 1, 8, GLASS);
  history.placeDoor(8, 2, 8, 2);
  assert.equal(history.edit(8, 1, 8, AIR).changes.length, 3);
  for (const y of [1, 2, 3]) assert.equal(world.get(8, y, 8), AIR);
  history.undo();
  assert.equal(world.get(8, 1, 8), GLASS);
  assert.equal(world.doorAt(8, 3, 8).facing, 2);
});

test('door swings and undo refuse to overlap the player without losing history', () => {
  const world = floor(), history = new EditHistory(world);
  history.placeDoor(8, 1, 8, 0);
  const player = { x: 8.2, y: 1, z: 8.45 };
  assert.equal(overlapsBlock(player, 8, 1, 8, doorBlock(0)), false);
  assert.equal(history.toggleDoor(8, 1, 8, player).reason, 'blocked');
  assert.equal(world.doorAt(8, 1, 8).open, false);
  assert.equal(history.undoStack.length, 1);
  player.x = 8.5; player.z = 9.5;
  assert.equal(history.toggleDoor(8, 1, 8, player).ok, true);
  player.z = 8.95;
  assert.equal(history.toggleDoor(8, 1, 8, player).reason, 'blocked');
  assert.equal(history.undo(player).reason, 'blocked');
  assert.equal(world.doorAt(8, 2, 8).open, true);
  assert.equal(history.undoStack.length, 2);
});

test('closed doors block movement and open doors permit passage in all orientations', () => {
  const cases = [
    { facing: 0, x: 8.5, z: 10.5, input: { forward: 1 }, axis: 'z', stopped: 9.3 },
    { facing: 1, x: 6.5, z: 8.5, input: { strafe: 1 }, axis: 'x', stopped: 7.7 },
    { facing: 2, x: 8.5, z: 6.5, input: { forward: -1 }, axis: 'z', stopped: 7.7 },
    { facing: 3, x: 10.5, z: 8.5, input: { strafe: -1 }, axis: 'x', stopped: 9.3 },
  ];
  for (const c of cases) {
    const world = floor(), history = new EditHistory(world);
    history.placeDoor(8, 1, 8, c.facing);
    const player = { x: c.x, y: 1, z: c.z, vy: 0, grounded: true };
    move(player, world, c.input);
    assert.ok(Math.abs(player[c.axis] - c.stopped) < 0.00001);
    assert.equal(history.toggleDoor(8, 1, 8, player).ok, true);
    const before = player[c.axis];
    move(player, world, c.input);
    assert.ok(Math.abs(player[c.axis] - before) > 4);
    assert.equal(player.y, 1);
  }
});

test('a conflicted upper half prevents every part of an undo from changing', () => {
  const world = floor(), history = new EditHistory(world);
  history.placeDoor(8, 1, 8, 0);
  world.set(8, 2, 8, STONE);
  const bottom = world.get(8, 1, 8);
  assert.equal(history.undo().reason, 'changed');
  assert.equal(world.get(8, 1, 8), bottom);
  assert.equal(world.get(8, 2, 8), STONE);
  assert.equal(history.undoStack.length, 1);
});

test('door rendering uses the same thin panel bounds as movement', () => {
  for (let facing = 0; facing < 4; facing++) for (const open of [false, true]) {
    const world = new World({ generate: false });
    const block = doorBlock(facing, open);
    world.set(8, 1, 8, block);
    world.set(8, 2, 8, doorBlock(facing, open, true));
    const geometry = buildTerrainGeometry(world);
    geometry.computeBoundingBox();
    const b = blockBounds(block, 8, 1, 8);
    assert.deepEqual(geometry.boundingBox.min.toArray(), [b.minX, 1, b.minZ]);
    assert.deepEqual(geometry.boundingBox.max.toArray(), [b.maxX, 3, b.maxZ]);
    assert.equal(geometry.index.count, 10 * 6);
    assert.ok(geometry.getAttribute('uv').array.every(Number.isFinite));
    geometry.dispose();
  }
});

test('glass exposes the wall behind it, remains pickable, and has a faint center with visible edges', () => {
  const world = new World({ generate: false });
  world.set(8, 1, 8, BRICKS);
  world.set(8, 1, 9, GLASS);
  const terrainGeometry = buildTerrainGeometry(world), glassGeometry = buildGlassGeometry(world);
  assert.equal(terrainGeometry.index.count, 6 * 6);
  assert.equal(glassGeometry.index.count, 5 * 6);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const terrain = new THREE.Mesh(terrainGeometry, material), glass = new THREE.Mesh(glassGeometry, material);
  const ray = new THREE.Raycaster(new THREE.Vector3(8.5, 1.5, 12), new THREE.Vector3(0, 0, -1));
  assert.equal(ray.intersectObjects([terrain, glass])[0].object, glass);
  const tile = generateTextureTiles()[TILES.GLASS];
  assert.ok(tile[3] > tile[(7 + 7 * 16) * 4 + 3]);
  terrainGeometry.dispose(); glassGeometry.dispose(); material.dispose();
});

test('glass stays solid for walking and flying', () => {
  const world = floor();
  world.set(8, 1, 8, GLASS);
  world.set(8, 2, 8, GLASS);
  for (const flying of [false, true]) {
    const player = { x: 8.5, y: 1, z: 10.5, vy: 0, grounded: !flying, flying };
    move(player, world, { forward: 1 });
    assert.ok(Math.abs(player.z - 9.3) < 0.00001);
  }
});

test('invalid cells in a transaction cannot partially apply earlier valid cells', () => {
  const world = floor(), history = new EditHistory(world);
  const result = history.commit([
    { x: 8, y: 1, z: 8, before: AIR, after: BRICKS },
    { x: 8, y: 2, z: 8, before: AIR, after: 255 },
  ]);
  assert.equal(result.ok, false);
  assert.equal(world.get(8, 1, 8), AIR);
  assert.equal(history.undoStack.length, 0);
});

test('undoing a door placed in shallow water restores both original cell contents', () => {
  const world = floor(), history = new EditHistory(world);
  world.set(8, 1, 8, SAND);
  world.set(8, 2, 8, WATER);
  assert.equal(history.placeDoor(8, 2, 8, 1).ok, true);
  assert.equal(history.undo().ok, true);
  assert.equal(world.get(8, 2, 8), WATER);
  assert.equal(world.get(8, 3, 8), AIR);
  assert.equal(history.redo().ok, true);
  assert.equal(world.doorAt(8, 3, 8).facing, 1);
});
