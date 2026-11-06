import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkWorld } from '../src/chunks.js';
import { generateChunk, CHUNK_SIZE, WORLD_SIZE, nearbyChunks, chunkIndex } from '../src/generation.js';
import { World, HEIGHT, AIR, GRASS, STONE, WOOD, LEAVES, WATER, LANTERN, DAISY, PLANKS, stepPlayer } from '../src/world.js';
import { GameRoom } from '../server/room.js';
import { buildChunkGeometry } from '../src/terrain.js';
import { serverURL } from '../src/session.js';

test('large worlds allocate chunks on demand rather than a world-sized voxel array', () => {
  const world = new ChunkWorld({ seed: 'allocation' });
  assert.equal(world.size, 512); assert.equal(world.blocks, undefined); assert.equal(world.chunks.size, 0);
  world.get(200, 0, 300);
  assert.equal(world.chunks.size, 1);
  assert.equal([...world.chunks.values()][0].blocks.byteLength, 16 * 16 * HEIGHT);
  assert.equal(world.get(-1, 0, 0), AIR);
  assert.equal(world.set(512, 1, 0, STONE), false);
});

test('generation is seeded, order-independent, bounded, and keeps spawn clear', () => {
  const a = new ChunkWorld({ seed: 'forest' }), b = new ChunkWorld({ seed: 'forest' });
  for (const [cx, cz] of [[15, 15], [16, 15], [15, 16], [16, 16]]) a.getChunk(cx, cz);
  for (const [cx, cz] of [[16, 16], [15, 16], [16, 15], [15, 15]]) b.getChunk(cx, cz);
  for (const [key, chunk] of a.chunks) assert.deepEqual(chunk.blocks, b.chunks.get(key).blocks);
  assert.notDeepEqual(generateChunk('forest', 5, 5), generateChunk('desert', 5, 5));
  for (let z = 254; z <= 258; z++) for (let x = 254; x <= 258; x++) {
    assert.equal(a.get(x, 0, z), STONE);
    for (let y = 9; y < HEIGHT; y++) assert.ok(![WOOD, LEAVES].includes(a.get(x, y, z)));
  }
  assert.equal(a.get(256, 7, 256), GRASS);
});

test('tree canopies extend consistently across a chunk boundary', () => {
  const world = new ChunkWorld({ seed: 'seam-test' });
  let found = false;
  for (let cz = 2; cz < 8 && !found; cz++) for (let cx = 2; cx < 8 && !found; cx++) {
    for (let z = cz * 16; z < cz * 16 + 16 && !found; z++) for (const x of [cx * 16, cx * 16 + 15]) {
      for (let y = 1; y < HEIGHT - 6; y++) {
        if (world.get(x, y, z) !== WOOD || world.get(x, y - 1, z) !== GRASS) continue;
        const adjacentX = x === cx * 16 ? x - 1 : x + 1;
        let top = y; while (world.get(x, top, z) === WOOD) top++;
        if (world.get(adjacentX, top - 1, z) === LEAVES) {
          const next = new ChunkWorld({ seed: 'seam-test' });
          next.getChunk(Math.floor(adjacentX / 16), Math.floor(z / 16));
          assert.equal(next.get(adjacentX, top - 1, z), LEAVES);
          next.getChunk(Math.floor(x / 16), Math.floor(z / 16));
          assert.equal(next.get(x, y, z), WOOD);
          found = true; break;
        }
      }
    }
  }
  assert.equal(found, true);
});

test('eviction retains builds and removals, regenerates untouched terrain, and bounds active data', () => {
  const world = new ChunkWorld({ seed: 'retention' });
  world.set(256, 8, 256, PLANKS); world.set(257, 7, 256, AIR);
  const old = world.getChunk(16, 16).blocks;
  for (const position of [{ x: 256, z: 256 }, { x: 400, z: 400 }, { x: 40, z: 40 }]) {
    for (const chunk of nearbyChunks(position.x, position.z, 4)) world.getChunk(chunk.cx, chunk.cz);
    world.evict([position], 5);
    assert.ok(world.chunks.size <= 121);
  }
  assert.equal(world.chunks.has('16,16'), false);
  assert.equal(world.get(256, 8, 256), PLANKS);
  assert.equal(world.get(257, 7, 256), AIR);
  assert.deepEqual(world.getChunk(16, 16).blocks, old);
  world.evict([], 5); assert.equal(world.chunks.size, 0);
  assert.equal(world.edits.size, 1);
});

test('cold history can regenerate a chunk and preserves conflict lineage after eviction', () => {
  const world = new ChunkWorld({ seed: 'history' }), room = new GameRoom({ world, gameMode: 'creative' });
  const a = room.join('Alice'), b = room.join('Bob');
  const command = (player, method, args = {}) => room.command(player.id, { method, ...args, ...(args.x !== undefined ? { expected: room.expected(args.x, args.y, args.z) } : {}) });
  const cell = { x: 255, y: 8, z: 255 };
  assert.equal(command(a, 'placeLantern', cell).ok, true);
  world.evict([], 5);
  assert.equal(command(b, 'edit', { ...cell, block: AIR }).ok, true);
  assert.equal(command(b, 'placeLantern', cell).ok, true);
  world.evict([], 5);
  assert.equal(command(a, 'undo').reason, 'changed');
  assert.equal(world.get(cell.x, cell.y, cell.z), LANTERN);
  command(b, 'undo'); command(b, 'undo');
  assert.equal(command(a, 'undo').ok, true);
  assert.equal(world.get(cell.x, cell.y, cell.z), AIR);
});

