import { generateChunk, CHUNK_SIZE } from './generation.js';
import { HEIGHT, AIR } from './world.js';
import { buildChunkGeometry } from './terrain.js';
import { buildLanternField } from './lantern-field.js';

self.onmessage = ({ data: job }) => {
  const started = performance.now();
  try {
    if (job.kind === 'light') {
      const result = buildLanternField(job);
      self.postMessage({ id: job.id, ...result, workMs: performance.now() - started }, [result.light.buffer]);
      return;
    }
    if (job.kind === 'generate') {
      const blocks = generateChunk(job.seed, job.cx, job.cz, job.size);
      self.postMessage({ id: job.id, blocks, workMs: performance.now() - started }, [blocks.buffer]);
      return;
    }
    const { cx, cz, halo } = job;
    const minX = cx * CHUNK_SIZE - 1, minZ = cz * CHUNK_SIZE - 1, stride = CHUNK_SIZE + 2;
    const world = { get(x, y, z) {
      const lx = x - minX, lz = z - minZ;
      return lx >= 0 && lx < stride && lz >= 0 && lz < stride && y >= 0 && y < HEIGHT ? halo[lx + stride * (lz + stride * y)] : AIR;
    } };
    const result = {}, transfer = [];
    for (const [mode, geometry] of Object.entries(buildChunkGeometry(world, cx, cz))) {
      result[mode] = { position: geometry.attributes.position.array, normal: geometry.attributes.normal.array,
        color: geometry.attributes.color.array, uv: geometry.attributes.uv.array, index: geometry.index.array };
      for (const array of Object.values(result[mode])) transfer.push(array.buffer);
      geometry.dispose();
    }
    self.postMessage({ id: job.id, result, workMs: performance.now() - started }, transfer);
  } catch (error) { self.postMessage({ id: job.id, error: error.message }); }
};
