import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, SIZE, HEIGHT, AIR, GRASS, DIRT, STONE, SAND, WATER, PLANKS, LANTERN, SLAB, RED_FLOWER, YELLOW_FLOWER, DAISY, FLOWER_TYPES, FLOWER_COLORS, isFlower, isSolid, isOpaque, isSupport, buildBlock, blockBounds, stepPlayer } from '../src/world.js';
import { EditHistory } from '../src/history.js';
import { buildTerrainGeometry, buildFlowerGeometry } from '../src/terrain.js';
import { slabPlacement } from '../src/slabs.js';
import { BlockParticles } from '../src/particles.js';
import { synthesizeSound } from '../src/sound.js';

function setup() {
  const world = new World({ generate: false });
  world.set(8, 0, 8, STONE);
  world.set(8, 1, 8, GRASS);
  return { world, history: new EditHistory(world) };
}

test('natural flowers are repeatable, rooted in dry grass, and leave spawn clear', () => {
  const world = new World();
  const counts = new Map(FLOWER_TYPES.map(block => [block, 0]));
  for (let y = 1; y < HEIGHT; y++) for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    const block = world.get(x, y, z);
    if (!isFlower(block)) continue;
    counts.set(block, counts.get(block) + 1);
    assert.equal(world.get(x, y - 1, z), GRASS);
    assert.equal(world.get(x, y + 1, z), AIR);
    assert.equal(world.surface(x, z), y, 'flowers must not raise the walking/spawn surface');
    assert.ok(Math.hypot(x - 32, z - 46) >= 2.5);
  }
  assert.ok([...counts.values()].every(n => n > 10), JSON.stringify([...counts]));
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  assert.ok(total > 50 && total < 400, `expected sparse patches, got ${total}`);
  assert.deepEqual(world.blocks, new World().blocks);
});

test('all flower varieties are pickable decorations and cannot support fixtures', () => {
  for (const block of FLOWER_TYPES) {
    assert.equal(isSolid(block), false);
    assert.equal(isOpaque(block), false);
    assert.equal(isSupport(block), false);
    assert.equal(buildBlock(block), block);
    assert.equal(blockBounds(block, 8, 2, 8).maxY, 2.64);
  }
});

test('planting needs dry grass or dirt and can overlap the player without losing history', () => {
  for (const soil of [GRASS, DIRT, STONE, SAND]) {
    const { world, history } = setup();
    world.set(8, 1, 8, soil);
    const result = history.placeFlower(8, 2, 8, RED_FLOWER, { x: 8.5, y: 2, z: 8.5 });
    assert.equal(result.ok, [GRASS, DIRT].includes(soil));
    assert.equal(history.undoStack.length, result.ok ? 1 : 0);
    if (result.ok) {
      history.undo();
      assert.equal(world.get(8, 2, 8), AIR);
      assert.equal(history.redo({ x: 8.5, y: 2, z: 8.5 }).ok, true);
    }
  }
  const { world, history } = setup();
  world.set(8, 2, 8, WATER);
  assert.equal(history.placeFlower(8, 2, 8, RED_FLOWER).reason, 'occupied');
  world.set(8, 2, 8, STONE);
  assert.equal(history.placeFlower(8, 2, 8, DAISY).reason, 'occupied');
  assert.equal(history.placeFlower(8, 0, 8, DAISY).ok, false);
  assert.equal(history.placeFlower(8, HEIGHT, 8, DAISY).ok, false);
  assert.equal(history.placeFlower(8, 2, 8, PLANKS).reason, 'invalid');
});

test('changing flower variety undoes and redoes without accepting duplicate edits', () => {
  const { world, history } = setup();
  for (const block of FLOWER_TYPES) assert.equal(history.placeFlower(8, 2, 8, block).ok, true);
  assert.equal(history.placeFlower(8, 2, 8, DAISY).reason, 'unchanged');
  assert.equal(history.undoStack.length, 3);
  for (const block of [YELLOW_FLOWER, RED_FLOWER, AIR]) {
    assert.equal(history.undo().ok, true);
    assert.equal(world.get(8, 2, 8), block);
  }
  for (const block of FLOWER_TYPES) {
    assert.equal(history.redo().ok, true);
    assert.equal(world.get(8, 2, 8), block);
  }
});

