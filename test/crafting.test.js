import test from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, RECIPES, INVENTORY_SIZE, matchCrafting, validInventory } from '../src/inventory.js';
import { WOOD, STONE, PLANKS, DOOR, WOODEN_CHEST, WARD_LANTERN, WOODEN_PEGS } from '../src/world.js';
import { GameRoom } from '../server/room.js';
import { validateSave } from '../src/saves.js';
import { LocalSession } from '../src/session.js';
import { ChunkWorld } from '../src/chunks.js';
import { browserSaves } from '../src/browser-saves.js';
import { generateChunk } from '../src/generation.js';

const grid = () => Array(9).fill(null);
const args = (inventory, action, extra = {}) => ({ action, expectedCrafting: inventory.snapshot().crafting, ...extra });

test('every recipe pattern spends exactly its listed ingredients and has a distinct output', () => {
  for (const recipe of RECIPES) {
    const inventory = new Inventory();
    for (const [block, count] of recipe.needs) inventory.applyBalance(inventory.balance(new Map([[block, count]])));
    assert.equal(inventory.action(args(inventory, 'fillRecipe', { block: recipe.block })).ok, true);
    assert.equal(inventory.stacks.some(Boolean), false, 'filling spends exactly the listed ingredients');
    assert.equal(matchCrafting(inventory.crafting)?.recipe.block, recipe.block);
    assert.equal(inventory.action(args(inventory, 'craftGrid')).ok, true);
    assert.equal(inventory.count(recipe.block), recipe.amount);
    assert.equal(inventory.crafting.some(Boolean), false);
  }
});

test('shaped recipes accept translations and mirrors but reject stray items and insufficient cell quantities', () => {
  const inventory = new Inventory();
  for (const index of [1, 2, 4, 5, 7, 8]) inventory.crafting[index] = { block: PLANKS, count: 3 };
  assert.equal(matchCrafting(inventory.crafting)?.recipe.block, DOOR);
  inventory.crafting[0] = { block: STONE, count: 1 };
  assert.equal(matchCrafting(inventory.crafting), null);
  const hammer = RECIPES.at(-1), mirrored = grid();
  hammer.pattern.forEach((row, y) => row.forEach((cell, x) => { mirrored[y * 3 + 2 - x] = cell ? { ...cell } : null; }));
  assert.equal(matchCrafting(mirrored)?.recipe.block, hammer.block);
  const ward = new Inventory();
  RECIPES.find(r => r.block === WARD_LANTERN).needs.forEach(([block, count]) => ward.applyBalance(ward.balance(new Map([[block, count]]))));
  ward.fillRecipe(WARD_LANTERN); ward.crafting[0].count--;
  assert.equal(matchCrafting(ward.crafting), null);
});

test('grid transfers, splits, swaps and shift returns conserve real owned items', () => {
  const inventory = new Inventory(); inventory.stacks[9] = { block: WOOD, count: 12 };
  assert.equal(inventory.action({ action: 'move', source: 9, target: 36, amount: 6, expectedSource: { block: WOOD, count: 12 }, expectedTarget: null }).moved, 6);
  assert.equal(inventory.count(WOOD), 6); assert.equal(inventory.slotCount(36), 6);
  assert.equal(inventory.move(36, 37, 1).moved, 1);
  inventory.stacks[0] = { block: STONE, count: 3 };
  assert.equal(inventory.move(0, 36, 3).swapped, true);
  assert.equal(inventory.slot(36).block, STONE); assert.equal(inventory.stacks[0].count, 5);
  assert.equal(inventory.quickMove(36).moved, 3);
  assert.equal(inventory.slot(36), null); assert.equal(inventory.count(STONE), 3);
  assert.equal(inventory.clearCrafting().ok, true); assert.equal(inventory.count(WOOD), 12);
});

test('taking results consumes a batch and successive clicks merge into the held result stack', () => {
  const inventory = new Inventory(); inventory.crafting[4] = { block: WOOD, count: 3 };
  const first = inventory.action(args(inventory, 'craftGrid'));
  assert.equal(first.ok, true); assert.equal(first.amount, 4); assert.equal(inventory.crafting[4].count, 2);
  const next = inventory.action(args(inventory, 'craftGrid', { target: first.source, expectedTarget: { ...inventory.slot(first.source) } }));
  assert.equal(next.source, first.source); assert.equal(inventory.slot(first.source).count, 8);
  assert.equal(inventory.crafting[4].count, 1);
});

test('shift crafting stops at capacity, never spends failed batches, and cannot exceed stack limits', () => {
  const inventory = new Inventory(); inventory.crafting[0] = { block: WOOD, count: 64 };
  inventory.stacks = Array.from({ length: 36 }, () => ({ block: STONE, count: 64 }));
  const before = inventory.snapshot();
  assert.equal(inventory.action(args(inventory, 'craftGrid')).reason, 'inventory_full');
  assert.deepEqual(inventory.snapshot(), before);
  inventory.stacks[0] = { block: PLANKS, count: 58 };
  const result = inventory.action(args(inventory, 'craftGrid', { all: true }));
  assert.equal(result.batches, 1); assert.equal(result.amount, 4); assert.equal(inventory.stacks[0].count, 62);
  assert.equal(inventory.crafting[0].count, 63);
  inventory.stacks[1] = null;
  assert.equal(inventory.action(args(inventory, 'craftGrid', { all: true })).batches, 16);
  assert.equal(inventory.stacks[0].count, 64); assert.equal(inventory.stacks[1].count, 62);
  assert.equal(validInventory(inventory.snapshot()), true);
});

