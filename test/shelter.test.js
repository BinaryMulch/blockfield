import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import * as THREE from 'three';
import { World, AIR, STONE, WOOD, PLANKS, GLASS, LEAVES, WATER, SLAB, UPPER_SLAB, LANTERN, WARD_LANTERN, REINFORCED_PANEL, SECURITY_DOOR, HEIGHT, doorBlock, blockBounds, isSupport, isOpaque } from '../src/world.js';
import { Infrastructure } from '../src/infrastructure.js';
import { ChunkWorld } from '../src/chunks.js';
import { ShelterSystem, SHELTER_WORK_BUDGET, MAX_CACHED_SECTIONS, MAX_VISIBLE_WARDS } from '../src/shelter.js';
import { Inventory, MATERIALS, DEFAULT_HOTBAR, validInventory } from '../src/inventory.js';
import { EditHistory } from '../src/history.js';
import { GameRoom, PROTOCOL } from '../server/room.js';
import { createGameServer } from '../server.js';
import { LocalSession } from '../src/session.js';
import { DayClock } from '../src/clock.js';
import { buildItemGeometry, buildLanternGeometry } from '../src/terrain.js';
import { generateTextureTiles, faceTile, TILES } from '../src/textures.js';
import { buildLanternField, fieldIndex } from '../src/lantern-field.js';
import { migrateSave, validateSave, SAVE_VERSION } from '../src/saves.js';
import { WardRenderer, shelterDescription, wardDescription } from '../src/ward-renderer.js';
import { soundRecipe } from '../src/sound.js';

function settle(shelters, pose, limit = 5000) {
  for (let i = 0; i < limit; i++) {
    const status = shelters.status(pose);
    if (status.state !== 'checking' || status.reason !== 'calculating') return status;
    shelters.update();
    assert.ok(shelters.lastWork <= shelters.workBudget);
  }
  throw new Error('Shelter check did not finish');
}

function buildRoom(world = new World({ generate: false }), x = 5, y = 1, z = 5) {
  for (let dx = 0; dx <= 6; dx++) for (let dz = 0; dz <= 6; dz++) for (let dy = 0; dy <= 4; dy++) {
    world.set(x + dx, y + dy, z + dz, dy === 0 || dy === 4 || dx === 0 || dx === 6 || dz === 0 || dz === 6 ? STONE : AIR);
  }
  world.set(x + 3, y + 1, z + 6, doorBlock(0));
  world.set(x + 3, y + 2, z + 6, doorBlock(0, false, true));
  world.set(x, y + 2, z + 3, GLASS);
  world.set(x + 1, y + 1, z + 1, WARD_LANTERN);
  return { world, x, y, z, pose: { x: x + 3.5, y: y + 1.01, z: z + 3.5, yaw: 0, pitch: 0, active: true } };
}

test('an enclosed room with glass, a closed door and a ward protects players inside only', () => {
  const { world, pose } = buildRoom(), shelters = new ShelterSystem(world);
  assert.equal(settle(shelters, pose).state, 'protected');
  assert.equal(shelters.snapshot(pose).wards[0].active, true);
  assert.equal(settle(shelters, { ...pose, z: 12.5 }).state, 'exposed');
  world.set(6, 2, 6, LANTERN);
  assert.equal(settle(shelters, pose).state, 'sheltered', 'ordinary lanterns do not grant protection');
});

test('security doors seal rooms and partial panel damage preserves protection until a breach', () => {
  const { world, pose } = buildRoom(), shelters = new ShelterSystem(world), history = new EditHistory(world);
  history.infrastructure = new Infrastructure(world);
  world.set(8, 2, 11, doorBlock(0, false, false, SECURITY_DOOR));
  world.set(8, 3, 11, doorBlock(0, false, true, SECURITY_DOOR));
  world.set(5, 3, 8, REINFORCED_PANEL);
  assert.equal(settle(shelters, pose).state, 'protected');
  assert.equal(history.toggleDoor(8, 2, 11).ok, true);
  assert.equal(settle(shelters, pose).state, 'exposed');
  assert.equal(history.toggleDoor(8, 3, 11).ok, true);
  assert.equal(settle(shelters, pose).state, 'protected');
  for (let hit = 0; hit < 3; hit++) {
    history.attackTime = hit;
    assert.equal(history.edit(5, 3, 8, AIR).remaining, 3 - hit);
    assert.equal(settle(shelters, pose).state, 'protected');
  }
  history.attackTime = 3; assert.equal(history.edit(5, 3, 8, AIR).ok, true);
  assert.equal(settle(shelters, pose).state, 'exposed');
});

