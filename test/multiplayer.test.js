import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { GameRoom, MAX_PLAYERS, cleanName } from '../server/room.js';
import { createGameServer, lanURLs } from '../server.js';
import { World, AIR, GRASS, STONE, PLANKS, SLAB, LANTERN, DAISY, doorState } from '../src/world.js';

function fixture() {
  const world = new World({ generate: false });
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) { world.set(x, 0, z, STONE); world.set(x, 1, z, GRASS); }
  const room = new GameRoom({ world });
  const a = room.join('Alice'), b = room.join('Bob');
  for (const [player, x] of [[a, 8.5], [b, 12.5]]) room.move(player.id, { x, y: 2, z: 11.5, yaw: 0, pitch: 0, active: false });
  const edit = (player, method, args = {}) => room.command(player.id, { method, ...args,
    ...(Number.isInteger(args.x) ? { expected: room.expected(args.x, args.y, args.z) } : {}) });
  return { room, a, b, edit, world };
}

test('joining gives distinct identities, safe names, full current worlds, and a player limit', () => {
  const room = new GameRoom();
  const first = room.join(' Alice\n ');
  assert.equal(first.name, 'Alice');
  assert.equal(cleanName(''), 'Builder');
  assert.equal(cleanName('x'.repeat(40)).length, 20);
  const identities = new Set([first.id]);
  for (let i = 1; i < MAX_PLAYERS; i++) identities.add(room.join('Builder').id);
  assert.equal(identities.size, MAX_PLAYERS);
  assert.equal(room.join('Extra'), null);
  const snapshot = room.snapshot(first);
  assert.equal(snapshot.world.size, 512);
  assert.equal(snapshot.blocks, undefined, 'joining must not send the entire world');
  assert.equal(snapshot.players.length, MAX_PLAYERS);
  assert.equal(snapshot.clock.running, false);
  room.leave(first.id);
  assert.ok(room.join('Replacement'));
});

test('concurrent edits cannot overwrite changed cells while unrelated edits both succeed', () => {
  const { room, a, b, edit, world } = fixture();
  const args = { x: 8, y: 2, z: 8, block: PLANKS };
  const expected = room.expected(args.x, args.y, args.z);
  assert.equal(edit(a, 'edit', args).ok, true);
  assert.equal(room.command(b.id, { method: 'edit', ...args, expected }).reason, 'changed');
  assert.equal(edit(b, 'edit', { x: 9, y: 2, z: 8, block: PLANKS }).ok, true);
  assert.equal(edit(a, 'undo').ok, true);
  assert.equal(world.get(8, 2, 8), AIR);
  assert.equal(world.get(9, 2, 8), PLANKS);
});

test('undo detects another player replacing a block with the very same material', () => {
  const { a, b, edit, world } = fixture();
  edit(a, 'edit', { x: 8, y: 2, z: 8, block: PLANKS });
  edit(b, 'edit', { x: 8, y: 2, z: 8, block: AIR });
  edit(b, 'edit', { x: 8, y: 2, z: 8, block: PLANKS });
  assert.equal(edit(a, 'undo').reason, 'changed');
  assert.equal(world.get(8, 2, 8), PLANKS);
  assert.equal(a.history.undoStack.length, 1);
  // Undoing Bob's work restores Alice's exact earlier state and lineage.
  assert.equal(edit(b, 'undo').ok, true);
  assert.equal(edit(b, 'undo').ok, true);
  assert.equal(edit(a, 'undo').ok, true);
  assert.equal(world.get(8, 2, 8), AIR);
  assert.equal(edit(a, 'redo').ok, true);
});

test('a player can undo and redo several own edits to the same cell', () => {
  const { a, edit, world } = fixture();
  edit(a, 'edit', { x: 8, y: 2, z: 8, block: SLAB });
  edit(a, 'edit', { x: 8, y: 2, z: 8, block: PLANKS });
  edit(a, 'edit', { x: 8, y: 2, z: 8, block: AIR });
  for (const block of [PLANKS, SLAB, AIR]) { assert.equal(edit(a, 'undo').ok, true); assert.equal(world.get(8, 2, 8), block); }
  for (const block of [SLAB, PLANKS, AIR]) { assert.equal(edit(a, 'redo').ok, true); assert.equal(world.get(8, 2, 8), block); }
});

