import { AIR, STONE, LANTERN, SLAB, UPPER_SLAB, HEIGHT, SIZE, isOpaque, isSlab, doorState } from './world.js';
import { CHUNK_SIZE } from './generation.js';

export const LANTERN_RANGE = 8;
export const LIGHT_LEVELS = LANTERN_RANGE + 1;
export const LIGHT_CHUNK_RADIUS = 4;
export const fieldIndex = (x, y, z, width, height) => x + width * (y + height * z);
const blocksLight = block => isOpaque(block) || doorState(block)?.open === false;

function passage(from, to, vertical) {
  if (blocksLight(to)) return false;
  // Slabs leave a half-cell passage, but light cannot travel through the slab.
  if (vertical > 0 && (from === UPPER_SLAB || to === SLAB)) return false;
  if (vertical < 0 && (from === SLAB || to === UPPER_SLAB)) return false;
  if (!vertical && isSlab(from) && isSlab(to) && from !== to) return false;
  return true;
}

export function lightBounds(world, position) {
  const size = world.size || SIZE;
  const cx = Math.max(0, Math.min(Math.ceil(size / CHUNK_SIZE) - 1, Math.floor(position.x / CHUNK_SIZE)));
  const cz = Math.max(0, Math.min(Math.ceil(size / CHUNK_SIZE) - 1, Math.floor(position.z / CHUNK_SIZE)));
  const x = Math.max(0, cx - LIGHT_CHUNK_RADIUS) * CHUNK_SIZE, z = Math.max(0, cz - LIGHT_CHUNK_RADIUS) * CHUNK_SIZE;
  return { x, z, width: Math.min(size, (cx + LIGHT_CHUNK_RADIUS + 1) * CHUNK_SIZE) - x,
    depth: Math.min(size, (cz + LIGHT_CHUNK_RADIUS + 1) * CHUNK_SIZE) - z, height: HEIGHT + LANTERN_RANGE };
}

export function captureLightBlocks(world, bounds) {
  const { x, z, width, height, depth } = bounds;
  // Unloaded cells are closed. Treating them as air would leak across cache edges.
  const blocks = new Uint8Array(width * height * depth).fill(STONE);
  for (let dz = 0; dz < depth; dz++) for (let y = HEIGHT; y < height; y++) {
    blocks.fill(AIR, fieldIndex(0, y, dz, width, height), fieldIndex(0, y, dz, width, height) + width);
  }
  if (world.chunks) {
    for (const chunk of world.chunks.values()) {
      const dx = chunk.cx * CHUNK_SIZE - x, dz = chunk.cz * CHUNK_SIZE - z;
      if (dx < 0 || dz < 0 || dx >= width || dz >= depth) continue;
      for (let y = 0; y < HEIGHT; y++) for (let row = 0; row < Math.min(CHUNK_SIZE, depth - dz); row++) {
        const start = y * CHUNK_SIZE * CHUNK_SIZE + row * CHUNK_SIZE;
        blocks.set(chunk.blocks.subarray(start, start + Math.min(CHUNK_SIZE, width - dx)), fieldIndex(dx, y, dz + row, width, height));
      }
    }
  } else {
    for (let dz = 0; dz < depth; dz++) for (let y = 0; y < HEIGHT; y++) for (let dx = 0; dx < width; dx++) {
      blocks[fieldIndex(dx, y, dz, width, height)] = world.get(x + dx, y, z + dz);
    }
  }
  return blocks;
}

export function buildLanternField({ blocks, width, height, depth }) {
  const light = new Uint8Array(blocks.length), queue = new Uint32Array(blocks.length);
  let tail = 0, sources = 0;
  for (let i = 0; i < blocks.length; i++) if (blocks[i] === LANTERN) {
    light[i] = LIGHT_LEVELS; queue[tail++] = i; sources++;
  }
  const plane = width * height;
  for (let head = 0; head < tail; head++) {
    const index = queue[head], nextLevel = light[index] - 1;
    if (nextLevel < 1) continue;
    const x = index % width, y = Math.floor(index / width) % height, z = Math.floor(index / plane);
    const spread = (next, vertical = 0) => {
      if (light[next] >= nextLevel || !passage(blocks[index], blocks[next], vertical)) return;
      light[next] = nextLevel; queue[tail++] = next;
    };
    if (x > 0) spread(index - 1);
    if (x + 1 < width) spread(index + 1);
    if (y > 0) spread(index - width, -1);
    if (y + 1 < height) spread(index + width, 1);
    if (z > 0) spread(index - plane);
    if (z + 1 < depth) spread(index + plane);
  }
  // Bake the falloff once; rendering needs just one nearest-cell texture lookup.
  for (let i = 0; i < light.length; i++) if (light[i]) light[i] = Math.round((light[i] / LIGHT_LEVELS) ** 1.7 * 255);
  return { light, sources };
}
