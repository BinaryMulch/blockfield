import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, AIR, STONE, WOOD, SLAB, SIZE } from '../src/world.js';
import { Inventory, emptyGatherInventory, MATERIALS } from '../src/inventory.js';
import { ItemDrops, MAX_DROPS, validDrops } from '../src/drops.js';
import { ChunkWorld } from '../src/chunks.js';
import { GameRoom } from '../server/room.js';
import { captureSave, validateSave } from '../src/saves.js';
import { LocalSession } from '../src/session.js';
import { DropRenderer } from '../src/drop-renderer.js';

function fixture() {
  const world = new World({ generate: false }), inventory = new Inventory(emptyGatherInventory()), drops = new ItemDrops();
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  inventory.stacks[0] = { block: WOOD, count: 12 };
  const pose = { x: 8.5, y: 1.01, z: 8.5, yaw: 0, pitch: 0, flying: false, active: true };
  const drop = (amount = 1, args = {}) => drops.drop(world, inventory, pose, { source: 0, amount, expectedSource: { ...inventory.stacks[0] }, ...args }, `drop-${drops.items.length}`, 1000);
  return { world, inventory, drops, pose, drop };
}

test('one-item and whole-stack drops conserve resources, settle on the ground, and require a fresh source snapshot', () => {
  const { world, inventory, drops, pose, drop } = fixture(), before = { ...inventory.stacks[0] };
  assert.equal(drop().ok, true); assert.equal(inventory.count(WOOD), 11); assert.equal(drops.items[0].count, 1);
  assert.ok(drops.items[0].z < pose.z - 1.4); assert.ok(drops.items[0].y >= 1.16 && drops.items[0].y < 1.22);
  assert.equal(drop(1, { expectedSource: before }).reason, 'changed'); assert.equal(inventory.count(WOOD), 11);
  assert.equal(drop(11).ok, true); assert.equal(inventory.stacks[0], null); assert.equal(drops.items.reduce((sum, item) => sum + item.count, 0), 12);
  assert.equal(drops.pickup(world, inventory, { ...pose, z: drops.items[0].z }, 2499).ok, false);
  assert.equal(drops.pickup(world, inventory, { ...pose, z: drops.items[0].z }, 2500).ok, true);
  assert.equal(drops.items.length, 0); assert.equal(inventory.count(WOOD), 12);
});

test('invalid amounts, slots, stale stacks, creative mode and full drop pools never spend items', () => {
  const { world, inventory, drops, pose, drop } = fixture(), initial = inventory.snapshot();
  for (const amount of [0, -1, 13, 1.5, Infinity, '1']) assert.equal(drop(amount).ok, false);
  for (const source of [-1, 36, '0', 0.5]) assert.equal(drop(1, { source }).ok, false);
  assert.equal(drop(1, { expectedSource: null }).ok, false);
  assert.equal(drops.drop(world, new Inventory(), pose, { source: 0, amount: 1 }, 'creative').ok, false);
  drops.items = Array.from({ length: MAX_DROPS }, (_, i) => ({ id: `existing-${i}` }));
  assert.equal(drop().reason, 'drops_full'); assert.deepEqual(inventory.snapshot(), initial);
});

test('drops respect walls, slab surfaces, world edges, and unavailable private chunks', () => {
  const { world, drops, inventory, pose, drop } = fixture();
  for (let y = 1; y < 4; y++) world.set(8, y, 7, STONE);
  assert.equal(drop().ok, true); assert.ok(drops.items[0].z > 8.15);
  for (let y = 1; y < 4; y++) world.set(8, y, 7, AIR);
  world.set(8, 1, 7, SLAB); assert.equal(drop().ok, true); assert.ok(drops.items[1].y >= 1.66 && drops.items[1].y < 1.72);
  pose.z = 0.3; assert.equal(drop().ok, true); assert.ok(drops.items[2].z >= 0.16);
  world.set(8, 1, 0, STONE); const before = inventory.snapshot(); assert.equal(drop().reason, 'blocked'); assert.deepEqual(inventory.snapshot(), before);
  const unloaded = new ChunkWorld({ generate: false });
  assert.equal(drops.drop(unloaded, inventory, { ...pose, z: 8.5 }, { source: 0, amount: 1, expectedSource: inventory.stacks[0] }, 'unloaded').reason, 'blocked');
  assert.equal(unloaded.chunks.size, 0);
});

