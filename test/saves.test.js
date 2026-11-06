import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { ChunkWorld } from '../src/chunks.js';
import { captureSave, restoreEdits, validateSave } from '../src/saves.js';
import { DiskWorldStore } from '../server/disk-saves.js';
import { GameRoom } from '../server/room.js';
import { createGameServer } from '../server.js';
import { AIR, PLANKS, LANTERN, DAISY, doorBlock } from '../src/world.js';

const directory = async t => { const dir = await mkdtemp(path.join(tmpdir(), 'blockfield-save-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
function record() {
  const world = new ChunkWorld({ seed: 'saved-seed' });
  world.set(255, 8, 255, LANTERN); world.set(257, 8, 255, DAISY);
  world.set(254, 8, 255, doorBlock(2, true)); world.set(254, 9, 255, doorBlock(2, true, true));
  world.set(252, 7, 255, AIR);
  const save = captureSave({ world, id: 'saved-world', name: 'My saved world', createdAt: 1, clock: { phase: 0.75, held: true },
    player: { x: 400.5, y: 20, z: 400.5, yaw: 0.5, pitch: -0.2, flying: true } });
  return { world, save };
}

test('versioned sparse saves restore edited and removed blocks without saving generated chunks', () => {
  const { save } = record();
  assert.ok(JSON.stringify(save).length < 2000); assert.equal(save.chunks, undefined);
  const world = new ChunkWorld({ seed: save.world.seed }); restoreEdits(world, save);
  assert.equal(world.chunks.size, 0);
  for (const [x, y, z, block] of [[255, 8, 255, LANTERN], [257, 8, 255, DAISY], [254, 8, 255, doorBlock(2, true)], [254, 9, 255, doorBlock(2, true, true)], [252, 7, 255, AIR]]) assert.equal(world.get(x, y, z), block);
  world.evict([], 5); assert.equal(world.get(255, 8, 255), LANTERN);
  assert.equal(save.player.flying, true);
});

test('saved room names, seeds, identity and time restore while connection histories start fresh', () => {
  const { save } = record(), room = GameRoom.fromSave(save);
  assert.equal(room.world.chunks.size, 0); assert.equal(room.name, save.name); assert.equal(room.worldId, save.id);
  assert.equal(room.world.seed, 'saved-seed'); assert.equal(room.clock.phase, 0.75); assert.equal(room.clock.held, true);
  assert.equal(room.players.size, 0); assert.equal(room.versions.size, 0);
  assert.equal(room.join('New connection').history.undoStack.length, 0);
});

test('invalid edits and unsupported save or generator versions are rejected before changing a world', () => {
  const { save } = record();
  for (const modify of [s => { s.version = 999; }, s => { s.world.generator = 999; }]) {
    const changed = structuredClone(save); modify(changed);
    assert.throws(() => validateSave(changed), error => error.code === 'SAVE_INCOMPATIBLE');
  }
  for (const edits of [[['32,0', [[256, 1]]]], [['0,0', [[0, 1]]]], [['0,0', [[256, 255]]]], [['0,0', [[256, 1], [256, 2]]]]]) {
    assert.throws(() => validateSave({ ...save, edits }));
  }
  assert.throws(() => validateSave({ ...save, player: { ...save.player, x: Infinity } }));
  const world = new ChunkWorld({ seed: 'untouched' }); world.set(256, 8, 256, PLANKS);
  assert.throws(() => restoreEdits(world, { ...save, edits: [['0,0', [[0, 1]]]] }));
  assert.equal(world.get(256, 8, 256), PLANKS);
});

test('disk saves atomically replace the current file and retain a previous valid backup', async t => {
  const dir = await directory(t), store = new DiskWorldStore(dir), { save } = record();
  await store.lock(); assert.equal(await store.load(), null);
  await store.save(save);
  const next = { ...save, name: 'Updated name', updatedAt: save.updatedAt + 1 };
  await store.save(next); await store.close();
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'world.json'), 'utf8')), next);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'world.json.bak'), 'utf8')), save);
  assert.ok((await readdir(dir)).every(name => !name.endsWith('.tmp')));
  const reopened = new DiskWorldStore(dir); await reopened.lock(); assert.deepEqual(await reopened.load(), next); await reopened.close();
});