test('opening a door, removing the roof, breaking a wall or floor, and removing a ward revoke protection immediately', () => {
  for (const change of [
    w => { w.set(8, 2, 11, doorBlock(0, true)); w.set(8, 3, 11, doorBlock(0, true, true)); },
    w => w.set(8, 5, 8, AIR), w => w.set(5, 3, 8, AIR), w => w.set(8, 1, 8, AIR),
  ]) {
    const { world, pose } = buildRoom(), shelters = new ShelterSystem(world);
    assert.equal(settle(shelters, pose).state, 'protected');
    change(world); assert.equal(settle(shelters, pose).state, 'exposed');
    buildRoom(world); assert.equal(settle(shelters, pose).state, 'protected');
  }
  const { world, pose } = buildRoom(), shelters = new ShelterSystem(world), history = new EditHistory(world);
  assert.equal(settle(shelters, pose).state, 'protected');
  assert.equal(history.edit(6, 1, 6, AIR).ok, true);
  assert.equal(world.get(6, 2, 6), AIR, 'support removal also removes the ward');
  assert.notEqual(settle(shelters, pose).state, 'protected');
});

test('leaves, water, and either slab half leave openings; the complete player body must fit', () => {
  for (const block of [LEAVES, WATER, SLAB, UPPER_SLAB]) {
    const { world, pose } = buildRoom(); world.set(5, 3, 8, block);
    assert.equal(settle(new ShelterSystem(world), pose).state, 'exposed');
  }
  const { world, pose } = buildRoom();
  for (let x = 6; x <= 10; x++) for (let z = 6; z <= 10; z++) world.set(x, 3, z, STONE);
  assert.equal(settle(new ShelterSystem(world), pose).state, 'exposed', 'one block of headroom is insufficient');
});

test('unloaded terrain never grants protection and shelter checks never generate terrain', () => {
  const source = buildRoom(new World({ generate: false }), 12, 1, 5);
  const world = new ChunkWorld({ size: 64, generate: true });
  const copy = cx => {
    const blocks = new Uint8Array(16 * 16 * HEIGHT);
    for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[x + 16 * (z + 16 * y)] = source.world.get(cx * 16 + x, y, z);
    world.putChunk(cx, 0, blocks);
  };
  copy(0); const shelters = new ShelterSystem(world);
  assert.equal(settle(shelters, source.pose).state, 'checking'); assert.equal(world.chunks.size, 1);
  copy(1); assert.equal(settle(shelters, source.pose).state, 'protected');
  world.evict([{ x: 0, z: 0 }], 0);
  assert.equal(settle(shelters, source.pose).state, 'checking'); assert.equal(world.chunks.size, 1);
});

test('outdoor sky proofs avoid searches and later construction invalidates stale results', () => {
  const world = new World({ generate: false }), shelters = new ShelterSystem(world);
  const room = shelters.roomAt({ x: 32, y: 12, z: 32 });
  assert.equal(room.enclosed, false); assert.equal(room.reason, 'open');
  assert.equal(shelters.sections.size, 0); assert.equal(shelters.totalWork, 0);
  const enclosed = buildRoom(world, 28, 10, 28);
  assert.equal(settle(shelters, enclosed.pose).state, 'protected');
});

test('ward crafting, placement, support removal and saved inventories account for exactly one item', () => {
  const { world } = buildRoom(), inventory = new Inventory(), history = new EditHistory(world);
  inventory.applyBalance(inventory.balance(new Map([[STONE, 8], [WOOD, 2], [GLASS, 2]])));
  assert.equal(inventory.craft(WARD_LANTERN).ok, true); assert.equal(inventory.count(WARD_LANTERN), 1);
  assert.equal(inventory.count(STONE), 0); assert.equal(inventory.count(GLASS), 0);
  history.inventory = inventory;
  assert.equal(history.placeLantern(9, 2, 9, null, WARD_LANTERN).ok, true);
  assert.equal(inventory.count(WARD_LANTERN), 0);
  assert.equal(history.edit(9, 1, 9, AIR).ok, true); assert.equal(inventory.count(WARD_LANTERN), 1);
  assert.equal(isSupport(WARD_LANTERN), false); assert.equal(isOpaque(WARD_LANTERN), false);
  assert.deepEqual(blockBounds(WARD_LANTERN, 0, 0, 0), blockBounds(LANTERN, 0, 0, 0));
  assert.equal(history.placeLantern(9, 2, 9, null, WOOD).ok, false);
});

