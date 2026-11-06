import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.js';
import { PROTOCOL } from '../server/room.js';
import { AIR, SAPLING, SCRAP, BIOFUEL, REPAIR_TOOL } from '../src/world.js';
import { FUEL_SECONDS, WARD_CAPACITY, GROWTH_STAGE_SECONDS } from '../src/upkeep.js';
import { LocalSession } from '../src/session.js';
import { ChunkWorld } from '../src/chunks.js';
import { generateChunk } from '../src/generation.js';
import { browserSaves } from '../src/browser-saves.js';

async function connect(game) {
  const socket = new WebSocket(`ws://127.0.0.1:${game.server.address().port}/multiplayer`), messages = [], waiting = new Set();
  socket.on('message', raw => { messages.push(JSON.parse(raw)); for (const check of waiting) check(); });
  const next = predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(check); reject(new Error('Timed out waiting for upkeep')); }, 5000);
    function check() { const i = messages.findIndex(predicate); if (i >= 0) { clearTimeout(timer); waiting.delete(check); resolve(messages.splice(i, 1)[0]); } }
    waiting.add(check); check();
  });
  let requestId = 0;
  const request = (method, args = {}) => { const id = ++requestId; socket.send(JSON.stringify({ type: 'command', method, requestId: id, ...args })); return next(m => m.type === 'result' && m.requestId === id); };
  socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, name: 'Caretaker' })));
  return { socket, request, next, welcome: await next(m => m.type === 'welcome') };
}

test('shared salvage, repair, and fuel races conserve supplies; growth checkpoints before broadcast and survives restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blockfield-upkeep-')), sockets = [];
  let game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
  t.after(async () => { sockets.forEach(s => s.terminate()); await game.close(); await rm(directory, { recursive: true, force: true }); });
  const a = await connect(game), b = await connect(game); sockets.push(a.socket, b.socket);
  const players = [a, b].map(c => game.room.players.get(c.welcome.self.id));
  const site = game.room.horror.salvage[0], siteKey = `${site.x},${site.y},${site.z}`;
  game.room.upkeep.salvage.get(siteKey).stock = [2, 4, 2];
  for (const player of players) Object.assign(player.pose, { x: site.x + .5, y: site.y, z: site.z + 2.5 });
  let results = await Promise.all([a.request('gatherSalvage', site), b.request('gatherSalvage', site)]);
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.find(r => !r.ok).reason, 'replenishing');
  assert.equal(players.reduce((n, p) => n + p.inventory.count(SCRAP), 0), 2);
  const panel = { x: site.x + 2, y: site.y, z: site.z - 2 };
  assert.equal((await a.request('edit', { ...panel, block: AIR, expected: game.room.expected(panel.x, panel.y, panel.z) })).remaining, 3);
  for (const player of players) { player.inventory.stacks[0] = { block: REPAIR_TOOL, count: 1 }; player.inventory.stacks[1] = { block: SCRAP, count: 1 }; }
  results = await Promise.all([a.request('repair', panel), b.request('repair', panel)]);
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.find(r => !r.ok).reason, 'undamaged');
  assert.equal(players.reduce((n, p) => n + p.inventory.count(SCRAP), 0), 1); assert.equal(game.room.infrastructure.damage.size, 0);
  const cabin = game.room.horror.cabin, ward = { x: cabin.x + 1, y: cabin.y + 1, z: cabin.z + 1 };
  const w = game.room.upkeep.wards.get(`${ward.x},${ward.y},${ward.z}`); w.chargeSeconds = WARD_CAPACITY - FUEL_SECONDS - 1; w.updatedAt = game.room.clock.elapsedSeconds;
  for (const player of players) { Object.assign(player.pose, { x: cabin.x + 3.5, y: ward.y, z: cabin.z + 3.5 }); player.inventory.stacks[2] = { block: BIOFUEL, count: 1 }; }
  results = await Promise.all([a.request('refuelWard', ward), b.request('refuelWard', ward)]);
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.find(r => !r.ok).reason, 'fuel_full');
  assert.equal(players.reduce((n, p) => n + p.inventory.count(BIOFUEL), 0), 1);
  assert.equal((await a.request('setWardPower', { ...ward, enabled: false })).info.enabled, false);
  const p = { x: cabin.x - 1, y: ward.y, z: cabin.z + 2 };
  Object.assign(players[0].pose, { x: p.x - 2, y: p.y, z: p.z }); players[0].inventory.stacks[0] = { block: SAPLING, count: 1 };
  assert.equal((await a.request('edit', { ...p, block: SAPLING, slot: 0, expected: game.room.expected(p.x, p.y, p.z) })).ok, true);
  game.room.upkeep.plants.get(`${p.x},${p.y},${p.z}`).dueAt = game.room.clock.elapsedSeconds;
  await a.next(m => m.type === 'edit' && m.method === 'growth');
  const disk = JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'));
  assert.equal(disk.upkeep.plants[0].stage, 1); assert.equal(disk.upkeep.wards[0].enabled, false);
  await game.close();
  game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
  assert.equal(game.room.upkeep.snapshot().plants[0].stage, 1);
  assert.equal(game.room.world.get(p.x, p.y, p.z), SAPLING + 1);
  assert.equal(game.room.upkeep.wardPower(ward).remainingSeconds, disk.upkeep.wards[0].chargeSeconds);
  assert.deepEqual(game.room.upkeep.snapshot().salvage, disk.upkeep.salvage);
});

