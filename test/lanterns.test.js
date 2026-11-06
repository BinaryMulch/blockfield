import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, AIR, STONE, WATER, LANTERN, isBlock, isDoor, isSupport, blockBounds, stepPlayer } from '../src/world.js';
import { EditHistory } from '../src/history.js';
import { buildTerrainGeometry, buildLanternGeometry } from '../src/terrain.js';
import { LanternLighting, MAX_LANTERN_LIGHTS, nearestLanterns } from '../src/lanterns.js';

function setup() {
  const world = new World({ generate: false });
  world.set(8, 0, 8, STONE);
  return { world, history: new EditHistory(world) };
}

test('lantern IDs stay separate from all encoded door states', () => {
  assert.equal(isBlock(LANTERN), true);
  assert.equal(isDoor(LANTERN), false);
  assert.equal(isSupport(LANTERN), false);
});

test('lanterns require clear space and full support, and cannot support stacked fixtures', () => {
  const { world, history } = setup();
  assert.equal(history.placeLantern(9, 1, 8).ok, false);
  assert.equal(history.placeLantern(8, 1, 8).ok, true);
  assert.equal(history.placeLantern(8, 1, 8).reason, 'occupied');
  assert.equal(history.placeLantern(8, 2, 8).ok, false);
  assert.equal(history.placeDoor(8, 2, 8, 0).ok, false);
  assert.equal(world.get(8, 2, 8), AIR);
  assert.equal(history.undoStack.length, 1);
});

test('removing support and restoring a lantern are atomic and respect the player', () => {
  const { world, history } = setup();
  world.set(8, 1, 8, STONE);
  history.placeLantern(8, 2, 8);
  assert.equal(history.edit(8, 1, 8, AIR).changes.length, 2);
  assert.equal(world.get(8, 2, 8), AIR);
  assert.equal(history.undo({ x: 8.5, y: 2, z: 8.5 }).reason, 'blocked');
  assert.equal(world.get(8, 1, 8), AIR);
  assert.equal(world.get(8, 2, 8), AIR);
  assert.equal(history.undo({ x: 12, y: 2, z: 12 }).ok, true);
  assert.equal(world.get(8, 1, 8), STONE);
  assert.equal(world.get(8, 2, 8), LANTERN);
  assert.equal(history.redo().ok, true);
  assert.equal(world.get(8, 1, 8), AIR);
  assert.equal(world.get(8, 2, 8), AIR);
});

test('undo restores replaced water and the small collision shape leaves its cell corners free', () => {
  const { world, history } = setup();
  world.set(8, 1, 8, WATER);
  assert.equal(history.placeLantern(8, 1, 8, { x: 7.9, y: 1, z: 8.5 }).ok, true);
  assert.equal(history.undo().ok, true);
  assert.equal(world.get(8, 1, 8), WATER);
  assert.equal(history.redo({ x: 8.5, y: 1, z: 8.5 }).reason, 'blocked');
  assert.equal(history.redo().ok, true);
  const player = { x: 8.5, y: 1, z: 10.5, vy: 0, grounded: true, flying: true };
  for (let i = 0; i < 120; i++) stepPlayer(player, world, { forward: 1 }, 1 / 120);
  assert.ok(Math.abs(player.z - 9.05) < 0.00001);
});

test('lantern geometry includes a handle, shares collision bounds, and leaves the support face intact', () => {
  const { world, history } = setup();
  history.placeLantern(8, 1, 8);
  const solid = buildTerrainGeometry(world), lantern = buildLanternGeometry(world);
  assert.equal(solid.index.count, 6 * 6);
  assert.equal(lantern.index.count, 4 * 6 * 6);
  lantern.computeBoundingBox();
  const bounds = blockBounds(LANTERN, 8, 1, 8);
  for (const [actual, expected] of [[lantern.boundingBox.min.toArray(), [bounds.minX, bounds.minY, bounds.minZ]], [lantern.boundingBox.max.toArray(), [bounds.maxX, bounds.maxY, bounds.maxZ]]]) {
    assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) < 0.00001));
  }
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(lantern, material);
  const ray = new THREE.Raycaster(new THREE.Vector3(8.5, 1.35, 11), new THREE.Vector3(0, 0, -1));
  assert.ok(Math.abs(ray.intersectObject(mesh)[0].distance - 2.25) < 0.00001);
  assert.equal(lantern.getAttribute('uv').count, lantern.getAttribute('position').count);
  solid.dispose(); lantern.dispose(); material.dispose();
});

test('nearby light selection is deterministic and never mutates the source list', () => {
  const sources = [{ index: 2, x: 0, y: 1, z: 0 }, { index: 1, x: 0, y: 1, z: 0 }, { index: 3, x: 10, y: 1, z: 0 }];
  assert.deepEqual(nearestLanterns(sources, { x: 0.5, y: 1.45, z: 0.5 }, 2).map(source => source.index), [1, 2]);
  assert.deepEqual(sources.map(source => source.index), [2, 1, 3]);
});

test('many lanterns reuse a fixed light pool, follow the player, and brighten at night', () => {
  const world = new World({ generate: false });
  for (let x = 2; x <= 40; x += 2) world.set(x, 1, 8, LANTERN);
  const scene = new THREE.Scene(), lighting = new LanternLighting(scene, world);
  const nodes = lighting.lights.map(light => light.uuid);
  lighting.update(0, new THREE.Vector3(2.5, 2.6, 8.5), 1);
  assert.equal(lighting.sources.length, 20);
  assert.equal(lighting.activeSources.length, MAX_LANTERN_LIGHTS);
  assert.equal(lighting.activeSources[0].x, 2);
  const dayIntensity = lighting.lights[0].intensity;
  lighting.update(0.2, new THREE.Vector3(40.5, 2.6, 8.5), 0);
  assert.equal(lighting.activeSources[0].x, 40);
  assert.ok(lighting.lights[0].intensity > dayIntensity);
  assert.deepEqual(lighting.lights.map(light => light.uuid), nodes);
  assert.equal(lighting.group.children.length, MAX_LANTERN_LIGHTS);
  assert.ok(lighting.lights.every(light => !light.castShadow && light.distance === 8));
});

test('light synchronization follows placement, undo, redo, and support removal', () => {
  const { world, history } = setup();
  world.set(8, 1, 8, STONE);
  const lighting = new LanternLighting(new THREE.Scene(), world);
  const sync = () => { lighting.sync(world); lighting.update(0, new THREE.Vector3(8.5, 3, 10), 0); };
  history.placeLantern(8, 2, 8); sync();
  assert.equal(lighting.activeSources.length, 1);
  assert.ok(lighting.lights[0].intensity > 0);
  history.undo(); sync();
  assert.equal(lighting.activeSources.length, 0);
  assert.ok(lighting.lights.every(light => light.intensity === 0));
  history.redo(); sync();
  assert.equal(lighting.activeSources.length, 1);
  history.edit(8, 1, 8, AIR); sync();
  assert.equal(lighting.activeSources.length, 0);
  history.undo(); sync();
  assert.equal(lighting.activeSources.length, 1);
});
