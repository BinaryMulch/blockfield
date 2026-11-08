import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.js';
import { PROTOCOL, GameRoom } from '../server/room.js';
import { LocalSession } from '../src/session.js';
import { ChunkWorld } from '../src/chunks.js';
import { generateChunk } from '../src/generation.js';
import { browserSaves } from '../src/browser-saves.js';
import { AIR, STONE, REINFORCED_PANEL } from '../src/world.js';

async function connect(game, token) {
  const socket = new WebSocket(`ws://127.0.0.1:${game.server.address().port}/multiplayer`), messages = [], waiting = new Set();
  socket.on('message', raw => { messages.push(JSON.parse(raw)); for (const check of waiting) check(); });
  const next = predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(check); reject(new Error('Timed out waiting for Listener state')); }, 5000);
    function check() { const i = messages.findIndex(predicate); if (i >= 0) { clearTimeout(timer); waiting.delete(check); resolve(messages.splice(i, 1)[0]); } }
    waiting.add(check); check();
  });
  let requestId = 0;
  const request = (method, args = {}) => { const id = ++requestId; socket.send(JSON.stringify({ type: 'command', method, requestId: id, ...args })); return next(m => m.type === 'result' && m.requestId === id); };
  socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, name: 'Quiet survivor', playerToken: token })));
  return { socket, next, request, welcome: await next(m => m.type === 'welcome') };
}

test('one authoritative Listener is shared, saved, paused offline, and restored on joining', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blockfield-listener-')), sockets = [];
  let game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
  t.after(async () => { sockets.forEach(s => s.terminate()); await game.close(); await rm(directory, { recursive: true, force: true }); });
  game.room.clock.elapsedSeconds = 200; game.room.clock.phase = .65;
  const a = await connect(game), b = await connect(game); sockets.push(a.socket, b.socket);
  assert.equal(a.welcome.listener.state, 'dormant');
  const p = { x: 254, y: 7, z: 256 };
  assert.equal((await a.request('edit', { ...p, block: AIR, expected: game.room.expected(p.x, p.y, p.z) })).ok, true);
  const first = await a.next(m => m.type === 'players' && m.listener?.state !== 'dormant');
  const other = await b.next(m => m.type === 'players' && m.listener?.state !== 'dormant');
  assert.deepEqual(first.listener, other.listener);
  assert.equal((await a.request('inventory', { action: 'select', index: 1 })).ok, true);
  const current = JSON.parse(await readFile(join(directory, 'world.json'), 'utf8')); assert.notEqual(current.listener.state, 'dormant');
  await game.close();
  const saved = JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'));
  game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
  assert.deepEqual(game.room.listener.snapshot(), saved.listener);
  game.room.advance(10000); assert.deepEqual(game.room.listener.snapshot(), saved.listener); assert.equal(game.room.clock.elapsedSeconds, saved.clock.elapsedSeconds);
  const returning = await connect(game, a.welcome.playerToken); sockets.push(returning.socket);
  assert.equal(returning.welcome.listener.x, saved.listener.x); assert.equal(returning.welcome.listener.cueSeq, saved.listener.cueSeq);
  assert.equal(game.room.world.get(p.x, p.y, p.z), AIR);
});

test('private noise uses the same Listener rules, and save errors freeze encounters for retry', async t => {
  const previous = globalThis.Worker;
  globalThis.Worker = class { postMessage(job) { queueMicrotask(() => this.onmessage?.({ data: { id: job.id, blocks: generateChunk(job.seed, job.cx, job.cz, job.size) } })); } terminate() {} };
  t.after(() => { if (previous) globalThis.Worker = previous; else delete globalThis.Worker; });
  let fail = false, saved;
  t.mock.method(browserSaves, 'save', async (record, revision) => { if (fail) throw new Error('Storage unavailable'); saved = structuredClone({ ...record, saveRevision: revision + 1 }); return saved; });
  const local = new LocalSession(new ChunkWorld({ generate: false })); t.after(() => local.disconnect());
  const states = []; local.callbacks.listener = state => states.push(state);
  await local.start('Survivor', 'Listener night', 'listener-private');
  local.clock.elapsedSeconds = 200; local.clock.phase = .65;
  const p = { x: 240, y: 7, z: 236 };
  local.world.autoGenerate = true;
  for (let x = 214; x <= 258; x++) for (let z = 210; z <= 246; z++) for (let y = 7; y < 24; y++) local.world.set(x, y, z, y === 7 ? STONE : AIR);
  local.world.autoGenerate = false;
  local.pose = () => ({ ...local.self, x: 238.5, y: 8.01, z: 236.5, active: true });
  assert.equal((await local.request('edit', { ...p, block: AIR })).ok, true);
  for (let i = 0; i < 40 && local.listener.entity.state === 'dormant'; i++) { local.update(.2); await new Promise(resolve => setImmediate(resolve)); } assert.notEqual(local.listener.entity.state, 'dormant'); assert.ok(states.some(s => s.cueSeq > 0));
  fail = true; assert.equal((await local.request('save')).ok, false);
  const paused = local.listener.snapshot(), time = local.clock.elapsedSeconds; local.update(20);
  assert.deepEqual(local.listener.snapshot(), paused); assert.equal(local.clock.elapsedSeconds, time);
  fail = false; assert.equal((await local.request('save')).ok, true);
  const resumed = new LocalSession(new ChunkWorld({ generate: false })); t.after(() => resumed.disconnect());
  await resumed.start('Survivor', '', '', saved);
  assert.deepEqual(resumed.listener.snapshot(), paused); assert.equal(resumed.clock.elapsedSeconds, time);
});