test('soil removal and restoration are atomic while grass-to-dirt edits preserve flowers', () => {
  const { world, history } = setup();
  history.placeFlower(8, 2, 8, DAISY);
  assert.equal(history.edit(8, 1, 8, DIRT).changes.length, 1);
  assert.equal(world.get(8, 2, 8), DAISY);
  assert.equal(history.edit(8, 1, 8, STONE).changes.length, 2);
  assert.equal(world.get(8, 2, 8), AIR);
  assert.equal(history.undo().ok, true);
  assert.equal(world.get(8, 1, 8), DIRT);
  assert.equal(world.get(8, 2, 8), DAISY);
  history.edit(8, 1, 8, AIR);
  assert.equal(history.undo({ x: 8.5, y: 1, z: 8.5 }).reason, 'blocked');
  assert.equal(world.get(8, 1, 8), AIR);
  assert.equal(world.get(8, 2, 8), AIR);
  assert.equal(history.undo({ x: 12, y: 1, z: 8.5 }).ok, true);
  assert.equal(world.get(8, 2, 8), DAISY);
  assert.equal(history.redo().ok, true);
  assert.equal(world.get(8, 2, 8), AIR);
});

test('blocks, slabs, lanterns, and doors can replace flowers and undo restores the variety', () => {
  for (const replacement of ['block', 'slab', 'lantern', 'door']) {
    const { world, history } = setup();
    history.placeFlower(8, 2, 8, YELLOW_FLOWER);
    let result;
    if (replacement === 'lantern') result = history.placeLantern(8, 2, 8);
    else if (replacement === 'door') result = history.placeDoor(8, 2, 8, 0);
    else if (replacement === 'slab') {
      const edit = slabPlacement(world, { x: 8, y: 2, z: 8 });
      assert.equal(edit.block, SLAB);
      result = history.edit(edit.x, edit.y, edit.z, edit.block);
    } else result = history.edit(8, 2, 8, PLANKS);
    assert.equal(result.ok, true, replacement);
    assert.equal(history.undo().ok, true);
    assert.equal(world.get(8, 2, 8), YELLOW_FLOWER);
    assert.equal(world.get(8, 3, 8), AIR);
    assert.equal(history.redo().ok, true);
    assert.equal(isFlower(world.get(8, 2, 8)), false);
  }
});

test('flower rows do not obstruct walking, sprinting, flying, or landing', () => {
  const world = new World({ generate: false });
  for (let z = 0; z < 24; z++) {
    world.set(8, 0, z, GRASS);
    world.set(8, 1, z, FLOWER_TYPES[z % 3]);
  }
  for (const flying of [false, true]) {
    const player = { x: 8.5, y: 1, z: 18.5, vy: 0, grounded: !flying, flying };
    for (let i = 0; i < 120; i++) stepPlayer(player, world, { forward: 1, sprint: true }, 1 / 120);
    assert.ok(Math.abs(player.z - (18.5 - (flying ? 10 : 7.5))) < 0.00001);
    assert.equal(player.y, 1);
  }
  const falling = { x: 8.5, y: 8, z: 8.5, vy: 0, grounded: false };
  for (let i = 0; i < 180; i++) stepPlayer(falling, world, {}, 1 / 120);
  assert.equal(falling.y, 1);
});

test('flower models have colored petals, real picking surfaces, and do not hide the soil', () => {
  const palettes = new Set();
  for (const block of FLOWER_TYPES) {
    const world = new World({ generate: false });
    world.set(8, 1, 8, GRASS); world.set(8, 2, 8, block);
    const geometry = buildFlowerGeometry(world), terrain = buildTerrainGeometry(world);
    assert.equal(terrain.index.count, 36);
    assert.equal(geometry.index.count, 8 * 36);
    geometry.computeBoundingBox();
    const bounds = blockBounds(block, 8, 2, 8);
    assert.ok(Math.abs(geometry.boundingBox.max.y - bounds.maxY) < 0.00001);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
    const ray = new THREE.Raycaster(new THREE.Vector3(8.5, 5, 8.5), new THREE.Vector3(0, -1, 0));
    assert.ok(Math.abs(ray.intersectObject(mesh)[0].point.y - bounds.maxY) < 0.00001);
    assert.ok(geometry.getAttribute('color').array.every(Number.isFinite));
    palettes.add(Buffer.from(geometry.getAttribute('color').array.buffer).toString('base64'));
    geometry.dispose(); terrain.dispose(); mesh.material.dispose();
  }
  assert.equal(palettes.size, 3);
});

test('flower breaking uses small colored bursts and all varieties share a soft sound', () => {
  for (const block of FLOWER_TYPES) {
    const particles = new BlockParticles(new THREE.Scene(), { random: () => 0.5 });
    particles.burst(8, 2, 8, block);
    assert.equal(particles.activeCount, 8);
    const actual = new THREE.Color();
    particles.mesh.getColorAt(0, actual);
    const expected = new THREE.Color(FLOWER_COLORS[block].petals);
    assert.ok(Math.abs(actual.r - expected.r) < 0.000001);
    assert.ok(particles.pool[0].y < 2.64);
    assert.deepEqual(synthesizeSound(block, 'place', 44100), synthesizeSound(RED_FLOWER, 'place', 44100));
    particles.mesh.geometry.dispose(); particles.mesh.material.dispose(); particles.mesh.dispose();
  }
});
