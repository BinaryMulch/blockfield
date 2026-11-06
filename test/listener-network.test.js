import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.js';
import { PROTOCOL } from '../server/room.js';
import { LocalSession } from '../src/session.js';
import { ChunkWorld } from '../src/chunks.js';
import { generateChunk } from '../src/generation.js';
import { browserSaves } from '../src/browser-saves.js';
import { AIR, STONE } from '../src/world.js';

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
  for (let x = 237; x <= 267; x++) for (let z = 235; z <= 238; z++) for (let y = 7; y < 24; y++) local.world.set(x, y, z, y === 7 ? STONE : AIR);
  local.world.autoGenerate = false;
  local.pose = () => ({ ...local.self, x: 238.5, y: 8.01, z: 236.5, active: true });
  assert.equal((await local.request('edit', { ...p, block: AIR })).ok, true);
  local.update(.2); assert.notEqual(local.listener.entity.state, 'dormant'); assert.ok(states.some(s => s.cueSeq > 0));
  fail = true; assert.equal((await local.request('save')).ok, false);
  const paused = local.listener.snapshot(), time = local.clock.elapsedSeconds; local.update(20);
  assert.deepEqual(local.listener.snapshot(), paused); assert.equal(local.clock.elapsedSeconds, time);
  fail = false; assert.equal((await local.request('save')).ok, true);
  const resumed = new LocalSession(new ChunkWorld({ generate: false })); t.after(() => resumed.disconnect());
  await resumed.start('Survivor', '', '', saved);
  assert.deepEqual(resumed.listener.snapshot(), paused); assert.equal(resumed.clock.elapsedSeconds, time);
});
