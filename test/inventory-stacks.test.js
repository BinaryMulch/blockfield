import test from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, emptyGatherInventory, DEFAULT_HOTBAR, CREATIVE_ITEMS, validInventory } from '../src/inventory.js';
import { WOOD, STONE, DIRT, PLANKS, LANTERN } from '../src/world.js';
const fresh = () => new Inventory(emptyGatherInventory());
const add = (inventory, block, count) => { const result = inventory.balance(new Map([[block, count]])); assert.equal(result.ok, true); inventory.applyBalance(result); };

test('legacy counted inventories migrate each supply once, retaining owned hotbar items and all remaining materials', () => {
  const counts = CREATIVE_ITEMS.map((_, i) => i + 1), slots = [...DEFAULT_HOTBAR]; slots[1] = WOOD; slots[2] = WOOD;
  const inventory = new Inventory({ version: 2, mode: 'gather', slots, selected: 2, counts });
  assert.equal(inventory.snapshot().version, 3); assert.equal(inventory.stacks.length, 36); assert.equal(inventory.stacks[1].block, WOOD); assert.equal(inventory.stacks[2], null);
  for (let i = 0; i < counts.length; i++) assert.equal(inventory.count(CREATIVE_ITEMS[i].id), counts[i]);
  assert.equal(inventory.selected, 2); assert.equal(validInventory(inventory.snapshot()), true);
});

test('collection fills matching stacks then empty slots, allows multiple stacks per material, and refuses overflow atomically', () => {
  const inventory = fresh(); add(inventory, WOOD, 130); assert.deepEqual(inventory.stacks.slice(0, 3).map(stack => stack.count), [64, 64, 2]);
  const total = 36 * 64; add(inventory, WOOD, total - 130); const before = inventory.snapshot();
  assert.equal(inventory.balance(new Map([[DIRT, 1]])).reason, 'inventory_full'); assert.deepEqual(inventory.snapshot(), before);
  assert.equal(inventory.count(WOOD), total);
});

test('left moves, splits, merges to 64, and whole-stack swaps conserve every item', () => {
  const inventory = fresh(); add(inventory, WOOD, 64); add(inventory, STONE, 5);
  assert.equal(inventory.move(0, 9, 32).moved, 32); assert.equal(inventory.slotCount(0), 32); assert.equal(inventory.slotCount(9), 32);
  assert.equal(inventory.move(0, 9, 1).moved, 1); assert.equal(inventory.slotCount(9), 33);
  assert.equal(inventory.move(0, 9, 31).moved, 31); assert.equal(inventory.stacks[0], null); assert.equal(inventory.slotCount(9), 64);
  assert.equal(inventory.move(9, 1, 1).reason, 'occupied');
  assert.equal(inventory.move(9, 1, 64).swapped, true); assert.equal(inventory.stacks[1].block, WOOD); assert.equal(inventory.stacks[9].block, STONE);
  assert.equal(inventory.count(WOOD), 64); assert.equal(inventory.count(STONE), 5);
});

test('shift moves merge first, cross only between backpack and hotbar, and support partial transfers', () => {
  const inventory = fresh(); add(inventory, WOOD, 64); inventory.move(0, 9, 10); inventory.move(0, 10, 30);
  assert.equal(inventory.quickMove(9).moved, 10); assert.equal(inventory.slotCount(0), 34); assert.equal(inventory.stacks[9], null);
  for (let i = 1; i < 9; i++) inventory.stacks[i] = { block: STONE, count: 64 };
  assert.equal(inventory.quickMove(10).moved, 30); assert.equal(inventory.slotCount(0), 64);
  inventory.stacks[11] = { block: WOOD, count: 12 };
  assert.equal(inventory.quickMove(11).reason, 'inventory_full'); assert.equal(inventory.slotCount(11), 12);
  assert.equal(inventory.quickMove(0).ok, true); assert.equal(inventory.count(WOOD), 76); assert.equal(inventory.stacks[0], null);
});

test('authoritative transfers reject stale snapshots, out-of-range slots, excess quantities, and injected counts', () => {
  const inventory = fresh(); add(inventory, WOOD, 5); const initial = inventory.snapshot();
  for (const args of [
    { action: 'move', source: 0, target: 9, amount: 64, expectedSource: { block: WOOD, count: 5 }, expectedTarget: null },
    { action: 'move', source: 0, target: 9, amount: 5, expectedSource: { block: WOOD, count: 64 }, expectedTarget: null },
    { action: 'move', source: 0, target: 99, amount: 5, expectedSource: { block: WOOD, count: 5 }, expectedTarget: null },
    { action: 'replace', stacks: Array(36).fill({ block: LANTERN, count: 64 }) },
  ]) { assert.equal(inventory.action(args).ok, false); assert.deepEqual(inventory.snapshot(), initial); }
  assert.equal(inventory.action({ action: 'move', source: 0, target: 9, amount: 2, expectedSource: initial.stacks[0], expectedTarget: null }).ok, true);
  assert.equal(inventory.count(WOOD), 5);
});

test('placing uses the chosen hotbar stack while crafting and undo can consume from storage', () => {
  const inventory = fresh(); add(inventory, WOOD, 4); inventory.move(0, 9, 4);
  assert.equal(inventory.plan([{ from: 0, to: WOOD }], 0).reason, 'supplies');
  assert.equal(inventory.plan([{ from: 0, to: WOOD }]).ok, true);
  assert.equal(inventory.craft(PLANKS).ok, true); assert.equal(inventory.count(WOOD), 3); assert.equal(inventory.count(PLANKS), 4);
  assert.equal(inventory.pick(WOOD), true); assert.equal(inventory.block, WOOD); assert.equal(inventory.count(WOOD), 3); assert.equal(inventory.count(PLANKS), 4);
  assert.equal(inventory.count(LANTERN), 0); assert.equal(inventory.assign(LANTERN), false);
});

test('crafting uses slots freed by ingredients and refuses a full output without spending inputs', () => {
  const inventory = fresh(); inventory.stacks = Array.from({ length: 36 }, () => ({ block: STONE, count: 64 })); inventory.stacks[0] = { block: WOOD, count: 2 };
  const before = inventory.snapshot(); assert.equal(inventory.craft(PLANKS).reason, 'inventory_full'); assert.deepEqual(inventory.snapshot(), before);
  inventory.stacks[0].count = 1; assert.equal(inventory.craft(PLANKS).ok, true); assert.deepEqual(inventory.stacks[0], { block: PLANKS, count: 4 });
});

test('many stack transfers preserve total resources and valid bounded independent snapshots', () => {
  const inventory = fresh(); add(inventory, WOOD, 500); add(inventory, STONE, 300);
  let seed = 17; const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 1500; i++) {
    const source = random(36), target = random(36), stack = inventory.stacks[source];
    if (stack) { if (i % 4 === 0) inventory.quickMove(source); else inventory.move(source, target, 1 + random(stack.count), i % 2 === 0); }
    assert.equal(inventory.count(WOOD), 500); assert.equal(inventory.count(STONE), 300); assert.equal(validInventory(inventory.snapshot()), true);
  }
  const saved = inventory.snapshot(), restored = new Inventory(saved); saved.stacks.fill(null); assert.equal(restored.count(WOOD), 500);
});