test('legacy 15-material counters and version-1 worlds remain readable without inventing ward supplies', () => {
  const counts = Array(15).fill(0); counts[3] = 12;
  const old = { version: 2, mode: 'gather', slots: [...DEFAULT_HOTBAR], selected: 3, counts };
  assert.equal(validInventory(old), true);
  const inventory = new Inventory(old); assert.equal(inventory.count(WOOD), 12); assert.equal(inventory.count(WARD_LANTERN), 0);
  const room = new GameRoom(), save = room.toSave(); save.version = 1;
  const migrated = migrateSave(save); assert.equal(migrated.version, SAVE_VERSION); assert.equal(save.version, 1);
  assert.deepEqual(migrated.edits, save.edits);
  assert.throws(() => validateSave({ ...save, version: SAVE_VERSION + 1 }), e => e.code === 'SAVE_INCOMPATIBLE');
});

test('ward item geometry, textures, light propagation, state markers and cues are distinct and bounded', () => {
  const ward = buildItemGeometry(WARD_LANTERN), regular = buildItemGeometry(LANTERN);
  assert.equal(ward.attributes.position.count, regular.attributes.position.count);
  assert.notDeepEqual(Array.from(ward.attributes.uv.array), Array.from(regular.attributes.uv.array));
  const { world } = buildRoom(); assert.ok(buildLanternGeometry(world).attributes.position.count > 0);
  assert.notEqual(faceTile(WARD_LANTERN, 0), faceTile(LANTERN, 0));
  const tiles = generateTextureTiles(); assert.notDeepEqual(tiles[TILES.WARD_LANTERN], tiles[TILES.LANTERN]);
  const blocks = new Uint8Array(5 ** 3); blocks[fieldIndex(2, 2, 2, 5, 5)] = WARD_LANTERN;
  const field = buildLanternField({ blocks, width: 5, height: 5, depth: 5 });
  assert.equal(field.sources, 1); assert.ok(field.light[fieldIndex(3, 2, 2, 5, 5)] > 0);
  const renderer = new WardRenderer(new THREE.Scene());
  renderer.sync(Array.from({ length: 30 }, (_, x) => ({ x, y: 2, z: 0, active: x % 2 === 0 })));
  assert.equal(renderer.active.count + renderer.inactive.count, MAX_VISIBLE_WARDS);
  renderer.sync(); assert.equal(renderer.active.count + renderer.inactive.count, 0);
  assert.notDeepEqual(soundRecipe(WARD_LANTERN, 'ward_on'), soundRecipe(WARD_LANTERN, 'ward_off'));
  assert.match(shelterDescription({ state: 'protected' }), /Protected/);
  assert.match(wardDescription({ active: false }), /inactive/);
  assert.equal(MATERIALS.find(m => m.id === WARD_LANTERN).name, 'Ward lantern');
});

async function connect(game) {
  const socket = new WebSocket(`ws://127.0.0.1:${game.server.address().port}/multiplayer`), messages = [], listeners = new Set();
  socket.on('message', raw => { messages.push(JSON.parse(raw)); for (const check of listeners) check(); });
  const next = predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listeners.delete(check); reject(new Error('Timed out waiting for shelter state')); }, 5000);
    function check() { const i = messages.findIndex(predicate); if (i < 0) return; clearTimeout(timer); listeners.delete(check); resolve(messages.splice(i, 1)[0]); }
    listeners.add(check); check();
  });
  socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, name: 'Shelter tester' })));
  return { socket, next, welcome: await next(m => m.type === 'welcome') };
}

test('host-owned shelter state agrees for two clients after door edits, ignores injected status and restores after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blockfield-wards-'));
  const { world, pose, x, y, z } = buildRoom(new ChunkWorld({ seed: 'wards' }), 249, 7, 249);
  let game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory, room: new GameRoom({ world }) });
  const sockets = [];
  t.after(async () => { sockets.forEach(s => s.terminate()); await game.close(); await rm(directory, { recursive: true, force: true }); });
  const a = await connect(game), b = await connect(game); sockets.push(a.socket, b.socket);
  for (const client of [a, b]) client.socket.send(JSON.stringify({ type: 'pose', pose: { ...pose, shelter: { state: 'exposed' } } }));
  await a.next(m => m.type === 'players' && m.shelter.state === 'protected');
  await b.next(m => m.type === 'players' && m.shelter.state === 'protected');
  a.socket.send(JSON.stringify({ type: 'command', requestId: 1, method: 'toggleDoor', x: x + 3, y: y + 1, z: z + 6, expected: game.room.expected(x + 3, y + 1, z + 6), shelter: { state: 'protected' } }));
  assert.equal((await a.next(m => m.type === 'result' && m.requestId === 1)).ok, true);
  await a.next(m => m.type === 'players' && m.shelter.state === 'exposed');
  await b.next(m => m.type === 'players' && m.shelter.state === 'exposed');
  a.socket.send(JSON.stringify({ type: 'command', requestId: 2, method: 'toggleDoor', x: x + 3, y: y + 1, z: z + 6, expected: game.room.expected(x + 3, y + 1, z + 6) }));
  assert.equal((await a.next(m => m.type === 'result' && m.requestId === 2)).ok, true);
  await a.next(m => m.type === 'players' && m.shelter.state === 'protected');
  await game.close();
  game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
  const again = await connect(game); sockets.push(again.socket);
  again.socket.send(JSON.stringify({ type: 'pose', pose }));
  const restored = await again.next(m => m.type === 'players' && m.shelter.state === 'protected');
  assert.equal(restored.shelter.wards[0].active, true);
});