test('a shared contact checkpoints before publication; teammate rescue corrects pose and survives restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blockfield-contact-')), sockets = [];
  let game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
  t.after(async () => { sockets.forEach(s => s.terminate()); await game.close(); await rm(directory, { recursive: true, force: true }); });
  const a = await connect(game), b = await connect(game); sockets.push(a.socket, b.socket);
  const room = game.room, pa = room.players.get(a.welcome.self.id), pb = room.players.get(b.welcome.self.id);
  const supplies = pa.inventory.snapshot();
  for (let x = 249; x <= 256; x++) for (let z = 250; z <= 257; z++) for (let y = 7; y < 24; y++) room.world.set(x, y, z, y === 7 ? STONE : AIR);
  Object.assign(pa.pose, { x: 252.5, y: 8.01, z: 254.5, active: true });
  Object.assign(pb.pose, { x: 254.5, y: 8.01, z: 254.5, active: true });
  room.clock.elapsedSeconds = 200; room.clock.phase = .65;
  Object.assign(room.listener.entity, { state: 'stalk', x: 251.5, y: 8.01, z: 254.5, target: { x: 252.5, y: 8.01, z: 254.5 }, home: { x: 245.5, y: 8.01, z: 254.5 }, interestUntil: 250, encounterUntil: 275 });
  room.listener.memory.remember('sight', pa.pose, 200, 1, pa.token);
  room.listener.director.setPhase('peak', 200, 'Test contact checkpoint'); room.listener.mind.burstReadyAt = 300;
  const down = await a.next(m => m.type === 'players' && m.players.find(p => p.id === pa.id)?.encounter?.state === 'downed');
  const other = await b.next(m => m.type === 'players' && m.players.find(p => p.id === pa.id)?.encounter?.state === 'downed');
  assert.deepEqual(down.players.find(p => p.id === pa.id).encounter, other.players.find(p => p.id === pa.id).encounter);
  let saved = JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'));
  assert.equal(saved.encounters.players.find(p => p.key === pa.token).state, 'downed');
  assert.equal((await a.request('pickup')).reason, 'downed');
  for (let i = 0; i < 18 && room.encounters.downed({ key: pa.token }); i++) {
    // Advance occupied simulation time instead of waiting for three real seconds.
    room.clock.elapsedSeconds += .2;
    assert.equal((await b.request('rescue', { targetId: pa.id })).ok, true);
  }
  const up = await a.next(m => m.type === 'players' && m.players.find(p => p.id === pa.id)?.encounter?.revision === 2);
  assert.equal(up.players.find(p => p.id === pa.id).encounter.state, 'ready');
  assert.deepEqual(pa.inventory.snapshot(), supplies);
  const before = pa.pose.x;
  assert.equal(room.move(pa.id, { ...pa.pose, x: before + 1, encounterRevision: 1 }), false);
  assert.equal(room.move(pa.id, { ...pa.pose, x: before + 1, encounterRevision: 2 }), true);
  saved = JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'));
  assert.equal(saved.encounters.players.find(p => p.key === pa.token).revision, 2);
  await game.close();
  game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
  const returning = await connect(game, pa.token); sockets.push(returning.socket);
  assert.equal(returning.welcome.self.encounter.revision, 2); assert.equal(returning.welcome.self.encounter.state, 'ready');
  assert.deepEqual(returning.welcome.inventory, supplies);
});

