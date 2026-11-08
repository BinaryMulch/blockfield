import { LEAVES, GLASS, isSolid, isLantern, blockBounds } from './world.js';

export const TRACE_BUDGET = 96;
export function loadedBlock(world, x, y, z) {
  if (!world.contains(x, y, z)) return undefined;
  if (world.chunks && !world.getChunk(Math.floor(x / 16), Math.floor(z / 16), false)) return undefined;
  return world.get(x, y, z);
}

function intersection(a, delta, bounds) {
  let lo = 0, hi = 1;
  for (const axis of ['x', 'y', 'z']) {
    const min = bounds[`min${axis.toUpperCase()}`], max = bounds[`max${axis.toUpperCase()}`];
    if (Math.abs(delta[axis]) < 1e-8) { if (a[axis] < min || a[axis] > max) return null; }
    else { const u = (min - a[axis]) / delta[axis], v = (max - a[axis]) / delta[axis]; lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v)); }
    if (lo > hi) return null;
  }
  return hi > .001 && lo < .999 ? lo : null;
}

// Exact voxel traversal, including thin door panels and slabs. No chunk loads.
export function traceBarriers(world, from, to, { sight = false, physical = false, first = false, read = (x, y, z) => loadedBlock(world, x, y, z) } = {}) {
  if (![from, to].every(p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k])))) return { barriers: 3, unloaded: true, steps: 0 };
  const delta = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const cell = {}, next = {}, stride = {}, step = {};
  for (const axis of ['x', 'y', 'z']) {
    cell[axis] = Math.floor(from[axis]); step[axis] = Math.sign(delta[axis]); stride[axis] = delta[axis] ? Math.abs(1 / delta[axis]) : Infinity;
    next[axis] = delta[axis] ? ((step[axis] > 0 ? cell[axis] + 1 - from[axis] : from[axis] - cell[axis]) * stride[axis]) : Infinity;
  }
  let barriers = 0;
  for (let work = 1; work <= TRACE_BUDGET; work++) {
    const block = read(cell.x, cell.y, cell.z);
    if (block === undefined) return { barriers, unloaded: true, steps: work };
    // Hearing and sight intentionally transmit through some solid materials.
    // Reaches and rescues require actual clearance through every solid shape.
    if (isSolid(block) && (physical || (sight ? block !== GLASS : block !== LEAVES) && !isLantern(block))) {
      const at = intersection(from, delta, blockBounds(block, cell.x, cell.y, cell.z));
      if (at !== null) {
        barriers++;
        if (first) return { barriers, unloaded: false, steps: work, hit: { ...cell, block, at } };
      }
    }
    if (barriers >= 3) return { barriers, unloaded: false, steps: work };
    const axis = next.x <= next.y && next.x <= next.z ? 'x' : next.y <= next.z ? 'y' : 'z';
    if (next[axis] > 1 || !Number.isFinite(next[axis])) return { barriers, unloaded: false, steps: work };
    cell[axis] += step[axis]; next[axis] += stride[axis];
  }
  return { barriers, unloaded: true, steps: TRACE_BUDGET };
}

export function soundTransmission(world, source, listener) {
  const trace = traceBarriers(world, source, listener);
  return { gain: .52 ** trace.barriers * (trace.unloaded ? .25 : 1), cutoff: trace.barriers || trace.unloaded ? 850 : 14000 };
}
