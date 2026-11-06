import { HEIGHT, SIZE, isSolid, blockBounds } from './world.js';
import { CREATIVE_ITEMS, STACK_LIMIT, INVENTORY_SIZE } from './inventory.js';

export const MAX_DROPS = 256;
export const PICKUP_RADIUS = 1.25;
const blocks = new Set(CREATIVE_ITEMS.map(item => item.id));
const RADIUS = 0.16;

export function validDrops(drops, size) {
  if (!Array.isArray(drops) || drops.length > MAX_DROPS) return false;
  const ids = new Set();
  return Array.from(drops).every(item => {
    if (!item || typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) || ids.has(item.id)
      || !blocks.has(item.block) || !Number.isInteger(item.count) || item.count < 1 || item.count > STACK_LIMIT
      || !['x', 'y', 'z', 'readyAt'].every(key => Number.isFinite(item[key])) || item.readyAt < 0
      || item.x < RADIUS || item.x > size - RADIUS || item.z < RADIUS || item.z > size - RADIUS
      || item.y < RADIUS || item.y > HEIGHT + 12) return false;
    ids.add(item.id); return true;
  });
}

// Unknown chunks act as walls; item operations never generate terrain in a private world.
function blocked(world, x, y, z) {
  const size = world.size || SIZE;
  if (x < RADIUS || z < RADIUS || x > size - RADIUS || z > size - RADIUS) return true;
  if (world.isAreaReady && !world.isAreaReady(x, z)) return true;
  for (let bx = Math.floor(x - RADIUS); bx <= Math.floor(x + RADIUS); bx++) {
    for (let by = Math.floor(y - RADIUS); by <= Math.floor(y + RADIUS); by++) {
      for (let bz = Math.floor(z - RADIUS); bz <= Math.floor(z + RADIUS); bz++) {
        const block = world.get(bx, by, bz);
        if (!isSolid(block)) continue;
        const b = blockBounds(block, bx, by, bz);
        if (x + RADIUS > b.minX && x - RADIUS < b.maxX && y + RADIUS > b.minY && y - RADIUS < b.maxY && z + RADIUS > b.minZ && z - RADIUS < b.maxZ) return true;
      }
    }
  }
  return false;
}

function clearPath(world, from, to) {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const steps = Math.max(1, Math.ceil(length / 0.08));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (blocked(world, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t)) return false;
  }
  return true;
}

export class ItemDrops {
  constructor(saved = []) { this.items = saved.map(item => ({ ...item })); }
  snapshot() { return this.items.map(item => ({ ...item })); }

  drop(world, inventory, pose, args, id, now = Date.now()) {
    if (!inventory?.stacks) return { ok: false, reason: 'invalid' };
    const { source, amount, expectedSource } = args;
    if (!Number.isInteger(source) || source < 0 || source >= INVENTORY_SIZE) return { ok: false, reason: 'invalid' };
    const stack = inventory.stacks[source];
    if (!stack || !expectedSource || stack.block !== expectedSource.block || stack.count !== expectedSource.count) return { ok: false, reason: 'changed' };
    if (!Number.isInteger(amount) || amount < 1 || amount > stack.count) return { ok: false, reason: 'invalid' };
    if (this.items.length >= MAX_DROPS) return { ok: false, reason: 'drops_full' };
    let position = { x: pose.x, y: pose.y + 0.8, z: pose.z };
    if (blocked(world, position.x, position.y, position.z)) return { ok: false, reason: 'blocked' };
    // Put the item ahead of the player, stopping at walls and world/chunk edges.
    for (let step = 1; step <= 16; step++) {
      const distance = step * 0.1;
      const next = { x: pose.x - Math.sin(pose.yaw) * distance, y: position.y, z: pose.z - Math.cos(pose.yaw) * distance };
      if (blocked(world, next.x, next.y, next.z)) break;
      position = next;
    }
    // Settle onto the first surface below, respecting slabs and other thin shapes.
    while (position.y - 0.05 >= RADIUS && !blocked(world, position.x, position.y - 0.05, position.z)) position.y -= 0.05;
    this.items.push({ id, block: stack.block, count: amount, ...position, readyAt: now + 1500 });
    stack.count -= amount;
    if (!stack.count) inventory.stacks[source] = null;
    return { ok: true, type: 'drops' };
  }

  pickup(world, inventory, pose, now = Date.now()) {
    if (!inventory?.stacks || !pose.active) return { ok: false, reason: 'empty' };
    let picked = 0;
    for (const item of this.items) {
      if (now < item.readyAt || Math.hypot(item.x - pose.x, item.z - pose.z) > PICKUP_RADIUS
        || item.y < pose.y - 0.3 || item.y > pose.y + 1.8
        || !clearPath(world, { x: pose.x, y: pose.y + 0.8, z: pose.z }, item)) continue;
      const capacity = inventory.stacks.reduce((sum, stack) => sum + (!stack ? STACK_LIMIT : stack.block === item.block ? STACK_LIMIT - stack.count : 0), 0);
      const count = Math.min(capacity, item.count);
      if (!count) continue;
      inventory.applyBalance(inventory.balance(new Map([[item.block, count]])));
      item.count -= count; picked += count;
    }
    this.items = this.items.filter(item => item.count > 0);
    return picked ? { ok: true, type: 'drops' } : { ok: false, reason: 'empty' };
  }
}
