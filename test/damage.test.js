import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, AIR, CONCRETE, REINFORCED_PANEL, SECURITY_DOOR, STORAGE_CABINET, doorBlock } from '../src/world.js';
import { ChunkWorld } from '../src/chunks.js';
import { buildChunkGeometry } from '../src/terrain.js';
import { ChunkRenderer } from '../src/chunk-renderer.js';
import { MultiplayerClient } from '../src/multiplayer.js';
import { LanternLighting } from '../src/lanterns.js';
import { TILE_SIZE, TILE_PADDING, TILE_STRIDE, ATLAS_HEIGHT } from '../src/textures.js';
import { DamageState, damageStage, damageVariant, damageIndex, damageMaskPixel, createDamageTexture, generateDamageAtlas, applyDamageMaterial, DAMAGE_ATLAS_WIDTH, DAMAGE_ATLAS_HEIGHT, DAMAGE_STRIDE, DAMAGE_PADDING } from '../src/damage.js';

const p = { x: 5, y: 3, z: 5, block: REINFORCED_PANEL }, key = '0,0';
function geometryFor(world) {
  const result = buildChunkGeometry(world, 0, 0);
  for (const [mode, geometry] of Object.entries(result)) if (mode !== 'solid') geometry.dispose();
  return result.solid;
}
function bind(state, world) { const geometry = geometryFor(world); state.bind(key, geometry, geometry.userData.damageRanges); return geometry; }

test('material damage has three stable stages and deterministic spatial variations', () => {
  assert.equal(damageStage(CONCRETE, 2), 0); assert.equal(damageStage(CONCRETE, 1), 2);
  assert.deepEqual([4, 3, 2, 1].map(hp => damageStage(REINFORCED_PANEL, hp)), [0, 1, 2, 3]);
  assert.deepEqual([5, 4, 3, 2, 1].map(hp => damageStage(SECURITY_DOOR, hp)), [0, 1, 2, 2, 3]);
  assert.equal(damageStage(STORAGE_CABINET, 1), 2);
  assert.equal(damageVariant(5, 3, 5), damageVariant(5, 3, 5));
  assert.ok(new Set(Array.from({ length: 20 }, (_, x) => damageVariant(x, 3, 5))).size > 1);
});

test('32px wear masks are deterministic, distinct, increasingly visible, and isolated by padded borders', () => {
  const atlas = generateDamageAtlas(); assert.deepEqual(atlas, generateDamageAtlas());
  assert.ok(atlas.byteLength < 512 * 1024);
  const signatures = new Set();
  for (let style = 0; style < 3; style++) for (let variant = 0; variant < 4; variant++) {
    let previous = 0;
    for (let stage = 0; stage < 4; stage++) {
      const pixels = []; let visible = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const pixel = damageMaskPixel(style, variant, stage, x, y); pixels.push(...pixel);
        if (pixel.slice(0, 3).some(Boolean)) visible++;
      }
      if (!stage) assert.equal(visible, 0);
      else { assert.ok(visible > previous); signatures.add(Buffer.from(pixels).toString('base64')); }
      previous = visible;
      const offset = ((style * 4 + variant) * DAMAGE_STRIDE * DAMAGE_ATLAS_WIDTH + stage * DAMAGE_STRIDE) * 4;
      assert.deepEqual([...atlas.slice(offset, offset + 4)], damageMaskPixel(style, variant, stage, 0, 0));
    }
  }
  assert.equal(signatures.size, 36);
  const texture = createDamageTexture(); assert.equal(texture.image.width, DAMAGE_ATLAS_WIDTH); assert.equal(texture.image.height, DAMAGE_ATLAS_HEIGHT);
  assert.equal(texture.magFilter, THREE.NearestFilter); assert.equal(texture.minFilter, THREE.NearestFilter); assert.equal(texture.generateMipmaps, false); texture.dispose();
});

