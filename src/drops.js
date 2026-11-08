import { HEIGHT, SIZE, isSolid, blockBounds, buildBlock, doorState } from './world.js';
import { MATERIALS, STACK_LIMIT, INVENTORY_SIZE } from './inventory.js';

export const MAX_DROPS = 256;
export const PICKUP_RADIUS = 1;
const blocks = new Set(MATERIALS.map(item => item.id));
const RADIUS = 0.16;

// Read only resident terrain. An item must wait at an unloaded boundary rather
// than fall through terrain that has not arrived or generate a chunk itself.
function floorBelow(world, item) {
  let floor = 0;
  for (let y = Math.floor(item.y); y >= 0; y--) {
    for (let x = Math.floor(item.x - RADIUS); x <= Math.floor(item.x + RADIUS); x++) {
      for (let z = Math.floor(item.z - RADIUS); z <= Math.floor(item.z + RADIUS); z++) {
        if (world.getChunk && !world.getChunk(Math.floor(x / 16), Math.floor(z / 16), false)) return null;
        if (world.isAreaReady && !world.isAreaReady(x + .5, z + .5)) return null;
        const block = world.get(x, y, z);
        if (!isSolid(block)) continue;
        const b = blockBounds(block, x, y, z);
        if (b.maxY <= item.y + 1e-6 && item.x + RADIUS > b.minX && item.x - RADIUS < b.maxX
          && item.z + RADIUS > b.minZ && item.z - RADIUS < b.maxZ) floor = Math.max(floor, b.maxY);
      }
    }
    if (floor > 0) break;
  }
  return floor + RADIUS + 1e-5;
}

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
  dirty = false;
  origins = new Map();
  constructor(saved = []) { this.items = saved.map(item => ({ ...item })); }
  snapshot() { return this.items.map(item => ({ ...item })); }
  publicSnapshot() {
    const items = this.items.map(item => this.origins.has(item.id) ? { ...item, spawnY: this.origins.get(item.id) } : { ...item });
    this.origins.clear();
    return items;
  }

  settle(world) {
    let changed = false;
    for (const item of this.items) {
      const floor = floorBelow(world, item);
      if (floor !== null && floor < item.y - 1e-6) { item.y = floor; changed = true; }
    }
    if (changed) this.dirty = true;
    return changed;
  }

  planHarvest(changes, collected, now) {
    const remaining = new Map(collected), items = [];
    for (const change of changes) {
      const block = buildBlock(change.from), count = remaining.get(block) || 0;
      if (!count || doorState(change.from)?.upper) continue;
      items.push({ id: crypto.randomUUID(), block, count: 1, x: change.x + .5, y: change.y + .35, z: change.z + .5, readyAt: now + 900 });
      remaining.set(block, count - 1);
    }
    if (this.items.length + items.length > MAX_DROPS) return { ok: false, reason: 'drops_full' };
    return { ok: true, items };
  }
  commitHarvest(world, plan) {
    for (const item of plan.items) this.origins.set(item.id, item.y);
    this.items.push(...plan.items);
    // Existing drops need a new floor too when this edit removes their support.
    return this.settle(world);
  }

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
    this.items.push({ id, block: stack.block, count: amount, ...position, readyAt: now + 1500 });
    this.origins.set(id, position.y);
    this.settle(world);
    stack.count -= amount;
    if (!stack.count) inventory.stacks[source] = null;
    return { ok: true, type: 'drops' };
  }

  pickup(world, inventory, pose, now = Date.now()) {
    if (!inventory?.stacks || !pose.active) return { ok: false, reason: 'empty' };
    this.settle(world);
    const before = inventory.stacks.slice(0, 9).map(stack => stack ? { ...stack } : null);
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
    const ids = new Set(this.items.map(item => item.id));
    for (const id of this.origins.keys()) if (!ids.has(id)) this.origins.delete(id);
    const hotbarSlots = inventory.stacks.slice(0, 9).flatMap((stack, i) => stack && (stack.block !== before[i]?.block || stack.count > before[i].count) ? [i] : []);
    return picked ? { ok: true, type: 'drops', picked, hotbarSlots } : { ok: false, reason: 'empty' };
  }
}