test('private sessions publish the same protection changes immediately after supported edits', async () => {
  const { world, pose } = buildRoom(), states = [];
  const history = new EditHistory(world);
  const local = Object.assign(Object.create(LocalSession.prototype), { world, self: pose, pose: () => pose, ready: true, closed: false,
    resources: new Inventory(), clock: new DayClock(), history, shelters: new ShelterSystem(world), callbacks: { shelter: state => states.push(state) }, save: async () => true });
  settle(local.shelters, pose); local.publishShelter(); assert.equal(states.at(-1).state, 'protected');
  assert.equal((await local.request('toggleDoor', { x: 8, y: 2, z: 11 })).ok, true);
  assert.equal(states.at(-1).state, 'checking');
  settle(local.shelters, pose); local.publishShelter(); assert.equal(states.at(-1).state, 'exposed');
  assert.equal((await local.request('toggleDoor', { x: 8, y: 2, z: 11 })).ok, true);
  assert.equal(states.at(-1).state, 'checking');
  settle(local.shelters, pose); local.publishShelter(); assert.equal(states.at(-1).state, 'protected');
});

function largeHouse() {
  const world = new World({ generate: false });
  // A 60 x 60 x 3 interior: far beyond both old size limits.
  for (let x = 1; x <= 62; x++) for (let z = 1; z <= 62; z++) for (let y = 1; y <= 5; y++) {
    if (x === 1 || x === 62 || z === 1 || z === 62 || y === 1 || y === 5) world.set(x, y, z, STONE);
  }
  world.set(2, 2, 2, WARD_LANTERN);
  return { world, pose: { x: 30.5, y: 2.01, z: 30.5 } };
}

test('massive open interiors are verified incrementally rather than rejected for their size', () => {
  const { world, pose } = largeHouse();
  const shelters = new ShelterSystem(world, { workBudget: 128, timeBudgetMs: Infinity });
  assert.deepEqual(shelters.status(pose), { state: 'checking', reason: 'calculating', ward: null });
  assert.equal(shelters.totalWork, 0, 'queries request work without performing the enclosure search');
  shelters.update(); assert.equal(shelters.lastWork, 128);
  assert.equal(shelters.status(pose).state, 'checking', 'a spent budget is not evidence of exposure');
  assert.equal(settle(shelters, pose).state, 'protected');
  assert.ok(shelters.sections.size <= MAX_CACHED_SECTIONS);
  assert.ok(shelters.sectionBuilds > 1);
  const work = shelters.totalWork;
  for (let i = 0; i < 20; i++) assert.equal(shelters.snapshot(pose).state, 'protected');
  shelters.update(); assert.equal(shelters.lastWork, 0); assert.equal(shelters.totalWork, work);
});

test('eight players share one work allowance and reuse completed section and zone results', () => {
  const { world } = largeHouse(), shelters = new ShelterSystem(world, { workBudget: 256, timeBudgetMs: Infinity });
  const players = Array.from({ length: 8 }, (_, i) => ({ x: 4.5 + i * 7, y: 2.01, z: 30.5 }));
  let complete = false;
  for (let i = 0; i < 2000; i++) {
    const before = shelters.totalWork;
    const states = players.map(p => shelters.snapshot(p).state);
    assert.equal(shelters.totalWork, before);
    if (states.every(s => s === 'protected')) { complete = true; break; }
    shelters.update(); assert.ok(shelters.lastWork <= 256);
  }
  assert.equal(complete, true);
  const built = shelters.sectionBuilds;
  for (let i = 0; i < 10; i++) { players.forEach(p => shelters.snapshot(p)); shelters.update(); }
  assert.equal(shelters.sectionBuilds, built); assert.equal(shelters.lastWork, 0);
});

