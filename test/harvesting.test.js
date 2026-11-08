import test from 'node:test';
import assert from 'node:assert/strict';
import { World, AIR, STONE, WOOD, DIRT, LANTERN, DOOR, doorBlock } from '../src/world.js';
import { Inventory } from '../src/inventory.js';
import { Infrastructure, strength, validInfrastructure } from '../src/infrastructure.js';
import { EditHistory } from '../src/history.js';
import { ItemDrops, MAX_DROPS, validDrops } from '../src/drops.js';
import { GameRoom } from '../server/room.js';
import { LocalSession } from '../src/session.js';
import { ChunkWorld } from '../src/chunks.js';
import { generateChunk, chunkIndex } from '../src/generation.js';
import { validateSave } from '../src/saves.js';
import { browserSaves } from '../src/browser-saves.js';

function fixture(block = WOOD) {
  const world = new World({ generate: false });
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) world.set(x, 0, z, STONE);
  world.set(8, 1, 8, block);
  const inventory = new Inventory(), drops = new ItemDrops(), infrastructure = new Infrastructure(world), history = new EditHistory(world);
  Object.assign(history, { inventory, drops, infrastructure });
  let time = 0;
  return { world, inventory, drops, infrastructure, history, hit() { history.attackTime = time; time += .31; return history.edit(8, 1, 8, AIR); } };
}

for (const block of [WOOD, STONE]) test(`${block === WOOD ? 'logs' : 'stone'} take three authoritative hits and drop at the broken cell before delayed pickup`, () => {
  const s = fixture(block), pose = { x: 8.5, y: 1.01, z: 8.5, active: true };
  assert.equal(strength(block), 3);
  assert.equal(s.hit().remaining, 2); assert.equal(s.world.get(8, 1, 8), block); assert.equal(s.drops.items.length, 0);
  assert.equal(s.hit().remaining, 1); assert.equal(s.inventory.count(block), 0);
  assert.equal(validInfrastructure([], s.infrastructure.snapshot().construction, s.world.size), true);
  assert.equal(s.hit().dropsChanged, true); assert.equal(s.world.get(8, 1, 8), AIR);
  assert.equal(s.infrastructure.damage.size, 0); assert.equal(s.inventory.count(block), 0);
  const item = s.drops.items[0]; assert.deepEqual([item.x, item.z, item.block, item.count], [8.5, 8.5, block, 1]);
  assert.equal(validDrops(s.drops.snapshot(), s.world.size), true);
  assert.equal(s.drops.pickup(s.world, s.inventory, pose, item.readyAt - 1).ok, false);
  assert.equal(s.drops.pickup(s.world, s.inventory, pose, item.readyAt).ok, true);
  assert.equal(s.inventory.count(block), 1); assert.equal(s.drops.items.length, 0);
});

test('breaking with a full inventory leaves collectible ground supplies and includes supported fixtures exactly once', () => {
  const s = fixture(WOOD); s.world.set(8, 2, 8, LANTERN);
  s.inventory.stacks = Array.from({ length: 36 }, () => ({ block: DIRT, count: 64 }));
  s.hit(); s.hit(); assert.equal(s.hit().ok, true);
  assert.equal(s.world.get(8, 2, 8), AIR);
  assert.deepEqual(s.drops.items.map(item => [item.block, item.count]), [[WOOD, 1], [LANTERN, 1]]);
  assert.equal(s.inventory.count(WOOD), 0); assert.equal(s.inventory.count(LANTERN), 0);
  assert.equal(s.drops.pickup(s.world, s.inventory, { x: 8.5, y: 1.01, z: 8.5, active: true }, 5000).ok, false);
  assert.equal(s.drops.items.length, 2);
});