test('corrupt current saves recover from a good backup without overwriting it with damaged data', async t => {
  const dir = await directory(t), store = new DiskWorldStore(dir), { save } = record();
  await store.lock(); await store.save(save); await store.save({ ...save, name: 'Second' }); await store.close();
  await writeFile(path.join(dir, 'world.json'), '{truncated');
  const reopened = new DiskWorldStore(dir); await reopened.lock();
  const recovered = await reopened.load(); assert.equal(reopened.recovered, true); assert.equal(recovered.name, save.name);
  assert.equal(await readFile(path.join(dir, 'world.json'), 'utf8'), '{truncated');
  await reopened.save(recovered);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'world.json.bak'), 'utf8')), save);
  await reopened.close();
});

test('unknown future formats and damaged primary/backup pairs fail without replacing files', async t => {
  const dir = await directory(t), { save } = record();
  const current = path.join(dir, 'world.json'), backup = current + '.bak';
  const future = JSON.stringify({ ...save, version: 99 });
  await writeFile(current, future); await writeFile(backup, JSON.stringify(save));
  const store = new DiskWorldStore(dir); await store.lock();
  await assert.rejects(() => store.load(), error => error.code === 'SAVE_INCOMPATIBLE');
  assert.equal(await readFile(current, 'utf8'), future);
  await writeFile(current, 'bad primary'); await writeFile(backup, 'bad backup');
  await assert.rejects(() => store.load(), /Existing files were preserved/);
  assert.equal(await readFile(current, 'utf8'), 'bad primary'); assert.equal(await readFile(backup, 'utf8'), 'bad backup');
  await store.close();
});

test('an interrupted replacement preserves its backup and cleans temporary files', async t => {
  const dir = await directory(t), store = new DiskWorldStore(dir), { save } = record();
  await store.lock(); await store.save(save);
  await rename(store.filename, path.join(dir, 'preserved.json')); await mkdir(store.filename);
  await assert.rejects(() => store.save({ ...save, name: 'Not committed' }));
  assert.deepEqual(JSON.parse(await readFile(store.filename + '.bak', 'utf8')), save);
  assert.ok((await readdir(dir)).every(name => !name.endsWith('.tmp')));
  await store.close();
});

test('a save directory has one writer and dead-process locks can be reclaimed', async t => {
  const dir = await directory(t), first = new DiskWorldStore(dir), second = new DiskWorldStore(dir);
  await first.lock(); await assert.rejects(() => second.lock(), error => error.code === 'EWORLDLOCKED');
  await first.close(); await second.lock(); await second.close();
  await writeFile(path.join(dir, '.world.lock'), JSON.stringify({ pid: 2147483647 }));
  const restarted = new DiskWorldStore(dir); await restarted.lock(); await restarted.close();
});

test('simultaneous stale-lock recovery still allows only one writer', async t => {
  const dir = await directory(t);
  await writeFile(path.join(dir, '.world.lock'), JSON.stringify({ pid: 2147483647 }));
  const stores = [new DiskWorldStore(dir), new DiskWorldStore(dir)];
  const results = await Promise.allSettled(stores.map(store => store.lock()));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  for (const store of stores) await store.close();
  assert.equal((await readdir(dir)).includes('.world.reclaim'), false);
});

test('read permission failures do not fall back to an older save and replace the unreadable file', async t => {
  const dir = await directory(t), store = new DiskWorldStore(dir), { save } = record();
  await store.lock(); await store.save(save); await store.save({ ...save, name: 'Latest' });
  t.mock.method(store, 'read', async () => { throw Object.assign(new Error('Permission denied'), { code: 'EACCES' }); });
  await assert.rejects(() => store.load(), /Check storage and permissions/);
  assert.equal(JSON.parse(await readFile(store.filename, 'utf8')).name, 'Latest');
  await store.close();
});

