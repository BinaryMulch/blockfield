import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AIR, STONE, GLASS, WATER, DAISY, LANTERN, SLAB, UPPER_SLAB, HEIGHT, World, doorBlock } from '../src/world.js';
import { ChunkWorld } from '../src/chunks.js';
import { LanternLighting } from '../src/lanterns.js';
import { buildLanternField, captureLightBlocks, lightBounds, fieldIndex, LANTERN_RANGE } from '../src/lantern-field.js';

function field(world, position = { x: 8, z: 8 }) {
  const bounds = lightBounds(world, position), blocks = captureLightBlocks(world, bounds);
  const result = buildLanternField({ ...bounds, blocks });
  return { ...result, at(x, y, z) { return result.light[fieldIndex(x - bounds.x, y, z - bounds.z, bounds.width, bounds.height)]; } };
}

function enclosure() {
  const world = new World({ generate: false });
  for (let x = 7; x <= 9; x++) for (let y = 1; y <= 3; y++) for (let z = 7; z <= 9; z++) {
    world.set(x, y, z, STONE);
  }
  world.set(8, 2, 8, LANTERN);
  return world;
}

test('a solid enclosure keeps all lantern light inside, and closing a hole removes outside light', () => {
  const world = enclosure();
  let baked = field(world);
  assert.equal(baked.at(8, 2, 8), 255);
  for (const [x, y, z] of [[10, 2, 8], [6, 2, 8], [8, 4, 8], [8, 0, 8], [8, 2, 6], [8, 2, 10]]) assert.equal(baked.at(x, y, z), 0);
  world.set(9, 2, 8, AIR); baked = field(world);
  assert.ok(baked.at(10, 2, 8) > 0);
  world.set(9, 2, 8, STONE);
  assert.equal(field(world).at(10, 2, 8), 0);
});

test('glass, water, flowers, and open doors transmit light; closed doors block it', () => {
  const world = enclosure();
  for (const block of [GLASS, WATER, DAISY, doorBlock(0, true)]) {
    world.set(9, 2, 8, block);
    assert.ok(field(world).at(10, 2, 8) > 0, `block ${block}`);
  }
  world.set(9, 2, 8, doorBlock(0, false));
  assert.equal(field(world).at(10, 2, 8), 0);
});

test('light spreads around an opening with falloff and cannot pass through a solid wall', () => {
  const world = new World({ generate: false }); world.set(8, 5, 8, LANTERN);
  let baked = field(world);
  assert.ok(baked.at(9, 5, 8) > baked.at(12, 5, 8));
  assert.ok(baked.at(8 + LANTERN_RANGE, 5, 8) > 0);
  assert.equal(baked.at(9 + LANTERN_RANGE, 5, 8), 0);
  for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < 64; z++) world.set(10, y, z, STONE);
  assert.equal(field(world).at(11, 5, 8), 0);
  world.set(10, 5, 9, AIR); baked = field(world);
  assert.ok(baked.at(11, 5, 8) > 0, 'light can travel around the corner of an opening');
});

test('slabs preserve horizontal half-cell passages and block travel through their solid half', () => {
  const width = 7, height = 5, depth = 5, blocks = new Uint8Array(width * height * depth).fill(STONE);
  const set = (x, y, z, block) => { blocks[fieldIndex(x, y, z, width, height)] = block; };
  const at = (result, x, y, z) => result.light[fieldIndex(x, y, z, width, height)];
  for (let x = 1; x <= 5; x++) set(x, 2, 2, AIR);
  set(1, 2, 2, LANTERN); set(3, 2, 2, SLAB); set(3, 1, 2, AIR);
  let result = buildLanternField({ blocks, width, height, depth });
  assert.ok(at(result, 4, 2, 2) > 0); assert.equal(at(result, 3, 1, 2), 0);
  set(3, 2, 2, UPPER_SLAB); set(3, 1, 2, STONE); set(3, 3, 2, AIR);
  result = buildLanternField({ blocks, width, height, depth });
  assert.ok(at(result, 4, 2, 2) > 0); assert.equal(at(result, 3, 3, 2), 0);
});

test('streamed chunks share light across boundaries; unknown chunks stay closed without generating them', () => {
  const world = new ChunkWorld({ seed: 'lighting', generate: false });
  world.putChunk(0, 0, new Uint8Array(16 * 16 * HEIGHT)); world.set(15, 5, 8, LANTERN);
  assert.equal(field(world).at(16, 5, 8), 0); assert.equal(world.chunks.size, 1);
  world.putChunk(1, 0, new Uint8Array(16 * 16 * HEIGHT));
  assert.ok(field(world).at(16, 5, 8) > 0); assert.equal(world.chunks.size, 2);
  const bounds = lightBounds(world, { x: 256, z: 256 });
  assert.ok(bounds.width <= 144 && bounds.depth <= 144 && bounds.height === 32);
  assert.equal(captureLightBlocks(world, bounds).byteLength, 144 * 144 * 32);
});

test('many sources use strongest-path lighting without overflow and top-level lanterns illuminate open air', () => {
  const world = new World({ generate: false });
  for (let x = 4; x < 24; x++) world.set(x, 5, 8, LANTERN);
  world.set(8, 23, 8, LANTERN);
  const result = field(world);
  assert.equal(result.sources, 21); assert.equal(result.at(8, 5, 8), 255);
  assert.ok(result.at(8, 24, 8) > 0);
});

test('stale worker results cannot restore lighting after an edit or world switch', async () => {
  const world = enclosure(), requests = [];
  const jobs = { call(job) { return new Promise(resolve => requests.push({ job, resolve })); }, dispose() {} };
  const lighting = new LanternLighting(new THREE.Scene(), world, { jobs });
  const pending = lighting.update(0, { x: 8, z: 8 }, 0);
  world.set(8, 2, 8, AIR); lighting.sync(world);
  requests[0].resolve(buildLanternField(requests[0].job)); await pending;
  assert.equal(lighting.sourceCount, 0);
  assert.equal(lighting.uniforms.lanternField.value.image.width, 1);
  assert.equal(lighting.uniforms.lanternField.value.image.data[0], 0);
  lighting.dispose();
});

test('idle lighting is cached and material shaders share one field including instanced meshes', async () => {
  const world = enclosure(); let calls = 0;
  const jobs = { call(job) { calls++; return Promise.resolve(buildLanternField(job)); }, dispose() {} };
  const lighting = new LanternLighting(new THREE.Scene(), world, { jobs });
  await lighting.update(0, { x: 8, z: 8 }, 0);
  for (let i = 0; i < 100; i++) await lighting.update(1 / 60, { x: 8.01, z: 8.01 }, 1);
  assert.equal(calls, 1);
  const material = new THREE.MeshLambertMaterial(); lighting.applyMaterial(material);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.lanternField, lighting.uniforms.lanternField);
  assert.match(shader.vertexShader, /instanceMatrix \* lanternPosition/);
  assert.match(shader.fragmentShader, /sampler3D lanternField/);
  assert.match(shader.fragmentShader, /floor\(vLanternPosition/);
  material.dispose(); lighting.dispose();
});