test('a two-cell door produces one ground item and a full drop pool refuses removal without loss', () => {
  const s = fixture(doorBlock(0)); s.world.set(8, 2, 8, doorBlock(0, false, true));
  assert.equal(s.hit().ok, true); assert.equal(s.world.get(8, 2, 8), AIR);
  assert.deepEqual(s.drops.items.map(item => [item.block, item.count]), [[DOOR, 1]]);
  const full = fixture(DIRT);
  full.drops.items = Array.from({ length: MAX_DROPS }, (_, i) => ({ id: `item-${i}`, block: DIRT, count: 1, x: 3.5, y: 1.2, z: 3.5, readyAt: 0 }));
  assert.equal(full.hit().reason, 'drops_full'); assert.equal(full.world.get(8, 1, 8), DIRT);
  assert.equal(full.inventory.count(DIRT), 0); assert.equal(full.drops.items.length, MAX_DROPS);
});

test('partial mining damage survives shared save/rejoin and final harvest saves a ground item instead of inventory credit', () => {
  const room = new GameRoom(), player = room.join('Miner'), c = room.horror.cabin, p = { x: c.x - 1, y: c.y + 1, z: c.z + 2 };
  room.world.set(p.x, p.y, p.z, STONE); Object.assign(player.pose, { x: p.x - 2, y: p.y, z: p.z });
  const strike = (r, actor) => r.command(actor.id, { method: 'edit', ...p, block: AIR, expected: r.expected(p.x, p.y, p.z) });
  assert.equal(strike(room, player).remaining, 2); assert.equal(strike(room, player).reason, 'cooldown');
  const saved = room.toSave(), restored = GameRoom.fromSave(JSON.parse(JSON.stringify(saved))), again = restored.join('Miner', player.token);
  Object.assign(again.pose, player.pose);
  assert.equal(restored.infrastructure.damage.get(`${p.x},${p.y},${p.z}`).remaining, 2);
  assert.equal(strike(restored, again).remaining, 1); restored.clock.elapsedSeconds += .31;
  assert.equal(strike(restored, again).ok, true); assert.equal(again.inventory.count(STONE), 0);
  const loaded = GameRoom.fromSave(JSON.parse(JSON.stringify(restored.toSave())));
  assert.equal(loaded.world.get(p.x, p.y, p.z), AIR); assert.equal(loaded.drops.items[0].block, STONE);
});

function naturalBlock(world, block) {
  const chunk = world.getChunk(0, 0), index = chunk.blocks.findIndex((value, i) => value === block && i >= 256);
  assert.ok(index >= 256, 'fixture must find an untouched generated block');
  const p = { x: index % 16, y: Math.floor(index / 256), z: Math.floor(index / 16) % 16 };
  assert.equal(world.edits.get('0,0')?.has(index) || false, false);
  return p;
}

for (const block of [WOOD, STONE]) test(`untouched generated ${block === WOOD ? 'trees' : 'stone'} save every mining hit and restore damage before the final drop`, () => {
  const world = new ChunkWorld({ seed: 'natural-mining-regression' }), p = naturalBlock(world, block);
  let room = new GameRoom({ world }), player = room.join('Miner');
  const token = player.token;
  for (let hit = 1; hit <= 3; hit++) {
    Object.assign(player.pose, { x: p.x + .5, y: p.y, z: p.z + 2.5 });
    room.clock.elapsedSeconds += .31;
    const result = room.command(player.id, { method: 'edit', ...p, block: AIR, expected: room.expected(p.x, p.y, p.z) });
    assert.equal(result.ok, true);
    const saved = room.toSave(); assert.doesNotThrow(() => validateSave(saved));
    if (hit < 3) {
      assert.equal(result.remaining, 3 - hit);
      assert.equal(saved.edits.some(([key, cells]) => key === '0,0' && cells.some(([i]) => i === chunkIndex(p.x, p.y, p.z))), false, 'partial damage must not require a synthetic terrain edit');
    } else {
      assert.equal(saved.construction.length, 0); assert.equal(saved.drops[0].block, block);
      assert.equal(player.inventory.count(block), 0);
    }
    room = GameRoom.fromSave(JSON.parse(JSON.stringify(saved))); player = room.join('Miner', token);
    assert.equal(room.world.get(p.x, p.y, p.z), hit === 3 ? AIR : block);
    if (hit < 3) assert.equal(room.infrastructure.damage.get(`${p.x},${p.y},${p.z}`).remaining, 3 - hit);
  }
});

