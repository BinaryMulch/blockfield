import test from 'node:test';
import assert from 'node:assert/strict';
import { CreativeInventory, CREATIVE_ITEMS, DEFAULT_HOTBAR, validInventory } from '../src/inventory.js';
import { AIR, STONE, WATER, GLASS, LANTERN, SLAB, UPPER_SLAB, DOOR, DAISY, doorBlock } from '../src/world.js';
import { ChunkWorld } from '../src/chunks.js';
import { captureSave, validateSave, SaveError } from '../src/saves.js';
import { GameRoom } from '../server/room.js';

test('creative supplies provide every supported palette item with a valid nine-slot starting hotbar', () => {
  const inventory = new CreativeInventory();
  assert.equal(CREATIVE_ITEMS.length, 15);
  assert.equal(new Set(CREATIVE_ITEMS.map(item => item.id)).size, CREATIVE_ITEMS.length);
  assert.deepEqual(inventory.slots, DEFAULT_HOTBAR); assert.equal(inventory.selected, 0);
  assert.equal(validInventory(inventory.snapshot()), true);
});

test('assignments replace only the selected slot, and block picking prefers an existing slot', () => {
  const inventory = new CreativeInventory();
  assert.equal(inventory.select(3), true); assert.equal(inventory.assign(LANTERN), true);
  assert.equal(inventory.slots[3], LANTERN); assert.equal(inventory.slots[4], DEFAULT_HOTBAR[4]);
  assert.equal(inventory.pick(STONE), true); assert.equal(inventory.selected, 2); assert.equal(inventory.slots[3], LANTERN);
  assert.equal(inventory.pick(DAISY), true); assert.equal(inventory.selected, 2); assert.equal(inventory.block, DAISY);
  assert.equal(inventory.pick(DAISY), false);
});

test('picked doors and slabs normalize to placeable items while invalid blocks and slot indices are refused', () => {
  const inventory = new CreativeInventory();
  inventory.pick(UPPER_SLAB); assert.equal(inventory.block, SLAB);
  inventory.pick(doorBlock(3, true, true)); assert.equal(inventory.block, DOOR);
  const before = inventory.snapshot();
  for (const block of [AIR, WATER, -1, 200, '3', NaN]) assert.equal(inventory.assign(block), false);
  for (const index of [-1, 9, 1.5, '2', NaN]) assert.equal(inventory.select(index), false);
  assert.deepEqual(inventory.snapshot(), before);
});

test('inventory snapshots are independent and invalid or sparse profiles safely use defaults', () => {
  const inventory = new CreativeInventory(); inventory.select(5); inventory.assign(LANTERN);
  const saved = inventory.snapshot(), restored = new CreativeInventory(saved);
  saved.slots[5] = GLASS; assert.equal(restored.block, LANTERN); assert.equal(inventory.block, LANTERN);
  for (const bad of [null, {}, { version: 2, slots: DEFAULT_HOTBAR, selected: 0 },
    { version: 1, slots: new Array(9), selected: 0 }, { version: 1, slots: [...DEFAULT_HOTBAR], selected: 9 }]) {
    assert.equal(validInventory(bad), false); assert.deepEqual(new CreativeInventory(bad).slots, DEFAULT_HOTBAR);
  }
  assert.equal(inventory.reset(), true); assert.deepEqual(inventory.slots, DEFAULT_HOTBAR); assert.equal(inventory.selected, 0);
  assert.equal(inventory.reset(), false);
});

test('world saves retain private hotbars, support older saves, and preserve unknown future inventory formats', () => {
  const world = new ChunkWorld({ seed: 'inventory' }), inventory = new CreativeInventory();
  inventory.select(6); inventory.assign(LANTERN);
  const save = captureSave({ world, id: 'inventory-world', name: 'Inventory world', createdAt: 1, clock: { phase: .18, held: false }, inventory: inventory.snapshot() });
  const loaded = validateSave(JSON.parse(JSON.stringify(save)));
  assert.equal(new CreativeInventory(loaded.inventory).selected, 6); assert.equal(new CreativeInventory(loaded.inventory).block, LANTERN);
  const legacy = { ...save }; delete legacy.inventory; assert.equal(validateSave(legacy), legacy);
  assert.throws(() => validateSave({ ...save, inventory: { ...save.inventory, slots: [AIR, ...save.inventory.slots.slice(1)] } }), /hotbar is invalid/);
  assert.throws(() => validateSave({ ...save, inventory: { ...save.inventory, version: 4 } }), error => error instanceof SaveError && error.code === 'SAVE_INCOMPATIBLE');
});

test('shared world identity survives restoration without sharing a private player hotbar', () => {
  const original = new GameRoom({ gameMode: 'creative' }), saved = original.toSave();
  saved.inventory = new CreativeInventory().snapshot();
  const restored = GameRoom.fromSave(saved), player = restored.join('Builder');
  assert.equal(restored.snapshot(player).worldId, saved.id);
  assert.notEqual(restored.sessionId, original.sessionId);
  assert.equal(restored.snapshot(player).inventory, undefined);
  assert.equal(restored.toSave().inventory, undefined);
});