test('private growth and fuel changes retain consistent memory on save failure and resume without offline consumption', async t => {
  const previous = globalThis.Worker;
  globalThis.Worker = class {
    postMessage(job) { queueMicrotask(() => this.onmessage?.({ data: { id: job.id, blocks: generateChunk(job.seed, job.cx, job.cz, job.size) } })); }
    terminate() {}
  };
  t.after(() => { if (previous) globalThis.Worker = previous; else delete globalThis.Worker; });
  let fail = false, saved;
  t.mock.method(browserSaves, 'save', async (record, revision) => {
    if (fail) throw new Error('Storage unavailable');
    saved = structuredClone({ ...record, saveRevision: revision + 1 }); return saved;
  });
  const local = new LocalSession(new ChunkWorld({ generate: false })); t.after(() => local.disconnect());
  await local.start('Caretaker', 'Renewable outpost', 'upkeep-private');
  const c = local.horror.cabin, p = { x: c.x - 1, y: c.y + 1, z: c.z + 2 }, ward = { x: c.x + 1, y: p.y, z: c.z + 1 };
  local.pose = () => ({ ...local.self, x: p.x - 2, y: p.y, z: p.z }); local.resources.stacks[0] = { block: SAPLING, count: 1 };
  assert.equal((await local.request('edit', { ...p, block: SAPLING, slot: 0 })).ok, true);
  local.clock.advance(GROWTH_STAGE_SECONDS); fail = true; local.update(0); await local.saving;
  assert.ok(local.saveError); assert.equal(local.world.get(p.x, p.y, p.z), SAPLING + 1);
  assert.equal(local.snapshot().upkeep.plants[0].stage, 1);
  const stopped = local.clock.elapsedSeconds; local.update(60); assert.equal(local.clock.elapsedSeconds, stopped);
  fail = false; assert.equal((await local.request('save')).ok, true);
  local.resources.stacks[0] = { block: BIOFUEL, count: 1 }; fail = true;
  assert.equal((await local.request('refuelWard', ward)).reason, 'storage');
  assert.equal(local.resources.count(BIOFUEL), 0); assert.equal(local.snapshot().upkeep.wards[0].chargeSeconds, WARD_CAPACITY);
  fail = false; assert.equal((await local.request('save')).ok, true);
  const resumed = new LocalSession(new ChunkWorld({ generate: false })); t.after(() => resumed.disconnect());
  await resumed.start('Caretaker', '', '', saved);
  assert.deepEqual(resumed.upkeep.snapshot(), saved.upkeep);
  assert.equal(resumed.clock.elapsedSeconds, stopped); assert.equal(resumed.resources.count(BIOFUEL), 0);
});