test('hits and repairs update only affected vertex ranges without remeshing or touching enclosure data', () => {
  const world = new World({ generate: false }); world.set(p.x, p.y, p.z, p.block); world.set(7, 3, 5, CONCRETE);
  const state = new DamageState(world), geometry = bind(state, world);
  const positions = geometry.attributes.position.array.slice(), indices = geometry.index.array.slice(), uv = geometry.attributes.uv.array.slice(), serial = world.serial;
  const attribute = geometry.attributes.damageData, ranges = geometry.userData.damageRanges.get(damageIndex(p.x, p.y, p.z, p.block));
  for (const [remaining, stage] of [[3, 1], [2, 2], [1, 3], [4, 0]]) {
    attribute.clearUpdateRanges(); state.set({ ...p, remaining });
    assert.equal(attribute.updateRanges.length, 1);
    assert.deepEqual(attribute.updateRanges[0], { start: ranges[0].start * 3, count: ranges[0].count * 3 });
    assert.equal(state.remaining(p.x, p.y, p.z, p.block), remaining);
    for (let i = 0; i < attribute.count; i++) assert.equal(attribute.getX(i), i >= ranges[0].start && i < ranges[0].start + ranges[0].count ? stage : 0);
  }
  assert.equal(state.chunks.size, 0); assert.equal(world.serial, serial);
  assert.deepEqual(geometry.attributes.position.array, positions); assert.deepEqual(geometry.index.array, indices); assert.deepEqual(geometry.attributes.uv.array, uv);
  assert.equal(attribute.array.byteLength, geometry.attributes.position.count * 3); geometry.dispose();
});

test('door damage covers both halves with a continuous pattern through facing and open-state changes', () => {
  for (let facing = 0; facing < 4; facing++) for (const open of [false, true]) {
    const world = new World({ generate: false }), state = new DamageState(world);
    const bottom = doorBlock(facing, open, false, SECURITY_DOOR), top = doorBlock(facing, open, true, SECURITY_DOOR);
    world.set(5, 3, 5, bottom); world.set(5, 4, 5, top);
    state.setChunk(key, [{ ...p, block: SECURITY_DOOR, remaining: 1 }]);
    const geometry = bind(state, world), attribute = geometry.attributes.damageData, uv = geometry.attributes.uv;
    const ranges = geometry.userData.damageRanges.get(damageIndex(5, 4, 5, top)); assert.equal(ranges.length, 2);
    assert.equal(damageIndex(5, 4, 5, top), damageIndex(5, 3, 5, bottom));
    const rows = new Set();
    for (const [half, range] of ranges.entries()) for (let v = range.start; v < range.start + range.count; v++) {
      assert.equal(attribute.getX(v), 3); rows.add(attribute.getY(v)); assert.equal(attribute.getZ(v), half + 1);
      const localY = (((1 - uv.getY(v)) * ATLAS_HEIGHT) % TILE_STRIDE - TILE_PADDING) / TILE_SIZE;
      const doorY = (localY + (half === 0 ? 1 : 0)) / 2;
      assert.ok(half === 0 ? doorY >= .5 && doorY <= 1 : doorY >= 0 && doorY <= .5);
    }
    assert.equal(rows.size, 1); assert.equal(state.remaining(5, 4, 5, top), 1);
    state.set({ ...p, block: SECURITY_DOOR, remaining: 5 });
    for (let v = 0; v < attribute.count; v++) assert.equal(attribute.getX(v), 0);
    geometry.dispose();
  }
});

test('chunk snapshots replace stale damage and destroyed or replaced blocks clear wear', () => {
  const world = new World({ generate: false }); world.set(p.x, p.y, p.z, p.block);
  const state = new DamageState(world), geometry = bind(state, world);
  state.setChunk(key, [{ ...p, remaining: 1 }, { ...p, x: 32, remaining: 1 }, { ...p, block: CONCRETE, remaining: 1 }]);
  assert.equal(state.chunks.get(key).size, 1); assert.equal(state.remaining(p.x, p.y, p.z, p.block), 1);
  state.setChunk(key, []); assert.equal(state.remaining(p.x, p.y, p.z, p.block), 4);
  state.set({ ...p, remaining: 2 }); world.set(p.x, p.y, p.z, AIR);
  state.edited([{ ...p, from: p.block, to: AIR }]); assert.equal(state.chunks.size, 0);
  assert.ok([...geometry.attributes.damageData.array].filter((_, i) => i % 3 === 0).every(v => v === 0));
  geometry.dispose();
});

test('multiplayer receives chunk damage before rendering and clears repaired or removed structures', () => {
  const world = new ChunkWorld({ size: 16, generate: false }), client = new MultiplayerClient(world), state = new DamageState(world);
  client.ready = true;
  client.callbacks.constructionChunk = ({ key, damage }) => state.setChunk(key, damage);
  client.callbacks.construction = damage => state.set(damage);
  client.callbacks.edit = message => state.edited(message.changes);
  let chunks = 0;
  client.callbacks.chunks = () => { chunks++; assert.equal(state.remaining(p.x, p.y, p.z, p.block), 2); };
  const blocks = new Uint8Array(16 * 16 * 24); blocks[damageIndex(p.x, p.y, p.z, p.block)] = p.block;
  client.receive({ type: 'chunk', cx: 0, cz: 0, revision: 0, blocks: Buffer.from(blocks).toString('base64'), construction: [{ ...p, remaining: 2 }] });
  assert.equal(chunks, 1);
  client.receive({ type: 'construction', damage: { ...p, remaining: 1 } }); assert.equal(state.remaining(p.x, p.y, p.z, p.block), 1);
  client.receive({ type: 'construction', damage: { ...p, remaining: 4 } }); assert.equal(state.chunks.size, 0);
  client.receive({ type: 'construction', damage: { ...p, remaining: 1 } });
  client.receive({ type: 'edit', revision: 1, updates: [{ key, previousRevision: 0, revision: 1, changes: [{ ...p, from: p.block, to: AIR }] }] });
  assert.equal(state.chunks.size, 0);
});

