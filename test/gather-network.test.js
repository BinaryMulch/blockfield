import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.js';
import { PROTOCOL } from '../server/room.js';
import { AIR, PLANKS } from '../src/world.js';
const count = (inventory, block) => inventory.stacks.reduce((n, stack) => n + (stack?.block === block ? stack.count : 0), 0);

async function client(port, token) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`), messages = [], waiting = new Set();
  socket.on('message', raw => { messages.push(JSON.parse(raw)); for (const fn of waiting) fn(); });
  socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, name: 'Gather tester', playerToken: token })));
  const next = predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(check); reject(new Error('Timed out waiting for gather response')); }, 5000);
    function check() { const index = messages.findIndex(predicate); if (index >= 0) { const [value] = messages.splice(index, 1); clearTimeout(timer); waiting.delete(check); resolve(value); } }
    waiting.add(check); check();
  });
  return { socket, next, messages };
}

test('gather network changes checkpoint supplies and blocks together and restore separate profiles after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blockfield-gather-network-')), sockets = [];
  let game;
  try {
    game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
    const token = randomUUID(), a = await client(game.server.address().port, token); sockets.push(a.socket);
    const welcome = await a.next(m => m.type === 'welcome'); assert.equal(welcome.gameMode, 'gather');
    const x = Math.floor(welcome.self.x), y = Math.floor(welcome.self.y) - 1, z = Math.floor(welcome.self.z), block = game.room.world.get(x, y, z);
    a.socket.send(JSON.stringify({ type: 'command', requestId: 1, method: 'edit', x, y, z, block: AIR, expected: game.room.expected(x, y, z) }));
    const supplies = await a.next(m => m.type === 'supplies'); assert.equal(count(supplies.inventory, block), 1);
    assert.equal((await a.next(m => m.type === 'result' && m.requestId === 1)).ok, true);
    a.socket.send(JSON.stringify({ type: 'command', requestId: 2, method: 'inventory', action: 'move', source: 0, target: 9, amount: 1, expectedSource: supplies.inventory.stacks[0], expectedTarget: null }));
    const moved = await a.next(m => m.type === 'supplies'); assert.equal(moved.inventory.stacks[0], null); assert.equal(moved.inventory.stacks[9].count, 1);
    assert.equal((await a.next(m => m.type === 'result' && m.requestId === 2)).moved, 1);
    a.socket.send(JSON.stringify({ type: 'command', requestId: 3, method: 'inventory', action: 'move', source: 0, target: 10, amount: 64, expectedSource: { block, count: 64 }, expectedTarget: null }));
    assert.equal((await a.next(m => m.type === 'result' && m.requestId === 3)).reason, 'changed');
    a.socket.send(JSON.stringify({ type: 'command', requestId: 4, method: 'edit', x, y, z, block, slot: 9, expected: game.room.expected(x, y, z) }));
    assert.equal((await a.next(m => m.type === 'result' && m.requestId === 4)).reason, 'supplies', 'backpack stacks cannot be used as a selected hotbar slot');
    const saved = JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'));
    assert.equal(count(saved.profiles.find(([key]) => key === token)[1], block), 1);
    const b = await client(game.server.address().port, randomUUID()); sockets.push(b.socket);
    const other = await b.next(m => m.type === 'welcome'); assert.equal(count(other.inventory, block), 0);
    b.socket.send(JSON.stringify({ type: 'command', requestId: 1, method: 'edit', x, y, z, block, expected: game.room.expected(x, y, z), inventory: { counts: Array(15).fill(64) } }));
    assert.equal((await b.next(m => m.type === 'result')).reason, 'supplies');
    b.socket.send(JSON.stringify({ type: 'command', requestId: 2, method: 'craft', block: PLANKS, counts: Array(15).fill(64) }));
    assert.equal((await b.next(m => m.type === 'result' && m.requestId === 2)).reason, 'supplies');
    const duplicate = await client(game.server.address().port, token); sockets.push(duplicate.socket);
    assert.equal((await duplicate.next(m => m.type === 'unavailable')).reason, 'profile');
    await game.close(); game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
    const restored = await client(game.server.address().port, token); sockets.push(restored.socket);
    const again = await restored.next(m => m.type === 'welcome');
    assert.equal(count(again.inventory, block), 1); assert.equal(again.worldId, welcome.worldId); assert.equal(again.inventory.stacks[9].count, 1); assert.equal(game.room.world.get(x, y, z), AIR);
    restored.socket.send(JSON.stringify({ type: 'command', requestId: 1, method: 'undo' }));
    assert.equal((await restored.next(m => m.type === 'result')).reason, 'empty', 'history resets but supplies persist');
    restored.socket.send(JSON.stringify({ type: 'command', requestId: 2, method: 'inventory', action: 'move', source: 9, target: 0, amount: 1, expectedSource: again.inventory.stacks[9], expectedTarget: null }));
    assert.equal((await restored.next(m => m.type === 'result' && m.requestId === 2)).ok, true);
    restored.socket.send(JSON.stringify({ type: 'pose', pose: { x: x + 2.5, y: y + 1.01, z: z + 2.5, yaw: 0, pitch: 0, active: false } }));
    restored.socket.send(JSON.stringify({ type: 'command', requestId: 3, method: 'edit', x, y, z, block, slot: 0, expected: game.room.expected(x, y, z) }));
    assert.equal((await restored.next(m => m.type === 'result' && m.requestId === 3)).ok, true);
    assert.equal(game.room.world.get(x, y, z), block);
    assert.equal(game.room.profiles.get(token).count(block), 0);
  } finally {
    sockets.forEach(socket => socket.terminate()); await game?.close(); await rm(directory, { recursive: true, force: true });
  }
});

test('network drops broadcast after checkpoint, survive restart, and transfer to only one nearby player', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blockfield-drop-network-')), sockets = [];
  let game;
  try {
    game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
    const tokenA = randomUUID(), tokenB = randomUUID();
    const a = await client(game.server.address().port, tokenA); sockets.push(a.socket);
    const welcome = await a.next(m => m.type === 'welcome');
    const b = await client(game.server.address().port, tokenB); sockets.push(b.socket);
    await b.next(m => m.type === 'welcome');
    const x = Math.floor(welcome.self.x), y = Math.floor(welcome.self.y) - 1, z = Math.floor(welcome.self.z), block = game.room.world.get(x, y, z);
    a.socket.send(JSON.stringify({ type: 'command', requestId: 1, method: 'edit', x, y, z, block: AIR, expected: game.room.expected(x, y, z) }));
    const supplies = await a.next(m => m.type === 'supplies');
    await a.next(m => m.type === 'result' && m.requestId === 1);
    a.socket.send(JSON.stringify({ type: 'command', requestId: 2, method: 'drop', source: 0, amount: 1, expectedSource: supplies.inventory.stacks[0], block: PLANKS, x: 0, y: 0, z: 0 }));
    const dropped = await b.next(m => m.type === 'drops'); assert.equal(dropped.drops.length, 1); assert.equal(dropped.drops[0].block, block);
    assert.equal((await a.next(m => m.type === 'result' && m.requestId === 2)).ok, true);
    const saved = JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'));
    assert.equal(saved.drops[0].count, 1); assert.equal(count(saved.profiles.find(([token]) => token === tokenA)[1], block), 0);
    assert.ok(saved.drops[0].x > 200, 'drop position comes from the authoritative pose, ignoring client coordinates');
    await game.close(); game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
    const againA = await client(game.server.address().port, tokenA), againB = await client(game.server.address().port, tokenB); sockets.push(againA.socket, againB.socket);
    const aWelcome = await againA.next(m => m.type === 'welcome'), bWelcome = await againB.next(m => m.type === 'welcome');
    assert.equal(count(aWelcome.inventory, block), 0); assert.equal(bWelcome.drops[0].id, dropped.drops[0].id);
    const item = bWelcome.drops[0], pose = { x: item.x, y: item.y - 0.17, z: item.z, yaw: 0, pitch: 0, active: true };
    await new Promise(resolve => setTimeout(resolve, Math.max(0, item.readyAt - Date.now() + 10)));
    for (const player of [againB, againA]) {
      player.socket.send(JSON.stringify({ type: 'pose', pose }));
      player.socket.send(JSON.stringify({ type: 'command', requestId: 1, method: 'pickup', amount: 64 }));
    }
    const resultB = await againB.next(m => m.type === 'result' && m.requestId === 1), resultA = await againA.next(m => m.type === 'result' && m.requestId === 1);
    assert.equal(Number(resultB.ok) + Number(resultA.ok), 1);
    assert.deepEqual((await againA.next(m => m.type === 'drops')).drops, []);
    const picked = JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'));
    assert.equal(picked.drops.length, 0);
    assert.equal(picked.profiles.reduce((sum, [, inventory]) => sum + count(inventory, block), 0), 1);
  } finally {
    sockets.forEach(socket => socket.terminate()); await game?.close(); await rm(directory, { recursive: true, force: true });
  }
});

test('a failed drop checkpoint publishes neither inventory nor entities and preserves the saved supplies', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blockfield-drop-failure-'));
  let game, a;
  t.mock.method(console, 'error', () => {});
  try {
    game = await createGameServer({ host: '127.0.0.1', port: 0, saveDirectory: directory });
    const token = randomUUID(); a = await client(game.server.address().port, token);
    const welcome = await a.next(m => m.type === 'welcome');
    const x = Math.floor(welcome.self.x), y = Math.floor(welcome.self.y) - 1, z = Math.floor(welcome.self.z), block = game.room.world.get(x, y, z);
    a.socket.send(JSON.stringify({ type: 'command', requestId: 1, method: 'edit', x, y, z, block: AIR, expected: game.room.expected(x, y, z) }));
    const supplies = await a.next(m => m.type === 'supplies');
    await a.next(m => m.type === 'result' && m.requestId === 1);
    game.persistence.save = async () => { throw new Error('Disk full'); };
    a.socket.send(JSON.stringify({ type: 'command', requestId: 2, method: 'drop', source: 0, amount: 1, expectedSource: supplies.inventory.stacks[0] }));
    assert.equal((await a.next(m => m.type === 'unavailable')).reason, 'storage');
    assert.equal(a.messages.some(m => m.type === 'drops' || m.type === 'supplies' || m.type === 'result' && m.requestId === 2), false);
    const saved = JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'));
    assert.deepEqual(saved.drops, []); assert.equal(count(saved.profiles.find(([key]) => key === token)[1], block), 1);
  } finally {
    a?.socket.terminate(); await game?.close(); await rm(directory, { recursive: true, force: true });
  }
});
