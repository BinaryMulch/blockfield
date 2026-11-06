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
  return { socket, next };
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
