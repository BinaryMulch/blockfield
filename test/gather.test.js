import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Inventory, MATERIALS, DEFAULT_HOTBAR, emptyGatherInventory, validInventory } from '../src/inventory.js';
import { EditHistory } from '../src/history.js';
import { World, AIR, GRASS, STONE, WOOD, PLANKS, GLASS, SAND, DOOR, SLAB, UPPER_SLAB, LANTERN, DAISY, doorBlock } from '../src/world.js';
import { ChunkWorld } from '../src/chunks.js';
import { captureSave, validateSave } from '../src/saves.js';
import { GameRoom } from '../server/room.js';

function fixture() {
  const world = new World({ generate: false }), inventory = new Inventory(emptyGatherInventory()), history = new EditHistory(world);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) { world.set(x, 0, z, STONE); world.set(x, 1, z, GRASS); }
  history.inventory = inventory;
  const stock = (block, count) => { inventory.applyBalance(inventory.balance(new Map([[block, count - inventory.count(block)]]))); };
  return { world, inventory, history, stock };
}

test('gather inventories start empty, validate bounded integer stacks, and preserve counts on layout reset', () => {
  const inventory = new Inventory(emptyGatherInventory());
  assert.equal(inventory.mode, 'gather'); assert.equal(inventory.count(GRASS), 0); assert.equal(validInventory(inventory.snapshot()), true);
  inventory.applyBalance(inventory.balance(new Map([[WOOD, 4]]))); inventory.select(3); assert.equal(inventory.assign(DOOR), false); assert.equal(inventory.reset(), false);
  assert.equal(inventory.count(WOOD), 4); assert.equal(inventory.selected, 3);
  const copy = inventory.snapshot(); copy.stacks[0].count = 64; assert.equal(inventory.count(WOOD), 4);
  for (const bad of [-1, 65, 1.5, '2', NaN]) { const saved = inventory.snapshot(); saved.stacks[0] = { block: WOOD, count: bad }; assert.equal(validInventory(saved), false); }
  assert.equal(validInventory({ ...inventory.snapshot(), stacks: new Array(36) }), false);
});

test('breaking collects, placement spends, unavailable placement is atomic, and foundation gives no supplies', () => {
  const { world, inventory, history } = fixture();
  assert.equal(history.edit(8, 2, 8, GRASS).reason, 'supplies'); assert.equal(world.get(8, 2, 8), AIR);
  assert.equal(history.edit(8, 1, 8, AIR).ok, true); assert.equal(inventory.count(GRASS), 1);
  assert.equal(history.edit(8, 2, 8, GRASS).ok, true); assert.equal(inventory.count(GRASS), 0);
  assert.equal(history.edit(8, 3, 8, GRASS).reason, 'supplies'); assert.equal(history.undoStack.length, 2);
  assert.equal(history.edit(8, 0, 8, AIR).reason, 'invalid'); assert.equal(inventory.count(STONE), 0);
});

test('full stacks refuse the entire support removal, preserving both support and attached flower', () => {
  const { world, inventory, history, stock } = fixture(); world.set(8, 2, 8, DAISY); inventory.stacks = Array.from({ length: 36 }, () => ({ block: WOOD, count: 64 })); inventory.stacks[0] = { block: DAISY, count: 64 }; inventory.stacks[1] = { block: GRASS, count: 63 };
  assert.equal(history.edit(8, 1, 8, AIR).reason, 'inventory_full');
  assert.equal(world.get(8, 1, 8), GRASS); assert.equal(world.get(8, 2, 8), DAISY); assert.equal(inventory.count(GRASS), 63);
  stock(DAISY, 63); assert.equal(history.edit(8, 1, 8, AIR).ok, true); assert.equal(inventory.count(GRASS), 64); assert.equal(inventory.count(DAISY), 64);
});

test('one door item accounts for both halves and toggling is free', () => {
  const { world, inventory, history, stock } = fixture(); stock(DOOR, 1);
  assert.equal(history.placeDoor(8, 2, 8, 0).ok, true); assert.equal(inventory.count(DOOR), 0);
  assert.equal(history.toggleDoor(8, 2, 8).ok, true); assert.equal(inventory.count(DOOR), 0);
  assert.equal(history.edit(8, 3, 8, AIR).ok, true); assert.equal(inventory.count(DOOR), 1);
  assert.equal(world.get(8, 2, 8), AIR); assert.equal(world.get(8, 3, 8), AIR);
  assert.equal(history.undo().ok, true); assert.equal(inventory.count(DOOR), 0);
  assert.equal(history.undo().ok, true); assert.equal(inventory.count(DOOR), 0);
});

test('failed collision and support checks do not spend gathered supplies', () => {
  const { world, inventory, history, stock } = fixture(); stock(STONE, 1); stock(DOOR, 1); stock(LANTERN, 1);
  const player = { x: 8.5, y: 2, z: 8.9 };
  assert.equal(history.edit(8, 2, 8, STONE, player).reason, 'blocked');
  assert.equal(history.placeDoor(8, 2, 8, 0, player).reason, 'blocked');
  assert.equal(history.placeLantern(8, 5, 8).reason, 'invalid');
  assert.equal(inventory.count(STONE), 1); assert.equal(inventory.count(DOOR), 1); assert.equal(inventory.count(LANTERN), 1);
  assert.equal(world.get(8, 2, 8), AIR); assert.equal(history.undoStack.length, 0);
});