test('damage shader composes with voxel lighting and shares one mask texture and program variant', () => {
  const world = new World({ generate: false }), lighting = new LanternLighting(new THREE.Scene(), world, { jobs: null });
  const material = new THREE.MeshLambertMaterial(), texture = createDamageTexture();
  lighting.applyMaterial(material); const lightKey = material.customProgramCacheKey();
  applyDamageMaterial(material, texture); const programKey = material.customProgramCacheKey();
  applyDamageMaterial(material, texture); assert.equal(material.customProgramCacheKey(), programKey); assert.ok(programKey.includes(lightKey));
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.structuralDamageMap.value, texture); assert.equal(shader.uniforms.lanternField, lighting.uniforms.lanternField);
  assert.match(shader.vertexShader, /attribute vec3 damageData/); assert.match(shader.vertexShader, /vStructuralDamageUv/);
  assert.match(shader.fragmentShader, /sampler3D lanternField/); assert.match(shader.fragmentShader, /texture2D\(structuralDamageMap/);
  assert.ok(shader.fragmentShader.indexOf('diffuseColor.rgb *=') < shader.fragmentShader.indexOf('totalEmissiveRadiance += diffuseColor.rgb'));
  assert.equal((shader.vertexShader.match(/attribute vec3 damageData/g) || []).length, 1);
  assert.equal(shader.fragmentShader.includes('discard'), false, 'wear must not cut holes in shelter surfaces');
  material.dispose(); texture.dispose(); lighting.dispose();
});

test('damage received during meshing applies to the finished geometry and survives ordinary remeshing', async t => {
  const previous = globalThis.Worker, workers = [];
  globalThis.Worker = class { constructor() { workers.push(this); } postMessage(job) { this.job = job; } terminate() {} };
  t.after(() => { if (previous) globalThis.Worker = previous; else delete globalThis.Worker; });
  const world = new ChunkWorld({ size: 16 }); world.getChunk(0, 0).blocks.fill(AIR); world.set(p.x, p.y, p.z, p.block);
  const material = new THREE.MeshLambertMaterial(), renderer = new ChunkRenderer(new THREE.Scene(), world, { solid: material }, () => {}, error => { throw error; });
  t.after(() => { renderer.reset(); renderer.jobs.dispose(); material.dispose(); });
  const complete = async () => {
    const worker = workers[0], result = {};
    for (const [mode, geometry] of Object.entries(buildChunkGeometry(world, 0, 0))) {
      if (mode === 'solid') result[mode] = { ...Object.fromEntries(Object.entries(geometry.attributes).map(([name, a]) => [name, a.array])), index: geometry.index.array, damageRanges: geometry.userData.damageRanges };
      geometry.dispose();
    }
    worker.onmessage({ data: { id: worker.job.id, result } });
    await Promise.resolve(); await Promise.resolve();
  };
  renderer.update({ x: 8, z: 8 }); renderer.damage.set({ ...p, remaining: 1 }); await complete();
  const mesh = renderer.chunks.get(key).solid;
  assert.equal(mesh.material, material); assert.ok(mesh.geometry.attributes.damageData.array.some((v, i) => i % 3 === 0 && v === 3));
  assert.equal(renderer.dirty.size, 0);
  const firstJob = workers[0].job;
  renderer.damage.set({ ...p, remaining: 2 }); assert.equal(workers[0].job, firstJob); assert.equal(renderer.chunks.get(key).solid, mesh);
  renderer.mark(key); renderer.update({ x: 8, z: 8 }); renderer.damage.set({ ...p, remaining: 4 }); await complete();
  assert.ok([...renderer.chunks.get(key).solid.geometry.attributes.damageData.array].filter((_, i) => i % 3 === 0).every(v => v === 0));
  renderer.damage.set({ ...p, remaining: 1 }); world.chunks.clear(); renderer.update({ x: 8, z: 8 });
  assert.equal(renderer.damage.chunks.size, 0); assert.equal(renderer.damage.geometries.size, 0);
});