test('pickup enforces proximity, active play, walls, and capacity, leaving partial stacks intact', () => {
  const { world, inventory, drops, pose, drop } = fixture(); drop(12);
  const item = drops.items[0], nearby = { ...pose, x: item.x, z: item.z };
  assert.equal(drops.pickup(world, inventory, pose, 3000).ok, false);
  assert.equal(drops.pickup(world, inventory, { ...nearby, active: false }, 3000).ok, false);
  assert.equal(drops.pickup(world, inventory, { ...nearby, y: 4 }, 3000).ok, false);
  inventory.stacks = Array.from({ length: 36 }, () => ({ block: STONE, count: 64 }));
  assert.equal(drops.pickup(world, inventory, nearby, 3000).ok, false); assert.equal(item.count, 12);
  inventory.stacks[9] = { block: WOOD, count: 60 };
  assert.equal(drops.pickup(world, inventory, nearby, 3000).ok, true); assert.equal(item.count, 8); assert.equal(inventory.stacks[9].count, 64);
  inventory.stacks[10] = null;
  world.set(8, 1, 7, STONE);
  assert.equal(drops.pickup(world, inventory, { ...nearby, z: 8.1 }, 3000).ok, false); assert.equal(item.count, 8);
  world.set(8, 1, 7, AIR);
  assert.equal(drops.pickup(world, inventory, nearby, 3000).ok, true); assert.equal(drops.items.length, 0); assert.equal(inventory.count(WOOD), 72);
});

test('world saves validate and retain drops independently of inventory, supporting legacy worlds', () => {
  const { drops, inventory, drop } = fixture(); drop(5);
  const world = new ChunkWorld({ seed: 'drops' });
  const save = captureSave({ world, id: 'drops', name: 'Drops', createdAt: 1, clock: { phase: 0.2, held: false }, gameMode: 'horror', inventory: inventory.snapshot(), drops: drops.snapshot() });
  assert.equal(validateSave(JSON.parse(JSON.stringify(save))).drops[0].count, 5);
  const legacy = { ...save }; delete legacy.drops; assert.equal(validateSave(legacy), legacy);
  for (const changed of [{ count: 0 }, { count: 65 }, { block: AIR }, { x: -1 }, { y: Infinity }, { readyAt: -1 }, { id: null }]) {
    assert.throws(() => validateSave({ ...save, drops: [{ ...save.drops[0], ...changed }] }), /dropped items/);
  }
  assert.throws(() => validateSave({ ...save, drops: [save.drops[0], save.drops[0]] }), /dropped items/);
  assert.equal(validDrops(new Array(1), 512), false);
  assert.equal(validDrops(Array(MAX_DROPS + 1).fill(save.drops[0]), 512), false);
  drops.items[0].count = 1; inventory.stacks[0].count = 1;
  assert.equal(save.drops[0].count, 5); assert.equal(save.inventory.stacks[0].count, 7);
});

