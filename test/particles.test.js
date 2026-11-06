import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, BRICKS, PLANKS } from '../src/world.js';
import { TILE_SIZE, TILES, generateTextureTiles } from '../src/textures.js';
import { BlockParticles } from '../src/particles.js';

function effects() {
  return new BlockParticles(new THREE.Scene(), { capacity: 32, random: () => 0.5 });
}
function dispose(particles) {
  particles.mesh.geometry.dispose();
  particles.mesh.material.dispose();
  particles.mesh.dispose();
}

test('breaking chips sample material colors, move, and disappear after their lifetime', () => {
  const particles = effects();
  const world = new World({ generate: false });
  particles.burst(4, 3, 4, BRICKS);
  assert.equal(particles.activeCount, 16);
  const pixel = Math.floor(0.5 * TILE_SIZE * TILE_SIZE) * 4;
  const tile = generateTextureTiles()[TILES.BRICKS];
  const expected = new THREE.Color().setRGB(tile[pixel] / 255, tile[pixel + 1] / 255, tile[pixel + 2] / 255, THREE.SRGBColorSpace);
  const color = new THREE.Color();
  particles.mesh.getColorAt(0, color);
  assert.ok(Math.abs(color.r - expected.r) < 0.000001);
  assert.ok(Math.abs(color.g - expected.g) < 0.000001);
  const startY = particles.pool[0].y;
  particles.update(1 / 60, world);
  assert.ok(particles.pool[0].y > startY);
  assert.equal(particles.mesh.visible, true);
  assert.ok(particles.mesh.instanceMatrix.array.every(Number.isFinite));
  particles.update(1, world);
  assert.equal(particles.activeCount, 0);
  assert.equal(particles.mesh.visible, false);
  dispose(particles);
});

test('rapid breaking reuses a bounded particle pool and the same geometry', () => {
  const particles = effects();
  const geometry = particles.mesh.geometry;
  for (let i = 0; i < 100; i++) particles.burst(i, 3, 4, i % 2 ? PLANKS : BRICKS);
  assert.equal(particles.activeCount, 32);
  assert.equal(particles.pool.length, 32);
  assert.equal(particles.mesh.instanceMatrix.count, 32);
  assert.equal(particles.mesh.geometry, geometry);
  particles.update(1, new World({ generate: false }));
  assert.equal(particles.activeCount, 0);
  dispose(particles);
});

test('particles stay still when paused and stop when a block is restored around them', () => {
  const particles = effects();
  const world = new World({ generate: false });
  particles.burst(4, 3, 4, BRICKS);
  const before = { ...particles.pool[0] };
  particles.update(0, world);
  assert.deepEqual(particles.pool[0], before);
  world.set(4, 3, 4, BRICKS);
  particles.update(0.01, world);
  assert.equal(particles.activeCount, 0);
  dispose(particles);
});