test('client revisions apply atomic chunk updates and reject stale edits', () => {
  const world = new ChunkWorld({ generate: false });
  world.putChunk(0, 0, new Uint8Array(16 * 16 * HEIGHT), 2);
  world.putChunk(1, 0, new Uint8Array(16 * 16 * HEIGHT), 5);
  const changes = [{ x: 8, y: 1, z: 8, from: AIR, to: DAISY }];
  assert.equal(world.applyUpdates([{ key: '0,0', previousRevision: 1, revision: 3, changes }]), false);
  assert.equal(world.get(8, 1, 8), AIR);
  assert.equal(world.applyUpdates([{ key: '0,0', previousRevision: 2, revision: 3, changes }, { key: '1,0', previousRevision: 4, revision: 6, changes: [] }]), false);
  assert.equal(world.get(8, 1, 8), AIR);
  assert.equal(world.applyUpdates([{ key: '0,0', previousRevision: 2, revision: 3, changes }]), true);
  assert.equal(world.get(8, 1, 8), DAISY);
});

test('collision waits for missing chunks instead of walking or falling into unloaded terrain', () => {
  const world = new ChunkWorld({ generate: false });
  const floor = () => { const blocks = new Uint8Array(16 * 16 * HEIGHT); for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[chunkIndex(x, 0, z)] = STONE; return blocks; };
  world.putChunk(0, 0, floor());
  const player = { x: 15.5, y: 1, z: 8.5, vy: 0, grounded: true };
  for (let i = 0; i < 120; i++) stepPlayer(player, world, { strafe: 1 }, 1 / 120);
  assert.ok(player.x < 16); assert.equal(player.y, 1);
  world.putChunk(1, 0, floor());
  for (let i = 0; i < 120; i++) stepPlayer(player, world, { strafe: 1 }, 1 / 120);
  assert.ok(player.x > 19); assert.equal(player.y, 1);
});

test('chunk meshes cull the shared boundary and rebuild only their own region', () => {
  const world = new World({ generate: false });
  world.set(15, 1, 8, STONE); world.set(16, 1, 8, STONE);
  const left = buildChunkGeometry(world, 0, 0), right = buildChunkGeometry(world, 1, 0);
  assert.equal(left.solid.index.count, 30); assert.equal(right.solid.index.count, 30);
  world.set(16, 1, 8, AIR);
  const exposed = buildChunkGeometry(world, 0, 0);
  assert.equal(exposed.solid.index.count, 36);
  for (const geometry of [...Object.values(left), ...Object.values(right), ...Object.values(exposed)]) geometry.dispose();
});

test('interest rings are bounded and joining accepts only normal web server addresses', () => {
  assert.equal(nearbyChunks(256, 256, 3).length, 49);
  assert.equal(nearbyChunks(256, 256, 4).length, 81);
  assert.equal(nearbyChunks(0, 0, 4).length, 25);
  assert.equal(serverURL('192.168.1.5:6200', 'http://localhost:6200').href, 'http://192.168.1.5:6200/?join=1');
  assert.equal(serverURL('https://example.com', 'http://localhost').href, 'https://example.com/?join=1');
  assert.throws(() => serverURL('javascript:alert(1)', 'http://localhost'));
  assert.throws(() => serverURL('http://user:secret@example.com', 'http://localhost'));
});

test('joining accepts separate IP and port fields, including IPv6 and secure hosts', () => {
  assert.equal(serverURL('192.168.1.5', 'http://localhost:6200', '6210').href, 'http://192.168.1.5:6210/?join=1');
  assert.equal(serverURL('localhost', 'http://localhost:6200', '6200').href, 'http://localhost:6200/?join=1');
  assert.equal(serverURL('example.com', 'https://game.example.com', '443').href, 'https://example.com/?join=1');
  assert.equal(serverURL('::1', 'http://localhost:6200', '6200').href, 'http://[::1]:6200/?join=1');
  assert.equal(serverURL('[::1]', 'http://localhost:6200', '6200').href, 'http://[::1]:6200/?join=1');
  assert.equal(serverURL('', 'https://game.example.com', '443').href, 'https://game.example.com/?join=1');
  assert.equal(serverURL('http://192.168.1.5:6200', 'https://example.com', '6210').href, 'http://192.168.1.5:6210/?join=1');
  for (const port of ['', '0', '-1', '65536', 'abc', '62.5', '6e3']) {
    assert.throws(() => serverURL('192.168.1.5', 'http://localhost:6200', port), /port number/);
  }
  assert.throws(() => serverURL('not a host', 'http://localhost:6200', '6200'), /IP address or hostname/);
});

test('deeper lakes have a single visible water surface without gaps between water cells', () => {
  const world = new World({ generate: false });
  world.set(8, 0, 8, STONE); world.set(8, 1, 8, WATER); world.set(8, 2, 8, WATER);
  const geometry = buildChunkGeometry(world, 0, 0);
  const normals = geometry.water.getAttribute('normal'), positions = geometry.water.getAttribute('position');
  let topVertices = 0;
  for (let i = 0; i < normals.count; i++) if (normals.getY(i) === 1) {
    topVertices++; assert.ok(Math.abs(positions.getY(i) - 2.88) < 0.00001);
  }
  assert.equal(topVertices, 4);
  for (const mesh of Object.values(geometry)) mesh.dispose();
});