test('private contact, solo return, and resumed knockdowns preserve supplies and simulation timers', async t => {
  const previous = globalThis.Worker;
  globalThis.Worker = class { postMessage(job) { queueMicrotask(() => this.onmessage?.({ data: { id: job.id, blocks: generateChunk(job.seed, job.cx, job.cz, job.size) } })); } terminate() {} };
  t.after(() => { if (previous) globalThis.Worker = previous; else delete globalThis.Worker; });
  let saved;
  t.mock.method(browserSaves, 'save', async (record, revision) => { saved = structuredClone({ ...record, saveRevision: revision + 1 }); return saved; });
  const local = new LocalSession(new ChunkWorld({ generate: false })); t.after(() => local.disconnect());
  let pose, state;
  local.callbacks.players = players => { const p = players[0]; state = p.encounter; if (state?.position) Object.assign(pose || {}, state.position); };
  await local.start('Survivor', 'Contact night', 'contact-private');
  const supplies = local.resources.snapshot();
  pose = { ...local.self, x: 252.5, y: 8.01, z: 254.5, active: true };
  local.pose = () => pose;
  local.world.autoGenerate = true;
  for (let x = 249; x <= 256; x++) for (let z = 250; z <= 257; z++) for (let y = 7; y < 24; y++) local.world.set(x, y, z, y === 7 ? STONE : AIR);
  local.world.autoGenerate = false; local.clock.elapsedSeconds = 200; local.clock.phase = .65;
  Object.assign(local.listener.entity, { state: 'stalk', x: 251.5, y: 8.01, z: 254.5, target: { x: 252.5, y: 8.01, z: 254.5 }, home: { x: 245.5, y: 8.01, z: 254.5 }, interestUntil: 250, encounterUntil: 275 });
  local.listener.director.setPhase('peak', 200, 'Test private contact'); local.listener.mind.burstReadyAt = 300;
  for (let i = 0; i < 8 && state?.state !== 'downed'; i++) { local.update(.2); await local.saving; }
  assert.equal(state.state, 'downed');
  assert.equal((await local.request('craft', { block: STONE })).reason, 'downed');
  const downSave = structuredClone(saved), until = state.recoveryAt;
  assert.equal(downSave.encounters.players[0].state, 'downed');
  local.clock.elapsedSeconds = until; local.update(.2); await local.saving;
  assert.equal(state.state, 'ready'); assert.equal(state.revision, 2); assert.notEqual(pose.x, 252.5);
  assert.deepEqual(local.resources.snapshot(), supplies);
  const resumed = new LocalSession(new ChunkWorld({ generate: false })); t.after(() => resumed.disconnect());
  let welcome; resumed.callbacks.welcome = message => { welcome = message; };
  await resumed.start('Survivor', '', '', downSave);
  assert.equal(welcome.self.encounter.state, 'downed'); assert.equal(welcome.self.encounter.recoveryAt, until);
  assert.equal(resumed.clock.elapsedSeconds, downSave.clock.elapsedSeconds);
  assert.deepEqual(resumed.resources.snapshot(), supplies);
});

test('Listener pressure checkpoints visible wear and a two-block breach before publishing chunk updates', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blockfield-pressure-')), sockets = [], room = new GameRoom();
  for (let x = 249; x <= 258; x++) for (let z = 250; z <= 258; z++) for (let y = 7; y < 24; y++) room.world.set(x, y, z, y === 7 ? STONE : AIR);
  for (let z = 228; z <= 280; z++) for (let y = 8; y <= 11; y++) room.world.set(253, y, z, REINFORCED_PANEL);
  const game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory, room });
  t.after(async () => { sockets.forEach(s => s.terminate()); await game.close(); await rm(directory, { recursive: true, force: true }); });
  const a = await connect(game); sockets.push(a.socket);
  const player = room.players.get(a.welcome.self.id);
  Object.assign(player.pose, { x: 255.5, y: 8.01, z: 254.5, active: true });
  room.clock.elapsedSeconds = 200; room.clock.phase = .65;
  Object.assign(room.listener.entity, { state: 'investigate', x: 252.5, y: 8.01, z: 254.5, target: { x: 255.5, y: 8.01, z: 254.5 }, home: { x: 245.5, y: 8.01, z: 254.5 }, interestUntil: 270, encounterUntil: 275 });
  room.listener.director.setPhase('pressure', 200, 'Test structural pressure');
  room.listener.memory.remember('sound', player.pose, 200, 1, player.token);
  room.advance(.2);
  for (let i = 0; i < 12 && room.listener.director.state.hits < 6; i++) {
    room.clock.elapsedSeconds += 3.1; room.listener.noise(player.pose, 32, player.id); room.advance(.2);
    await a.request('inventory', { action: 'select', index: 0 });
  }
  assert.equal(room.listener.director.state.hits, 6);
  assert.equal(room.world.get(253, 8, 254), AIR); assert.equal(room.infrastructure.damage.get('253,9,254').remaining, 2);
  for (const record of room.listener.director.state.players) record.pressure = 0;
  room.listener.director.setPhase('unease', room.clock.elapsedSeconds, 'Next encounter after relief');
  room.listener.director.setPhase('pressure', room.clock.elapsedSeconds, 'New pressure allowance');
  room.listener.memory.remember('sound', player.pose, room.clock.elapsedSeconds, 1, player.token);
  for (let i = 0; i < 4 && room.world.get(253, 9, 254) !== AIR; i++) { room.clock.elapsedSeconds += 3.1; room.advance(.2); await a.request('inventory', { action: 'select', index: 0 }); }
  assert.equal(room.world.get(253, 9, 254), AIR);
  const wear = await a.next(m => m.type === 'construction' && m.damage.x === 253 && m.damage.remaining === 3);
  assert.equal(wear.damage.block, REINFORCED_PANEL);
  await a.next(m => m.type === 'edit' && m.method === 'pressure' || m.type === 'chunk' && m.revision > 0);
  const saved = JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'));
  const restored = GameRoom.fromSave(saved);
  assert.equal(restored.world.get(253, 8, 254), AIR); assert.equal(restored.world.get(253, 9, 254), AIR);
  assert.equal(restored.infrastructure.damage.size, 0);
  assert.equal(player.inventory.stacks.some(Boolean), false);
});
