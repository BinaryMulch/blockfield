import { AIR, GRASS, DIRT, STONE, WOOD, LEAVES, SAND, WATER, FLOWER_TYPES, HEIGHT } from './world.js';

export const CHUNK_SIZE = 16;
export const WORLD_SIZE = 512;
export const GENERATOR_VERSION = 1;
export const chunkKey = (cx, cz) => `${cx},${cz}`;
export const chunkIndex = (x, y, z) => x + CHUNK_SIZE * (z + CHUNK_SIZE * y);
export const seedNumber = seed => {
  let value = 2166136261;
  for (const character of String(seed)) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
};
function hash(x, z, seed) {
  let value = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return (value ^ value >>> 16) >>> 0;
}
function noise(x, z, scale, seed) {
  const gx = Math.floor(x / scale), gz = Math.floor(z / scale);
  const smooth = value => value * value * (3 - 2 * value);
  const tx = smooth(x / scale - gx), tz = smooth(z / scale - gz);
  const at = (dx, dz) => hash(gx + dx, gz + dz, seed) / 4294967295;
  return (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - tz) + (at(0, 1) * (1 - tx) + at(1, 1) * tx) * tz;
}

export function terrainColumn(seed, x, z, size = WORLD_SIZE) {
  const n = typeof seed === 'number' ? seed : seedNumber(seed);
  const height = 3 + noise(x, z, 64, n) * 8 + noise(x, z, 20, n ^ 9181) * 3;
  const clearing = Math.min(1, Math.max(0, (16 - Math.hypot(x - size / 2, z - size / 2)) / 10));
  const top = Math.floor(height * (1 - clearing) + 7 * clearing);
  return { top, wet: top < 6, material: top <= 6 ? SAND : GRASS };
}

export function generateChunk(seed, cx, cz, size = WORLD_SIZE) {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * HEIGHT);
  const n = seedNumber(seed);
  const startX = cx * CHUNK_SIZE, startZ = cz * CHUNK_SIZE;
  const write = (x, y, z, block, onlyAir = false) => {
    const lx = x - startX, lz = z - startZ;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= HEIGHT || x < 0 || z < 0 || x >= size || z >= size) return;
    const index = chunkIndex(lx, y, lz);
    if (!onlyAir || blocks[index] === AIR) blocks[index] = block;
  };
  for (let z = startZ; z < startZ + CHUNK_SIZE; z++) for (let x = startX; x < startX + CHUNK_SIZE; x++) {
    const { top, wet, material } = terrainColumn(n, x, z, size);
    for (let y = 0; y <= top; y++) write(x, y, z, y === 0 ? STONE : y === top ? material : y >= top - 2 ? DIRT : STONE);
    if (wet) for (let y = top + 1; y <= 6; y++) write(x, y, z, WATER);
  }
  // Tree anchors are global. Every touched chunk independently stamps the same
  // neighboring trees, so canopies remain identical regardless of load order.
  for (let gz = Math.floor((startZ - 3) / 8); gz <= Math.floor((startZ + CHUNK_SIZE + 2) / 8); gz++) {
    for (let gx = Math.floor((startX - 3) / 8); gx <= Math.floor((startX + CHUNK_SIZE + 2) / 8); gx++) {
      const h = hash(gx, gz, n ^ 78219);
      if (h % 5 === 0) continue;
      const x = gx * 8 + 1 + h % 7, z = gz * 8 + 1 + (h >>> 3) % 7;
      if (x < 1 || z < 1 || x >= size - 1 || z >= size - 1) continue;
      if (Math.hypot(x - size / 2, z - size / 2) < 7) continue;
      const { top, material } = terrainColumn(n, x, z, size);
      if (material !== GRASS) continue;
      const base = top + 1, trunk = 4 + (h >>> 8) % 2;
      for (let y = base; y < base + trunk; y++) write(x, y, z, WOOD);
      for (let layer = -2; layer <= 1; layer++) {
        const radius = layer < 0 ? 2 : 1;
        for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) + Math.abs(dz) <= (layer === 1 ? 1 : radius * 2 - 1)) write(x + dx, base + trunk + layer, z + dz, LEAVES, true);
        }
      }
    }
  }
  for (let z = startZ; z < startZ + CHUNK_SIZE; z++) for (let x = startX; x < startX + CHUNK_SIZE; x++) {
    if (Math.hypot(x - size / 2, z - size / 2) < 2.5) continue;
    const h = hash(x, z, n ^ 91721);
    if (h % 19 > 1 || Math.sin(x * 0.32) + Math.cos(z * 0.38) < -0.2) continue;
    const { top, material } = terrainColumn(n, x, z, size);
    if (material === GRASS) write(x, top + 1, z, FLOWER_TYPES[(h >>> 9) % 3], true);
  }
  return blocks;
}

export function nearbyChunks(x, z, radius, size = WORLD_SIZE) {
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE), count = Math.ceil(size / CHUNK_SIZE);
  const chunks = [];
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
    if (cx + dx < 0 || cz + dz < 0 || cx + dx >= count || cz + dz >= count) continue;
    chunks.push({ cx: cx + dx, cz: cz + dz, key: chunkKey(cx + dx, cz + dz), distance: dx * dx + dz * dz });
  }
  return chunks.sort((a, b) => a.distance - b.distance || a.cz - b.cz || a.cx - b.cx);
}