test('slab placement, merging, undo, redo, and harvesting account for halves without minting planks', () => {
  const { inventory, history, stock } = fixture(); stock(SLAB, 2);
  assert.equal(history.edit(8, 2, 8, UPPER_SLAB).ok, true); assert.equal(inventory.count(SLAB), 1);
  assert.equal(history.edit(8, 2, 8, PLANKS).ok, true); assert.equal(inventory.count(SLAB), 0); assert.equal(inventory.count(PLANKS), 0);
  assert.equal(history.undo().ok, true); assert.equal(inventory.count(SLAB), 1);
  assert.equal(history.redo().ok, true); assert.equal(inventory.count(SLAB), 0);
  assert.equal(history.edit(8, 2, 8, AIR).ok, true); assert.equal(inventory.count(PLANKS), 1);
  assert.equal(history.undo().ok, true); assert.equal(inventory.count(PLANKS), 0);
});

test('undo cannot restore gathered resources after they have been spent; failed undo leaves world and history intact', () => {
  const { world, inventory, history } = fixture(); world.set(8, 2, 8, WOOD);
  history.edit(8, 2, 8, AIR); assert.equal(inventory.craft(PLANKS).ok, true);
  assert.equal(inventory.count(WOOD), 0); assert.equal(inventory.count(PLANKS), 4);
  assert.equal(history.undo().reason, 'supplies'); assert.equal(world.get(8, 2, 8), AIR); assert.equal(history.undoStack.length, 1);
});

test('recipes consume ingredients, enforce capacity, and cannot run without supplies or in creative mode', () => {
  const { inventory, stock } = fixture();
  assert.equal(inventory.craft(PLANKS).reason, 'supplies'); stock(WOOD, 2);
  assert.equal(inventory.craft(PLANKS).ok, true); assert.equal(inventory.count(WOOD), 1); assert.equal(inventory.count(PLANKS), 4);
  stock(PLANKS, 63); assert.equal(inventory.craft(PLANKS).ok, true); assert.equal(inventory.count(PLANKS), 67); stock(WOOD, 1);
  stock(STONE, 4); stock(GLASS, 1); assert.equal(inventory.craft(LANTERN).ok, true); assert.equal(inventory.count(LANTERN), 1);
  assert.equal(inventory.count(STONE), 0); assert.equal(inventory.count(WOOD), 0); assert.equal(inventory.count(GLASS), 0);
  assert.equal(new Inventory().craft(PLANKS).reason, 'supplies'); assert.equal(inventory.craft(SAND).reason, 'invalid');
});

test('replacing flowers and removing lantern supports transfers each distinct collected item', () => {
  const { world, inventory, history, stock } = fixture(); world.set(8, 2, 8, DAISY); stock(LANTERN, 1);
  assert.equal(history.placeLantern(8, 2, 8).ok, true); assert.equal(inventory.count(DAISY), 1); assert.equal(inventory.count(LANTERN), 0);
  assert.equal(history.edit(8, 1, 8, AIR).ok, true); assert.equal(inventory.count(GRASS), 1); assert.equal(inventory.count(LANTERN), 1);
});

test('saved gather worlds round trip counts, reject malformed profiles, and preserve legacy creative saves', () => {
  const { inventory, stock } = fixture(); stock(WOOD, 12);
  const world = new ChunkWorld({ seed: 'gather' }), save = captureSave({ world, id: 'gather-test', name: 'Gather', createdAt: 1, clock: { phase: .2, held: false }, gameMode: 'horror', inventory: inventory.snapshot() });
  assert.equal(new Inventory(validateSave(JSON.parse(JSON.stringify(save))).inventory).count(WOOD), 12);
  assert.throws(() => validateSave({ ...save, inventory: { version: 1, slots: [...DEFAULT_HOTBAR], selected: 0 } }), /supplies are invalid/);
  assert.throws(() => validateSave({ ...save, profiles: [[randomUUID(), { ...inventory.snapshot(), stacks: [{ block: WOOD, count: 100 }] }]] }), /player supplies/);
  const legacy = { ...save, inventory: { version: 1, slots: [...DEFAULT_HOTBAR], selected: 0 } }; delete legacy.gameMode;
  assert.equal(validateSave(legacy), legacy);
  assert.equal(GameRoom.fromSave(legacy).gameMode, 'horror');
});

test('multiplayer inventories are independent, authoritative, and restored by persistent browser identity', () => {
  const room = new GameRoom({ gameMode: 'horror' }), token = randomUUID(), a = room.join('Alice', token), b = room.join('Bob', randomUUID());
  const x = Math.floor(a.pose.x), z = Math.floor(a.pose.z), y = Math.floor(a.pose.y) - 1, block = room.world.get(x, y, z);
  const command = (player, after) => room.command(player.id, { method: 'edit', x, y, z, block: after, expected: room.expected(x, y, z), counts: Array(15).fill(64) });
  assert.equal(command(a, AIR).ok, true); assert.equal(a.inventory.count(block), 1); assert.equal(b.inventory.count(block), 0);
  assert.equal(command(b, block).reason, 'supplies'); assert.equal(room.world.get(x, y, z), AIR);
  assert.equal(room.join('Duplicate', token), null);
  const publicPlayers = JSON.stringify(room.playerList()); assert.equal(publicPlayers.includes(token), false); assert.equal(publicPlayers.includes('counts'), false);
  const restored = GameRoom.fromSave(JSON.parse(JSON.stringify(room.toSave()))), again = restored.join('Alice', token);
  assert.equal(again.inventory.count(block), 1); assert.equal(restored.gameMode, 'horror');
  assert.equal(restored.snapshot(again).playerToken, token); assert.equal(restored.snapshot(again).inventory.version, 3);
  room.leave(a.id); assert.equal(room.join('Alice', token).inventory.count(block), 1);
});