test('a remote edit preserves a cached house and a local edit rebuilds only the affected section', () => {
  const { world, pose } = buildRoom(), shelters = new ShelterSystem(world, { timeBudgetMs: Infinity });
  assert.equal(settle(shelters, pose).state, 'protected');
  const built = shelters.sectionBuilds, work = shelters.totalWork;
  world.set(50, 10, 50, STONE);
  assert.equal(shelters.status(pose).state, 'protected');
  shelters.update(); assert.equal(shelters.totalWork, work); assert.equal(shelters.sectionBuilds, built);
  world.set(5, 3, 8, PLANKS);
  assert.equal(shelters.status(pose).state, 'checking', 'old protection is revoked before a modified zone is verified');
  assert.equal(settle(shelters, pose).state, 'protected');
  assert.equal(shelters.sectionBuilds, built + 1);
});

test('closed interior doors create separate zones, opening one merges them, and exterior damage stays compartmentalized', () => {
  const { world, pose } = buildRoom(), shelters = new ShelterSystem(world, { timeBudgetMs: Infinity });
  for (let y = 2; y <= 4; y++) for (let z = 6; z <= 10; z++) world.set(8, y, z, STONE);
  world.set(8, 2, 8, doorBlock(1)); world.set(8, 3, 8, doorBlock(1, false, true));
  const left = { ...pose, x: 6.5 }, right = { ...pose, x: 9.5 };
  assert.equal(settle(shelters, left).state, 'protected');
  assert.equal(settle(shelters, right).state, 'sheltered');
  world.set(8, 2, 8, doorBlock(1, true)); world.set(8, 3, 8, doorBlock(1, true, true));
  assert.equal(settle(shelters, right).state, 'protected');
  world.set(11, 3, 8, AIR);
  assert.equal(settle(shelters, left).state, 'exposed');
  world.set(8, 2, 8, doorBlock(1)); world.set(8, 3, 8, doorBlock(1, false, true));
  assert.equal(settle(shelters, left).state, 'protected');
  assert.equal(settle(shelters, right).state, 'exposed');
});

test('cache pressure and a zero time allowance stay unknown instead of granting or falsely denying protection', () => {
  const { world, pose } = buildRoom();
  const constrained = new ShelterSystem(world, { maxSections: 1, workBudget: 64, timeBudgetMs: Infinity });
  const result = settle(constrained, pose);
  assert.equal(result.state, 'checking'); assert.equal(result.reason, 'capacity'); assert.ok(constrained.sections.size <= 1);
  const paused = new ShelterSystem(world, { timeBudgetMs: 0 });
  paused.status(pose); paused.update(); assert.equal(paused.lastWork, 0); assert.equal(paused.status(pose).state, 'checking');
  assert.match(shelterDescription({ state: 'checking', reason: 'calculating' }), /Verifying enclosure/);
  assert.match(wardDescription({ active: false, reason: 'calculating' }), /checking/);
  assert.equal(SHELTER_WORK_BUDGET, 4096);
});

test('a local edit in a massive house reuses every unchanged section', () => {
  const { world, pose } = largeHouse(), shelters = new ShelterSystem(world, { timeBudgetMs: Infinity });
  assert.equal(settle(shelters, pose).state, 'protected');
  const built = shelters.sectionBuilds;
  world.set(1, 3, 20, PLANKS);
  assert.equal(shelters.status(pose).state, 'checking');
  assert.equal(settle(shelters, pose).state, 'protected');
  assert.equal(shelters.sectionBuilds, built + 1);
});

test('rapid queries and repeated edits cannot retain unbounded queued sections or stale zones', () => {
  const { world, pose } = buildRoom(), small = new ShelterSystem(world, { maxSections: 2, timeBudgetMs: Infinity });
  for (let i = 0; i < 500; i++) {
    small.entry(`${i % 4},${Math.floor(i / 4) % 6},0`);
    assert.ok(small.sections.size <= 2); assert.ok(small.sectionQueue.length <= 4);
  }
  const shelters = new ShelterSystem(world, { timeBudgetMs: Infinity });
  for (let i = 0; i < 80; i++) {
    world.set(5, 3, 8, i % 2 ? STONE : PLANKS);
    assert.equal(settle(shelters, pose).state, 'protected');
    assert.ok(shelters.zones.size <= 64); assert.ok(shelters.zoneById.size <= 64); assert.ok(shelters.requests.size <= 64);
  }
});
