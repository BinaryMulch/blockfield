import test from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, MATERIALS, DEFAULT_HOTBAR, validInventory } from '../src/inventory.js';
import { STONE, LANTERN, SLAB, UPPER_SLAB, DOOR, DAISY, doorBlock } from '../src/world.js';
import { ChunkWorld } from '../src/chunks.js';
import { captureSave, validateSave, migrateSave, SaveError } from '../src/saves.js';
import { GameRoom } from '../server/room.js';

test('every new inventory starts finite and empty with a valid material catalog', () => {
  const inventory = new Inventory();
  assert.equal(MATERIALS.length, 24);
  assert.equal(new Set(MATERIALS.map(item => item.id)).size, MATERIALS.length);
  assert.deepEqual(inventory.hotbar, Array(9).fill(0));
  assert.equal(inventory.count(STONE), 0);
  assert.equal(inventory.assign(LANTERN), false);
  assert.equal(validInventory(inventory.snapshot()), true);
});

test('picking only selects owned materials and swaps backpack supplies into the hotbar', () => {
  const inventory = new Inventory();
  assert.equal(inventory.pick(DAISY), false);
  inventory.stacks[2] = { block: STONE, count: 4 };
  inventory.stacks[9] = { block: DAISY, count: 2 };
  inventory.pick(STONE); assert.equal(inventory.selected, 2);
  inventory.pick(DAISY); assert.equal(inventory.block, DAISY);
  assert.deepEqual(inventory.stacks[9], { block: STONE, count: 4 });
});

test('picked door and slab states normalize to owned placeable items', () => {
  const inventory = new Inventory();
  inventory.stacks[0] = { block: SLAB, count: 1 };
  inventory.stacks[1] = { block: DOOR, count: 1 };
  inventory.select(2); inventory.pick(UPPER_SLAB); assert.equal(inventory.block, SLAB);
  inventory.pick(doorBlock(3, true, true)); assert.equal(inventory.block, DOOR);
  const before = inventory.snapshot();
  for (const index of [-1, 9, 1.5, '2', NaN]) assert.equal(inventory.select(index), false);
  assert.deepEqual(inventory.snapshot(), before);
});

test('legacy Creative layouts never grant unlimited or unearned supplies', () => {
  const legacy = { version: 1, slots: [...DEFAULT_HOTBAR], selected: 5 };
  const inventory = new Inventory(legacy);
  assert.equal(validInventory(legacy), true);
  assert.equal(inventory.selected, 5);
  assert.deepEqual(inventory.stacks, Array(36).fill(null));
  for (const bad of [null, {}, { version: 1, slots: new Array(9), selected: 0 }]) {
    assert.equal(validInventory(bad), false);
    assert.deepEqual(new Inventory(bad).stacks, Array(36).fill(null));
  }
});

test('private supplies and layouts round trip and unknown future inventory versions are preserved', () => {
  const world = new ChunkWorld({ seed: 'inventory' }), inventory = new Inventory();
  inventory.stacks[6] = { block: LANTERN, count: 3 }; inventory.select(6);
  const save = captureSave({ world, id: 'inventory-world', name: 'Inventory world', createdAt: 1, clock: { phase: .18, held: false }, inventory: inventory.snapshot() });
  const loaded = validateSave(JSON.parse(JSON.stringify(save)));
  const restored = new Inventory(loaded.inventory);
  loaded.inventory.stacks[6].count = 1;
  assert.equal(restored.selected, 6); assert.equal(restored.count(LANTERN), 3);
  assert.throws(() => validateSave({ ...save, inventory: { ...save.inventory, stacks: new Array(36) } }), /hotbar is invalid/);
  assert.throws(() => validateSave({ ...save, inventory: { ...save.inventory, version: 4 } }), error => error instanceof SaveError && error.code === 'SAVE_INCOMPATIBLE');
});

test('legacy shared worlds migrate identity and finite per-player supplies without adding a cabin', () => {
  const original = new GameRoom(), saved = original.toSave();
  saved.gameMode = 'creative'; delete saved.horror; delete saved.drops;
  saved.inventory = { version: 1, slots: [...DEFAULT_HOTBAR], selected: 0 };
  const migrated = migrateSave(saved), restored = GameRoom.fromSave(saved), player = restored.join('Builder');
  assert.equal(migrated.gameMode, 'horror');
  assert.equal(restored.snapshot(player).worldId, saved.id);
  assert.notEqual(restored.sessionId, original.sessionId);
  assert.deepEqual(restored.snapshot(player).inventory.stacks, Array(36).fill(null));
  assert.equal(restored.toSave().inventory, undefined);
  assert.equal(restored.horror.cabin, null);
  assert.deepEqual(restored.toSave().edits, saved.edits);
});