test('seed-aware damage validation still rejects wrong materials and explicit removals of a damaged natural block', () => {
  const world = new ChunkWorld({ seed: 'natural-mining-regression' }), p = naturalBlock(world, WOOD), room = new GameRoom({ world });
  room.infrastructure.setDamage({ ...p, block: WOOD, remaining: 2 });
  const saved = room.toSave();
  const wrong = structuredClone(saved); wrong.construction[0].block = STONE;
  assert.throws(() => validateSave(wrong), /damage do not match/);
  const removed = structuredClone(saved); removed.edits.push(['0,0', [[chunkIndex(p.x, p.y, p.z), AIR]]]);
  assert.throws(() => validateSave(removed), /damage do not match/);
  const replaced = structuredClone(removed); replaced.edits[0][1][0][1] = STONE;
  assert.throws(() => validateSave(replaced), /damage do not match/);
});

test('private mining checkpoints generated trees to browser storage and resumes without a save error', async t => {
  const previousWorker = globalThis.Worker;
  globalThis.Worker = class {
    postMessage(job) { queueMicrotask(() => this.onmessage?.({ data: { id: job.id, blocks: generateChunk(job.seed, job.cx, job.cz, job.size) } })); }
    terminate() {}
  };
  t.after(() => { if (previousWorker) globalThis.Worker = previousWorker; else delete globalThis.Worker; });
  let saved;
  t.mock.method(browserSaves, 'save', async (record, revision) => {
    validateSave(record); saved = structuredClone({ ...record, saveRevision: revision + 1 }); return saved;
  });
  const local = new LocalSession(new ChunkWorld({ generate: false })); t.after(() => local.disconnect());
  await local.start('Miner', 'Natural tree save', 'natural-mining-regression');
  await local.generate(0, 0);
  const p = naturalBlock(local.world, WOOD);
  local.pose = () => ({ ...local.self, x: p.x + .5, y: p.y, z: p.z + 2.5 });
  assert.equal((await local.request('edit', { ...p, block: AIR })).remaining, 2);
  assert.equal(local.saveError, null); assert.equal(saved.construction.find(d => d.x === p.x && d.y === p.y && d.z === p.z).remaining, 2);
  const resumed = new LocalSession(new ChunkWorld({ generate: false })); t.after(() => resumed.disconnect());
  await resumed.start('Miner', '', '', saved); await resumed.generate(0, 0);
  resumed.pose = local.pose;
  assert.equal((await resumed.request('edit', { ...p, block: AIR })).remaining, 1);
  resumed.clock.elapsedSeconds += .31;
  assert.equal((await resumed.request('edit', { ...p, block: AIR })).ok, true);
  assert.equal(resumed.saveError, null); assert.equal(saved.construction.length, 0);
  assert.equal(saved.drops[0].block, WOOD); assert.equal(saved.inventory.stacks.some(Boolean), false);
});

test('private harvesting publishes and retains the same block/drop state when a checkpoint fails', async () => {
  const s = fixture(DIRT), published = {};
  const local = Object.assign(Object.create(LocalSession.prototype), { world: s.world, resources: s.inventory, history: s.history, drops: s.drops,
    clock: { elapsedSeconds: 3 }, ready: true, closed: false, editing: false, callbacks: {
      drops: items => { published.drops = items; }, edit: event => { published.changes = event.changes; },
    } });
  let saved;
  local.save = async () => { saved = { inventory: local.resources.snapshot(), drops: local.drops.snapshot(), block: s.world.get(8, 1, 8) }; return false; };
  const result = await local.request('edit', { x: 8, y: 1, z: 8, block: AIR });
  assert.equal(result.reason, 'storage'); assert.equal(saved.block, AIR); assert.equal(saved.inventory.stacks.some(Boolean), false);
  assert.equal(saved.drops[0].block, DIRT); assert.equal(saved.drops[0].readyAt, 3900);
  assert.deepEqual(published.drops.map(({ spawnY, ...item }) => item), saved.drops);
  assert.equal(published.drops[0].spawnY, 1.35); assert.equal(published.changes[0].to, AIR);
  assert.equal(local.editing, false);
});