test('recipe fills and clear operations fail atomically without deleting grid contents', () => {
  const inventory = new Inventory(); inventory.stacks[0] = { block: WOOD, count: 1 };
  inventory.fillRecipe(PLANKS); const before = inventory.snapshot();
  assert.equal(inventory.fillRecipe(WOODEN_CHEST).reason, 'supplies'); assert.deepEqual(inventory.snapshot(), before);
  inventory.stacks = Array.from({ length: 36 }, () => ({ block: STONE, count: 64 }));
  const full = inventory.snapshot();
  assert.equal(inventory.clearCrafting().reason, 'inventory_full'); assert.deepEqual(inventory.snapshot(), full);
});

test('shift recipe filling stocks complete batches and respects per-cell stack capacity', () => {
  const inventory = new Inventory(); inventory.stacks[0] = { block: PLANKS, count: 64 };
  assert.equal(inventory.action(args(inventory, 'fillRecipe', { block: DOOR, all: true })).ok, true);
  assert.equal(inventory.crafting.filter(Boolean).length, 6);
  assert.equal(inventory.crafting[0].count, 10); assert.equal(inventory.count(PLANKS), 4);
  assert.equal(inventory.action(args(inventory, 'craftGrid', { all: true })).amount, 10);
  assert.equal(inventory.count(DOOR), 10); assert.equal(inventory.crafting.some(Boolean), false);
});

test('stale grid requests, forged output choices and invalid moves cannot mint supplies', () => {
  const inventory = new Inventory(); inventory.crafting[0] = { block: WOOD, count: 2 };
  const before = inventory.snapshot();
  for (const request of [
    { action: 'craftGrid', expectedCrafting: grid() },
    args(inventory, 'craftGrid', { target: 45, expectedTarget: null }),
    { action: 'move', source: 36, target: 45, amount: 2, expectedSource: { block: WOOD, count: 2 }, expectedTarget: null },
    args(inventory, 'fillRecipe', { block: 999 }),
  ]) { assert.equal(inventory.action(request).ok, false); assert.deepEqual(inventory.snapshot(), before); }
  const result = inventory.action(args(inventory, 'craftGrid', { block: WOODEN_CHEST, amount: 64 }));
  assert.equal(result.block, PLANKS); assert.equal(result.amount, 4);
});

test('crafting ingredients are cloned, validated and restored in shared saves without becoming build supplies', () => {
  const room = new GameRoom(), player = room.join('Crafter');
  player.inventory.stacks[0] = { block: PLANKS, count: 2 }; player.inventory.fillRecipe(WOODEN_PEGS);
  assert.equal(player.inventory.count(PLANKS), 0);
  assert.equal(player.inventory.plan([{ from: 0, to: PLANKS }], 0).ok, false);
  const saved = room.toSave(); validateSave(saved);
  const restored = GameRoom.fromSave(JSON.parse(JSON.stringify(saved)));
  const inventory = [...restored.profiles.values()][0];
  assert.equal(inventory.crafting[0].block, PLANKS); assert.equal(inventory.crafting[3].block, PLANKS);
  assert.equal(inventory.craftGrid().block, WOODEN_PEGS);
  const snapshot = player.inventory.snapshot(); snapshot.crafting[0].count = 64;
  assert.equal(player.inventory.crafting[0].count, 1);
  for (const crafting of [new Array(9), Array(8).fill(null), [...grid().slice(0, 8), { block: WOOD, count: 65 }]]) {
    assert.equal(validInventory({ ...snapshot, crafting }), false);
  }
  const legacy = { ...player.inventory.snapshot() }; delete legacy.crafting;
  assert.equal(new Inventory(legacy).crafting.some(Boolean), false);
  assert.equal(INVENTORY_SIZE, 36);
});

test('private grid moves and results save together and recover consistently after storage failure', async t => {
  const previousWorker = globalThis.Worker;
  globalThis.Worker = class {
    postMessage(job) { queueMicrotask(() => this.onmessage?.({ data: { id: job.id, blocks: generateChunk(job.seed, job.cx, job.cz, job.size) } })); }
    terminate() {}
  };
  t.after(() => { if (previousWorker) globalThis.Worker = previousWorker; else delete globalThis.Worker; });
  let saved, fail = false;
  t.mock.method(browserSaves, 'save', async (record, revision) => {
    if (fail) throw new Error('Storage unavailable');
    saved = structuredClone({ ...record, saveRevision: revision + 1 }); return saved;
  });
  const local = new LocalSession(new ChunkWorld({ generate: false })); t.after(() => local.disconnect());
  await local.start('Crafter', 'Crafting world', 'crafting-private');
  local.resources.stacks[0] = { block: WOOD, count: 3 };
  assert.equal((await local.request('inventory', { action: 'move', source: 0, target: 36, amount: 3, expectedSource: { block: WOOD, count: 3 }, expectedTarget: null })).ok, true);
  assert.deepEqual(saved.inventory.crafting[0], { block: WOOD, count: 3 });
  fail = true;
  assert.equal((await local.request('inventory', args(local.resources, 'craftGrid'))).reason, 'storage');
  assert.equal(local.resources.count(PLANKS), 4); assert.equal(local.resources.crafting[0].count, 2);
  fail = false; assert.equal((await local.request('save')).ok, true);
  const restored = new LocalSession(new ChunkWorld({ generate: false })); t.after(() => restored.disconnect());
  await restored.start('Crafter', '', '', saved);
  assert.equal(restored.resources.count(PLANKS), 4); assert.equal(restored.resources.crafting[0].count, 2);
  const result = await restored.request('inventory', args(restored.resources, 'craftGrid', { all: true }));
  assert.equal(result.amount, 8); assert.equal(saved.inventory.crafting.some(Boolean), false);
  assert.equal(restored.resources.count(PLANKS), 12);
});
