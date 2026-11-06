import { AIR, WATER, PLANKS, SLAB, UPPER_SLAB, isSlab, isFlower } from './world.js';

// Return a voxel edit from a picked face. Inner slab faces fill the same cell;
// side placements follow the half of the face the player aimed at.
export function slabPlacement(world, target) {
  const { x, y, z, normal, point } = target;
  const current = world.get(x, y, z);
  if (isFlower(current)) return { x, y, z, block: SLAB };
  if (current === SLAB && normal.y > 0.5 || current === UPPER_SLAB && normal.y < -0.5) {
    return { x, y, z, block: PLANKS };
  }
  const next = { x: x + Math.round(normal.x), y: y + Math.round(normal.y), z: z + Math.round(normal.z) };
  const block = normal.y < -0.5 || normal.y === 0 && point.y - Math.floor(point.y) >= 0.5 ? UPPER_SLAB : SLAB;
  const existing = world.get(next.x, next.y, next.z);
  if (isSlab(existing) && existing !== block) return { ...next, block: PLANKS };
  if (existing !== AIR && existing !== WATER && !isFlower(existing)) return null;
  return { ...next, block };
}