test('all players are protected from placement, undo restores, and door swings', () => {
  const { room, a, b, edit, world } = fixture();
  room.move(b.id, { x: 8.5, y: 2, z: 8.5, yaw: 0, pitch: 0 });
  assert.equal(edit(a, 'edit', { x: 8, y: 2, z: 8, block: PLANKS }).reason, 'blocked');
  assert.equal(edit(a, 'placeFlower', { x: 8, y: 2, z: 8, block: DAISY }).ok, true);
  room.move(b.id, { x: 8.5, y: 2, z: 10.5, yaw: 0, pitch: 0 });
  assert.equal(edit(a, 'placeDoor', { x: 8, y: 2, z: 8, facing: 0 }).ok, true);
  room.move(b.id, { x: 8.2, y: 2, z: 8.45, yaw: 0, pitch: 0 });
  assert.equal(edit(a, 'toggleDoor', { x: 8, y: 2, z: 8 }).reason, 'blocked');
  assert.equal(doorState(world.get(8, 2, 8)).open, false);
  room.move(b.id, { x: 8.5, y: 2, z: 10.5, yaw: 0, pitch: 0 });
  edit(a, 'edit', { x: 8, y: 2, z: 8, block: AIR });
  room.move(b.id, { x: 8.5, y: 2, z: 8.95, yaw: 0, pitch: 0 });
  assert.equal(edit(a, 'undo').reason, 'blocked');
  assert.equal(world.get(8, 2, 8), AIR);
  assert.equal(world.get(8, 3, 8), AIR);
});

test('support transactions and exact flower variants survive shared history', () => {
  const { a, edit, world } = fixture();
  edit(a, 'placeFlower', { x: 8, y: 2, z: 8, block: DAISY });
  const removed = edit(a, 'edit', { x: 8, y: 1, z: 8, block: AIR });
  assert.equal(removed.changes.length, 2);
  edit(a, 'undo');
  assert.equal(world.get(8, 1, 8), GRASS);
  assert.equal(world.get(8, 2, 8), DAISY);
  assert.equal(edit(a, 'placeLantern', { x: 8, y: 2, z: 8 }).ok, true);
  assert.equal(world.get(8, 2, 8), LANTERN);
  edit(a, 'undo');
  assert.equal(world.get(8, 2, 8), DAISY);
});

test('shared time advances only while someone is playing and accepts either player controls', () => {
  const { room, a, b, edit } = fixture();
  const initial = room.clock.phase;
  room.advance(30); assert.equal(room.clock.phase, initial);
  room.move(a.id, { ...a.pose, active: true });
  room.advance(30); assert.ok(room.clock.phase > initial);
  edit(b, 'time', { action: 'hold' });
  const held = room.clock.phase;
  room.advance(30); assert.equal(room.clock.phase, held);
  edit(a, 'time', { action: 'next' });
  assert.equal(room.clock.phase, 0.46);
  assert.equal(room.clock.held, true);
  assert.equal(room.clockState().running, true);
  room.leave(a.id); assert.equal(room.clockState().running, false);
});

test('invalid poses and commands, remote edits, and foundation edits are rejected', () => {
  const { room, a, edit, world } = fixture();
  for (const pose of [null, {}, { ...a.pose, x: Infinity }, { ...a.pose, pitch: 10 }, { ...a.pose, y: 1000 }]) assert.equal(room.move(a.id, pose), false);
  for (const message of [null, {}, { method: 'anything' }]) assert.equal(room.command(a.id, message).ok, false);
  assert.equal(edit(a, 'edit', { x: 8, y: 0, z: 8, block: AIR }).ok, false);
  assert.equal(edit(a, 'edit', { x: 8, y: 2, z: 8, block: 255 }).ok, false);
  assert.equal(edit(a, 'edit', { x: 40, y: 2, z: 40, block: PLANKS }).reason, 'reach');
  assert.equal(world.get(8, 0, 8), STONE);
});

function connect(url, name, origin) {
  const socket = new WebSocket(url, origin ? { origin } : {});
  const messages = [];
  socket.on('message', data => messages.push(JSON.parse(data.toString())));
  const wait = async predicate => {
    const existing = messages.find(predicate);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off('message', listener); reject(new Error(`Timed out: ${JSON.stringify(messages.map(m => ({ type: m.type, cx: m.cx, cz: m.cz, reason: m.reason })))}`)); }, 5000);
      const listener = data => { const message = JSON.parse(data.toString()); if (predicate(message)) { clearTimeout(timer); socket.off('message', listener); resolve(message); } };
      socket.on('message', listener);
    });
  };
  socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', protocol: 2, name })));
  return { socket, messages, wait, send: message => socket.send(JSON.stringify(message)) };
}

