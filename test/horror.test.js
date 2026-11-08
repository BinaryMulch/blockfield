import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { GameRoom, PROTOCOL } from '../server/room.js';
import { createGameServer } from '../server.js';
import { DayClock, DAY_LENGTH } from '../src/clock.js';
import { ChunkWorld } from '../src/chunks.js';
import { generateChunk } from '../src/generation.js';
import { buildStarterCabin } from '../src/horror.js';
import { Inventory } from '../src/inventory.js';
import { LocalSession } from '../src/session.js';
import { browserSaves } from '../src/browser-saves.js';
import { migrateSave, validateSave } from '../src/saves.js';
import { AIR, STONE, WOOD, PLANKS, CONCRETE, STORAGE_CABINET, WARD_LANTERN } from '../src/world.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(game, token = randomUUID()) {
  const socket = new WebSocket(`ws://127.0.0.1:${game.server.address().port}/multiplayer`);
  const messages = [], waiters = new Set();
  socket.on('message', raw => { messages.push(JSON.parse(raw)); for (const check of waiters) check(); });
  const next = predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error('Timed out waiting for Horror state')); }, 5000);
    function check() {
      const i = messages.findIndex(predicate);
      if (i < 0) return;
      clearTimeout(timer); waiters.delete(check); resolve(messages.splice(i, 1)[0]);
    }
    waiters.add(check); check();
  });
  socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, name: 'Survivor', playerToken: token })));
  return { socket, next, welcome: await next(m => m.type === 'welcome') };
}

test('new worlds have a repairable cabin with nearby gathering resources and persistent repairs', () => {
  const room = new GameRoom(), { x, y, z } = room.horror.cabin;
  assert.equal(room.gameMode, 'horror');
  assert.equal(room.world.get(x, y, z), CONCRETE);
  assert.equal(room.world.get(x, y + 1, z), CONCRETE);
  assert.equal(room.world.get(x + 3, y + 1, z + 6), AIR, 'the entrance needs a door');
  assert.equal(room.world.get(x + 6, y + 1, z + 3), AIR, 'the wall needs repairs');
  assert.equal(room.world.get(x + 1, y + 1, z + 1), WARD_LANTERN);
  assert.equal(room.world.get(x + 5, y + 1, z + 1), STORAGE_CABINET);
  assert.equal(room.world.get(x + 4, y + 4, z + 3), AIR, 'the roof needs repairs');
  let nearbyWood = false, nearbyStone = false;
  for (let dz = -16; dz <= 16; dz++) for (let dx = -16; dx <= 16; dx++) for (let h = 1; h < 18; h++) {
    const b = room.world.get(x + dx, h, z + dz);
    nearbyWood ||= b === WOOD; nearbyStone ||= b === STONE;
  }
  assert.ok(nearbyWood && nearbyStone);
  const player = room.join('Builder');
  player.inventory.stacks[0] = { block: PLANKS, count: 1 };
  room.move(player.id, { ...player.pose, x: x + 8.5, y: y + 1, z: z + 3.5 });
  assert.equal(room.command(player.id, { method: 'edit', x: x + 6, y: y + 1, z: z + 3, block: PLANKS, slot: 0, expected: room.expected(x + 6, y + 1, z + 3) }).ok, true);
  const saved = room.toSave(), restored = GameRoom.fromSave(saved);
  restored.world.evict([], 5);
  assert.equal(restored.world.get(x + 6, y + 1, z + 3), PLANKS);
  assert.equal(restored.join('Builder', player.token).inventory.count(PLANKS), 0);
  assert.deepEqual(restored.horror, saved.horror);
});

test('starter cabin overlays are deterministic and do not require a new terrain generator', () => {
  const a = new ChunkWorld({ seed: 'cabin' }), b = new ChunkWorld({ seed: 'cabin' });
  assert.deepEqual(buildStarterCabin(a), buildStarterCabin(b));
  assert.deepEqual([...a.edits], [...b.edits]);
  assert.equal(a.metadata().generator, 1);
});