function peer(url) {
  const socket = new WebSocket(url), messages = [];
  socket.on('error', () => {});
  socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
  socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', protocol: 2, name: 'Save tester' })));
  const wait = predicate => {
    const existing = messages.find(predicate); if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off('message', listener); reject(new Error('Timed out waiting for save acknowledgement')); }, 5000);
      const listener = raw => { const value = JSON.parse(raw.toString()); if (predicate(value)) { clearTimeout(timer); socket.off('message', listener); resolve(value); } };
      socket.on('message', listener);
    });
  };
  return { socket, messages, wait, send: message => socket.send(JSON.stringify(message)) };
}

async function startProcess(dir, seed = 'crash-test') {
  const child = spawn(process.execPath, ['server.js', '--production'], { env: { ...process.env, PORT: '0', DATA_DIR: dir, WORLD_NAME: 'Durable world', WORLD_SEED: seed }, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(log || 'Host did not start')); }, 8000);
    child.stdout.on('data', data => { log += data; const match = log.match(/http:\/\/localhost:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.stderr.on('data', data => { log += data; });
    child.on('error', reject);
    child.once('exit', code => { if (code) { clearTimeout(timer); reject(new Error(log)); } });
  });
  return { child, url };
}

test('acknowledged network edits and time survive SIGKILL and restart without relying on shutdown', async t => {
  const dir = await directory(t);
  let host = await startProcess(dir);
  t.after(async () => { if (host.child.exitCode === null && host.child.signalCode === null) { const done = once(host.child, 'exit'); host.child.kill('SIGTERM'); await done; } });
  let client = peer(host.url.replace('http:', 'ws:') + 'multiplayer');
  await client.wait(m => m.type === 'welcome');
  client.send({ type: 'command', requestId: 1, method: 'placeLantern', x: 255, y: 8, z: 255, expected: [1, 0, 0, 0] });
  assert.equal((await client.wait(m => m.type === 'result' && m.requestId === 1)).ok, true);
  client.send({ type: 'command', requestId: 2, method: 'time', action: 'hold' }); await client.wait(m => m.type === 'result' && m.requestId === 2);
  client.send({ type: 'command', requestId: 3, method: 'time', action: 'next' }); await client.wait(m => m.type === 'result' && m.requestId === 3);
  const onDisk = validateSave(JSON.parse(await readFile(path.join(dir, 'world.json'), 'utf8')));
  assert.equal(onDisk.clock.phase, 0.46); assert.equal(onDisk.clock.held, true);
  const killed = once(host.child, 'exit'); host.child.kill('SIGKILL'); await killed;
  client.socket.terminate();
  host = await startProcess(dir, 'must-not-replace-saved-seed');
  client = peer(host.url.replace('http:', 'ws:') + 'multiplayer'); t.after(() => client.socket.terminate());
  const welcome = await client.wait(m => m.type === 'welcome');
  assert.equal(welcome.world.seed, 'crash-test'); assert.equal(welcome.worldName, 'Durable world'); assert.equal(welcome.clock.phase, 0.46); assert.equal(welcome.clock.held, true);
  const chunk = await client.wait(m => m.type === 'chunk' && m.cx === 15 && m.cz === 15);
  assert.equal(Buffer.from(chunk.blocks, 'base64')[15 + 16 * (15 + 16 * 8)], LANTERN);
});

test('disk write failures stop broadcasts and later edits instead of acknowledging unsaved changes', async t => {
  const dir = await directory(t), game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: dir });
  t.after(() => game.close()); t.mock.method(console, 'error', () => {});
  const port = game.server.address().port, client = peer(`ws://127.0.0.1:${port}/multiplayer`);
  t.after(() => client.socket.terminate()); await client.wait(m => m.type === 'welcome');
  game.persistence.save = async () => { throw new Error('Disk full'); };
  client.send({ type: 'command', requestId: 1, method: 'placeLantern', x: 255, y: 8, z: 255, expected: [1, 0, 0, 0] });
  assert.equal((await client.wait(m => m.type === 'unavailable')).reason, 'storage');
  assert.equal(client.messages.some(m => m.type === 'edit'), false);
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 503);
  const preserved = JSON.parse(await readFile(path.join(dir, 'world.json'), 'utf8'));
  assert.deepEqual(preserved.edits, []);
});