test('real WebSockets share edits, join snapshots, time, departure, and session information', async t => {
  const { room } = fixture();
  room.players.clear();
  const game = await createGameServer({ host: '127.0.0.1', port: 0, room });
  const port = game.server.address().port, origin = `http://127.0.0.1:${port}`, url = `ws://127.0.0.1:${port}/multiplayer`;
  t.after(() => game.close());
  const a = connect(url, 'Alice', origin), b = connect(url, 'Bob', origin);
  t.after(() => { a.socket.terminate(); b.socket.terminate(); });
  const aw = await a.wait(m => m.type === 'welcome');
  await b.wait(m => m.type === 'welcome');
  a.send({ type: 'pose', pose: { x: 8.5, y: 2, z: 11.5, yaw: 0, pitch: 0, active: true } });
  await a.wait(m => m.type === 'chunk' && m.cx === 0 && m.cz === 0);
  await b.wait(m => m.type === 'chunk' && m.cx === 0 && m.cz === 0);
  a.send({ type: 'command', requestId: 1, method: 'placeFlower', x: 8, y: 2, z: 8, block: DAISY, expected: room.expected(8, 2, 8) });
  const ae = await a.wait(m => m.type === 'edit');
  const be = await b.wait(m => m.type === 'edit');
  assert.deepEqual(ae, be); assert.equal(ae.by, aw.self.id); assert.equal(ae.updates[0].changes[0].to, DAISY);
  const c = connect(url, 'Late arrival', origin);
  t.after(() => c.socket.terminate());
  const cw = await c.wait(m => m.type === 'welcome');
  const chunk = await c.wait(m => m.type === 'chunk' && m.cx === 0 && m.cz === 0);
  const lateWorld = new Uint8Array(Buffer.from(chunk.blocks, 'base64'));
  assert.equal(lateWorld[8 + 16 * (8 + 16 * 2)], DAISY);
  assert.equal(cw.revision, 1);
  b.send({ type: 'command', requestId: 1, method: 'time', action: 'next' });
  assert.equal((await c.wait(m => m.type === 'clock')).clock.phase, 0.46);
  const departed = once(c.socket, 'close'); c.socket.close(); await departed;
  await a.wait(m => m.type === 'players' && m.players.length === 2);
  const response = await fetch(`${origin}/api/session`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).maxPlayers, 8);
});

test('cross-origin WebSocket upgrades are refused', async t => {
  const game = await createGameServer({ host: '127.0.0.1', port: 0 });
  t.after(() => game.close());
  const socket = new WebSocket(`ws://127.0.0.1:${game.server.address().port}/multiplayer`, { origin: 'http://another-site.example' });
  const status = await new Promise(resolve => {
    socket.on('unexpected-response', (_request, response) => { response.resume(); socket.terminate(); resolve(response.statusCode); });
    socket.on('error', () => {});
  });
  assert.equal(status, 403);
});

test('separated players stream independent neighborhoods and far undo acknowledges without sending unrelated terrain', async t => {
  const game = await createGameServer({ host: '127.0.0.1', port: 0 });
  t.after(() => game.close());
  const port = game.server.address().port, url = `ws://127.0.0.1:${port}/multiplayer`;
  const a = connect(url, 'Explorer'), b = connect(url, 'Builder');
  t.after(() => { a.socket.terminate(); b.socket.terminate(); });
  const welcome = await a.wait(m => m.type === 'welcome');
  await b.wait(m => m.type === 'welcome');
  assert.equal(welcome.blocks, undefined);
  await a.wait(m => m.type === 'chunk' && m.cx === 15 && m.cz === 15);
  await b.wait(m => m.type === 'chunk' && m.cx === 15 && m.cz === 15);
  a.send({ type: 'command', requestId: 1, method: 'edit', x: 255, y: 8, z: 255, block: PLANKS, expected: game.room.expected(255, 8, 255) });
  assert.equal((await a.wait(m => m.type === 'result' && m.requestId === 1)).ok, true);
  a.send({ type: 'pose', pose: { x: 400.5, y: 20, z: 400.5, yaw: 0, pitch: 0, flying: true, active: true } });
  await a.wait(m => m.type === 'unload' && m.keys.includes('15,15'));
  await a.wait(m => m.type === 'chunk' && m.cx === 29 && m.cz === 29);
  assert.ok(game.room.world.chunks.size > 150 && game.room.world.chunks.size <= 242);
  assert.equal(b.messages.some(m => m.type === 'chunk' && m.cx === 25 && m.cz === 25), false);
  a.send({ type: 'command', requestId: 2, method: 'undo' });
  assert.equal((await a.wait(m => m.type === 'result' && m.requestId === 2)).ok, true);
  await b.wait(m => m.type === 'edit' && m.updates.some(update => update.changes.some(c => c.to === AIR)));
  a.send({ type: 'command', requestId: 3, method: 'redo' });
  assert.equal((await a.wait(m => m.type === 'result' && m.requestId === 3)).ok, true);
  a.send({ type: 'pose', pose: { x: 256.5, y: 8, z: 256.5, yaw: 0, pitch: 0, active: true } });
  const restored = await a.wait(m => m.type === 'chunk' && m.cx === 15 && m.cz === 15 && m.revision === 3);
  assert.equal(Buffer.from(restored.blocks, 'base64')[15 + 16 * (15 + 16 * 8)], PLANKS);
  const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
  assert.equal(health.ok, true); assert.equal(health.players, 2); assert.ok(health.loadedChunks <= 242);
});

test('LAN addresses prefer physical network adapters and omit loopback and duplicate addresses', () => {
  const urls = lanURLs(5173, { lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], utun0: [{ family: 'IPv4', address: '100.1.2.3', internal: false }],
    en0: [{ family: 'IPv4', address: '192.168.1.42', internal: false }], en1: [{ family: 'IPv4', address: '192.168.1.42', internal: false }] });
  assert.deepEqual(urls, ['http://192.168.1.42:5173/']);
});