test('survival clock counts days and elapsed simulation time across saves without offline catchup', () => {
  const clock = new DayClock();
  clock.advance(DAY_LENGTH * 2);
  assert.equal(clock.day, 3); assert.equal(clock.elapsedSeconds, DAY_LENGTH * 2);
  assert.ok(Math.abs(clock.phase - .18) < 1e-12);
  const restored = new DayClock(JSON.parse(JSON.stringify(clock.snapshot())));
  assert.deepEqual(restored.snapshot(), clock.snapshot());
  for (const dt of [-1, Infinity, NaN]) restored.advance(dt);
  assert.deepEqual(restored.snapshot(), clock.snapshot());
});

test('Horror rejects legacy modes and forbidden commands without changing supplies or time', () => {
  for (const mode of ['creative', 'gather', 'unknown']) assert.throws(() => new GameRoom({ gameMode: mode }), /Horror mode only/);
  const room = new GameRoom(), player = room.join('Survivor');
  const clock = room.clock.snapshot(), inventory = player.inventory.snapshot();
  for (const method of ['undo', 'redo', 'time', 'fly']) assert.equal(room.command(player.id, { method, action: 'next' }).reason, 'restricted');
  room.move(player.id, { ...player.pose, flying: true }); assert.equal(player.pose.flying, false);
  assert.deepEqual(room.clock.snapshot(), clock); assert.deepEqual(player.inventory.snapshot(), inventory);
});

test('old Gather worlds retain owned stacks, drops, builds, and phase without adding a cabin', () => {
  const room = new GameRoom(), player = room.join('Survivor');
  player.inventory.stacks[3] = { block: WOOD, count: 17 }; player.inventory.select(3);
  const old = room.toSave(); old.gameMode = 'gather'; old.clock = { phase: .75, held: true }; delete old.horror;
  old.drops = [{ id: 'legacy-drop', block: WOOD, count: 2, x: 256, y: 8, z: 256, readyAt: 10500 }];
  const migrated = migrateSave(old, 10000);
  assert.equal(old.gameMode, 'gather', 'migration does not mutate the source backup');
  assert.equal(migrated.gameMode, 'horror'); assert.equal(migrated.clock.phase, .75); assert.equal(migrated.clock.held, false);
  assert.equal(migrated.clock.elapsedSeconds, 0); assert.equal(migrated.horror.cabin, null);
  assert.equal(migrated.drops[0].readyAt, 500);
  assert.deepEqual(migrated.profiles, old.profiles); assert.deepEqual(migrated.edits, old.edits);
  const restored = GameRoom.fromSave(migrated).join('Survivor', player.token);
  assert.equal(restored.inventory.count(WOOD), 17); assert.equal(restored.inventory.selected, 3);
  assert.deepEqual(migrateSave(migrated), migrated, 'migration is idempotent');
});

test('invalid or future survival state is rejected before a save can replace the world', () => {
  const save = new GameRoom().toSave();
  for (const clock of [{ ...save.clock, elapsedSeconds: -1 }, { ...save.clock, day: 0 }, { ...save.clock, held: true }]) assert.throws(() => validateSave({ ...save, clock }), /survival state/);
  assert.throws(() => validateSave({ ...save, horror: { version: 1, cabin: { x: 511, y: 7, z: 0 } } }), /survival state/);
  assert.throws(() => validateSave({ ...save, horror: { version: 2 } }), e => e.code === 'SAVE_INCOMPATIBLE');
});