test('shared drops transfer once between players, survive restart, and cannot be undone to duplicate items', () => {
  const { world, pose } = fixture(), room = new GameRoom({ world, gameMode: 'horror' });
  const a = room.join('Alice'), b = room.join('Bob');
  room.move(a.id, pose); world.set(8, 1, 6, WOOD);
  assert.equal(room.command(a.id, { method: 'edit', x: 8, y: 1, z: 6, block: AIR, expected: room.expected(8, 1, 6) }).ok, true);
  assert.equal(room.command(a.id, { method: 'drop', source: 0, amount: 1, expectedSource: { block: WOOD, count: 1 } }).ok, true);
  assert.equal(room.command(a.id, { method: 'undo' }).reason, 'restricted');
  const item = room.drops.items[0]; item.readyAt = 0; room.move(b.id, { ...pose, x: item.x, z: item.z });
  assert.equal(room.command(b.id, { method: 'pickup', block: WOOD, count: 64 }).ok, true);
  assert.equal(room.command(b.id, { method: 'pickup' }).ok, false); assert.equal(b.inventory.count(WOOD), 1); assert.equal(a.inventory.count(WOOD), 0);
  // A normal chunk world can be saved and restored with the item and owner inventory together.
  const persistent = new GameRoom({ gameMode: 'horror' }), player = persistent.join('Builder');
  player.inventory.stacks[0] = { block: WOOD, count: 8 };
  assert.equal(persistent.command(player.id, { method: 'drop', source: 0, amount: 3, expectedSource: { block: WOOD, count: 8 } }).ok, true);
  const restored = GameRoom.fromSave(JSON.parse(JSON.stringify(persistent.toSave()))), again = restored.join('Builder', player.token);
  assert.equal(again.inventory.count(WOOD), 5); assert.equal(restored.snapshot(again).drops[0].count, 3);
  assert.equal(JSON.stringify(restored.snapshot(again).drops).includes(player.token), false);
});

test('private drop requests save inventory and entities together, retain unsaved work, and block overlapping pickups', async () => {
  const { world, inventory, pose } = fixture();
  // Use a local backend without starting its browser terrain worker or IndexedDB.
  const session = Object.assign(Object.create(LocalSession.prototype), { world, resources: inventory, clock: { elapsedSeconds: 0 }, drops: new ItemDrops(), ready: true, closed: false, editing: false, callbacks: {}, pose: () => pose });
  let release, saved, published = false;
  session.save = () => { saved = { inventory: inventory.snapshot(), drops: session.drops.snapshot() }; return new Promise(resolve => { release = resolve; }); };
  session.callbacks.drops = () => { published = true; };
  const pending = session.request('drop', { source: 0, amount: 3, expectedSource: { block: WOOD, count: 12 } });
  assert.equal(published, true); assert.equal(saved.inventory.stacks[0].count, 9); assert.equal(saved.drops[0].count, 3);
  assert.equal((await session.request('pickup')).reason, 'busy');
  release(true); assert.equal((await pending).ok, true); assert.equal(published, true); assert.equal(session.editing, false);
  session.save = async () => false;
  const failed = await session.request('drop', { source: 0, amount: 2, expectedSource: { block: WOOD, count: 9 } });
  assert.equal(failed.reason, 'storage'); assert.equal(inventory.count(WOOD), 7); assert.equal(session.drops.items.reduce((sum, item) => sum + item.count, 0), 5);
});

test('item rendering reuses geometry for every material and removes models on pickup or world switch', () => {
  const scene = new THREE.Scene(), view = new DropRenderer(scene, new THREE.Texture(), () => {});
  const items = MATERIALS.map(({ id }, i) => ({ id: `render-${i}`, block: id, count: 1, x: 8, y: 2, z: 8, readyAt: 0 }));
  view.sync(items); view.update(0.1, { getChunk: () => ({}) });
  assert.equal(view.root.children.length, MATERIALS.length);
  for (const mesh of view.root.children) { assert.ok(mesh.geometry.attributes.position.count > 0); assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite)); assert.equal(mesh.visible, true); }
  const geometry = view.root.children[0].geometry;
  view.sync([items[0]]); assert.equal(view.root.children.length, 1); assert.equal(view.root.children[0].geometry, geometry);
  view.update(0.1, { getChunk: () => null }); assert.equal(view.root.children[0].visible, false);
  view.sync([]); assert.equal(view.root.children.length, 0);
  view.geometries.forEach(value => value.dispose()); view.material.map.dispose(); view.material.dispose(); view.flowers.dispose();
});
