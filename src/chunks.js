import { World, AIR, HEIGHT, isBlock, isFlower, blockBounds, doorState } from './world.js';
import { CHUNK_SIZE, WORLD_SIZE, GENERATOR_VERSION, chunkKey, chunkIndex, generateChunk } from './generation.js';

export class ChunkWorld extends World {
  constructor({ seed = 'Blockfield', size = WORLD_SIZE, generate = true, retainEdits = generate } = {}) {
    super({ generate: false });
    delete this.blocks;
    this.seed = String(seed).slice(0, 80);
    this.size = size;
    this.spawn = { x: size / 2, z: size / 2 };
    this.autoGenerate = generate;
    this.retainEdits = retainEdits;
    this.chunks = new Map();
    this.edits = new Map();
    this.revisions = new Map();
    this.serial = 0;
  }

  metadata() { return { seed: this.seed, size: this.size, height: HEIGHT, chunkSize: CHUNK_SIZE, generator: GENERATOR_VERSION }; }
  configure(metadata, retainEdits = false) {
    this.seed = String(metadata.seed).slice(0, 80); this.size = metadata.size;
    this.spawn = { x: this.size / 2, z: this.size / 2 };
    this.autoGenerate = false; this.retainEdits = retainEdits;
    this.chunks.clear(); this.edits.clear(); this.revisions.clear(); this.serial++;
  }
  contains(x, y, z) { return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) && x >= 0 && x < this.size && z >= 0 && z < this.size && y >= 0 && y < HEIGHT; }
  keyAt(x, z) { return chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)); }
  indexAt(x, y, z) { return chunkIndex(x % CHUNK_SIZE, y, z % CHUNK_SIZE); }

  getChunk(cx, cz, create = this.autoGenerate) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk && create && cx >= 0 && cz >= 0 && cx * CHUNK_SIZE < this.size && cz * CHUNK_SIZE < this.size) {
      chunk = this.putChunk(cx, cz, generateChunk(this.seed, cx, cz, this.size), this.revisions.get(key) || 0);
    }
    return chunk;
  }

  putChunk(cx, cz, blocks, revision = 0) {
    const key = chunkKey(cx, cz);
    if (this.retainEdits) for (const [index, block] of this.edits.get(key) || []) blocks[index] = block;
    const chunk = { cx, cz, key, blocks, revision, serial: ++this.serial };
    this.chunks.set(key, chunk);
    return chunk;
  }

  get(x, y, z) {
    if (!this.contains(x, y, z)) return AIR;
    return this.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))?.blocks[this.indexAt(x, y, z)] ?? AIR;
  }

  set(x, y, z, block) {
    if (!this.contains(x, y, z) || !isBlock(block)) return false;
    const chunk = this.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    if (!chunk) return false;
    const index = this.indexAt(x, y, z);
    chunk.blocks[index] = block;
    chunk.revision++; chunk.serial = ++this.serial;
    if (this.retainEdits) {
      if (!this.edits.has(chunk.key)) this.edits.set(chunk.key, new Map());
      this.edits.get(chunk.key).set(index, block);
      this.revisions.set(chunk.key, chunk.revision);
    }
    return true;
  }

  applyUpdates(updates) {
    for (const update of updates) {
      const chunk = this.chunks.get(update.key);
      if (chunk && chunk.revision !== update.previousRevision) return false;
    }
    for (const update of updates) {
      const chunk = this.chunks.get(update.key);
      if (!chunk) continue;
      for (const c of update.changes) chunk.blocks[this.indexAt(c.x, c.y, c.z)] = c.to;
      chunk.revision = update.revision; chunk.serial = ++this.serial;
    }
    return true;
  }

  isAreaReady(x, z) {
    if (this.autoGenerate) return true;
    for (const dx of [-0.31, 0.31]) for (const dz of [-0.31, 0.31]) {
      const px = Math.floor(x + dx), pz = Math.floor(z + dz);
      if (px >= 0 && pz >= 0 && px < this.size && pz < this.size && !this.chunks.has(this.keyAt(px, pz))) return false;
    }
    return true;
  }

  evict(centers, radius = 5) {
    const removed = [];
    for (const [key, chunk] of this.chunks) {
      if (centers.some(p => Math.abs(chunk.cx - Math.floor(p.x / CHUNK_SIZE)) <= radius && Math.abs(chunk.cz - Math.floor(p.z / CHUNK_SIZE)) <= radius)) continue;
      this.chunks.delete(key); removed.push(key);
    }
    return removed;
  }

  doors() {
    const doors = [];
    for (const chunk of this.chunks.values()) for (let i = 0; i < chunk.blocks.length; i++) {
      const state = doorState(chunk.blocks[i]);
      if (!state || state.upper) continue;
      const x = chunk.cx * CHUNK_SIZE + i % CHUNK_SIZE, y = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE)), z = chunk.cz * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE) % CHUNK_SIZE;
      const door = this.doorAt(x, y, z);
      if (door) doors.push(door);
    }
    return doors;
  }
}