test('last disconnect checkpoints exact time and reconnect/restart preserves repairs, supplies and pickup delay', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blockfield-horror-'));
  let game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
  const sockets = [];
  t.after(async () => { sockets.forEach(s => s.terminate()); await game.close(); await rm(directory, { recursive: true, force: true }); });
  await sleep(150); assert.equal(game.room.clock.elapsedSeconds, 0);
  const a = await connect(game), b = await connect(game); sockets.push(a.socket, b.socket);
  await sleep(150); assert.ok(game.room.clock.elapsedSeconds > 0, 'connected menu players keep the simulation running');
  const player = game.room.players.get(a.welcome.self.id);
  const cell = { x: 255, y: 7, z: 255 };
  a.socket.send(JSON.stringify({ type: 'command', requestId: 1, method: 'edit', ...cell, block: AIR, expected: game.room.expected(cell.x, cell.y, cell.z) }));
  assert.equal((await a.next(m => m.type === 'result' && m.requestId === 1)).ok, true);
  a.socket.close(); await once(a.socket, 'close');
  await b.next(m => m.type === 'players' && m.players.length === 1);
  const before = game.room.clock.elapsedSeconds;
  await sleep(150); assert.ok(game.room.clock.elapsedSeconds > before, 'one remaining connection keeps time running');
  let paused;
  const committed = new Promise(resolve => {
    const save = game.persistence.save.bind(game.persistence);
    game.persistence.save = async value => { await save(value); if (!game.room.players.size) { paused = structuredClone(value); resolve(); } };
  });
  b.socket.close(); await once(b.socket, 'close'); await committed;
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'world.json'), 'utf8')).clock, paused.clock);
  await sleep(150); assert.equal(game.room.clock.elapsedSeconds, paused.clock.elapsedSeconds);
  await game.close();
  game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
  await sleep(150); assert.equal(game.room.clock.elapsedSeconds, paused.clock.elapsedSeconds);
  const again = await connect(game, player.token); sockets.push(again.socket);
  assert.equal(again.welcome.clock.phase, paused.clock.phase);
  assert.equal(again.welcome.clock.elapsedSeconds, paused.clock.elapsedSeconds);
  assert.equal(again.welcome.inventory.stacks.some(Boolean), false);
  assert.equal(again.welcome.drops[0].count, 1); assert.deepEqual(again.welcome.drops, paused.drops);
  assert.equal(game.room.world.get(cell.x, cell.y, cell.z), AIR);
  assert.deepEqual(again.welcome.horror, paused.horror);
});

test('private worlds share cabin and clock rules, continue in menus, and resume without offline time', async t => {
  const previousWorker = globalThis.Worker;
  globalThis.Worker = class {
    postMessage(job) { queueMicrotask(() => this.onmessage?.({ data: { id: job.id, blocks: generateChunk(job.seed, job.cx, job.cz, job.size) } })); }
    terminate() {}
  };
  t.after(() => { if (previousWorker) globalThis.Worker = previousWorker; else delete globalThis.Worker; });
  let saved;
  t.mock.method(browserSaves, 'save', async (record, revision) => { saved = structuredClone({ ...record, saveRevision: revision + 1 }); return saved; });
  const local = new LocalSession(new ChunkWorld({ generate: false }));
  t.after(() => local.disconnect());
  await local.start('Survivor', 'Cabin', 'private-cabin');
  assert.equal(local.gameMode, 'horror'); assert.ok(local.horror.cabin);
  local.pose = () => ({ ...local.self, active: false });
  local.update(30); assert.equal(local.clock.elapsedSeconds, 30);
  for (const method of ['time', 'undo', 'redo', 'fly']) assert.equal((await local.request(method)).reason, 'restricted');
  await local.save(); local.disconnect();
  const resumed = new LocalSession(new ChunkWorld({ generate: false }));
  t.after(() => resumed.disconnect());
  await resumed.start('Survivor', '', '', saved);
  assert.equal(resumed.clock.elapsedSeconds, 30); assert.equal(resumed.self.flying, false);
  assert.deepEqual(resumed.horror, local.horror);
  assert.deepEqual(new Inventory(saved.inventory).stacks, Array(36).fill(null));
});

test('drop pickup delays freeze offline and resume from saved simulation seconds', () => {
  const room = new GameRoom(), player = room.join('Survivor');
  player.inventory.stacks[0] = { block: WOOD, count: 2 };
  room.advance(1);
  assert.equal(room.command(player.id, { method: 'drop', source: 0, amount: 1, expectedSource: { block: WOOD, count: 2 } }).ok, true);
  const item = room.drops.snapshot()[0];
  assert.equal(item.readyAt, 2500);
  room.leave(player.id); room.advance(100000);
  assert.equal(room.clock.elapsedSeconds, 1);
  const restored = GameRoom.fromSave(JSON.parse(JSON.stringify(room.toSave()))), again = restored.join('Survivor', player.token);
  restored.move(again.id, { ...again.pose, x: item.x, y: item.y - 0.16, z: item.z, active: true });
  assert.equal(restored.command(again.id, { method: 'pickup' }).reason, 'empty');
  restored.advance(1.5);
  assert.equal(restored.command(again.id, { method: 'pickup' }).ok, true);
  assert.equal(again.inventory.count(WOOD), 2);
});
