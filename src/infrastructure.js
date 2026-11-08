import { AIR, HEIGHT, SIZE, EYE_HEIGHT, STONE, WOOD, STONE_BRICKS, BRACED_TIMBER, WOODEN_CHEST, BRACED_DOOR, buildBlock, isCabinet, doorState } from './world.js';
import { STACK_LIMIT, validStack } from './inventory.js';

export const STORAGE_SLOTS = 27;
export const MAX_CONTAINERS = 4096;
export const MAX_DAMAGE = 4096;
const STRENGTH = Object.freeze({ [STONE]: 3, [WOOD]: 3, [STONE_BRICKS]: 2, [BRACED_TIMBER]: 4, [WOODEN_CHEST]: 2, [BRACED_DOOR]: 5 });
export const strength = block => STRENGTH[buildBlock(block)] || 1;
export const isRepairable = block => [STONE_BRICKS, BRACED_TIMBER, WOODEN_CHEST, BRACED_DOOR].includes(buildBlock(block));
const key = ({ x, y, z }) => `${x},${y},${z}`;
const clone = stack => stack ? { ...stack } : null;
const position = (p, size) => p && [p.x, p.y, p.z].every(Number.isInteger) && p.x >= 0 && p.x < size && p.z >= 0 && p.z < size && p.y > 0 && p.y < HEIGHT;
const same = (a, b) => a === null ? b === null : a && b && a.block === b.block && a.count === b.count;
export const inReach = (p, c) => Math.hypot(Math.max(c.x - p.x, 0, p.x - c.x - 1), Math.max(c.y - p.y - EYE_HEIGHT, 0, p.y + EYE_HEIGHT - c.y - 1), Math.max(c.z - p.z, 0, p.z - c.z - 1)) <= 6.75;

export function validInfrastructure(containers = [], damage = [], size = 512) {
  if (!Array.isArray(containers) || containers.length > MAX_CONTAINERS || !Array.isArray(damage) || damage.length > MAX_DAMAGE) return false;
  const positions = new Set(), ids = new Set(), damaged = new Set();
  for (const c of containers) {
    if (!position(c, size) || typeof c.id !== 'string' || !/^[\w-]{1,80}$/.test(c.id) || ids.has(c.id) || positions.has(key(c))
      || !Number.isSafeInteger(c.revision) || c.revision < 0 || !Array.isArray(c.stacks) || c.stacks.length !== STORAGE_SLOTS || !Array.from(c.stacks).every(validStack)) return false;
    positions.add(key(c)); ids.add(c.id);
  }
  for (const d of damage) {
    if (!position(d, size) || damaged.has(key(d)) || !Object.hasOwn(STRENGTH, d.block)
      || !Number.isInteger(d.remaining) || d.remaining < 1 || d.remaining >= strength(d.block)) return false;
    damaged.add(key(d));
  }
  return true;
}

// The same authoritative operations serve private worlds and the shared server.
// Container revisions and source snapshots reject stale transfers before mutation.
export class Infrastructure {
  constructor(world, containers = [], damage = []) {
    this.world = world;
    this.containers = new Map(containers.map(c => [key(c), structuredClone(c)]));
    this.damage = new Map(); this.damageChunks = new Map();
    for (const d of damage) this.setDamage({ ...d });
    this.lastHit = new Map();
  }
  setDamage(d) {
    const k = key(d), chunk = `${Math.floor(d.x / 16)},${Math.floor(d.z / 16)}`;
    this.damage.set(k, d);
    if (!this.damageChunks.has(chunk)) this.damageChunks.set(chunk, new Map());
    this.damageChunks.get(chunk).set(k, d);
  }
  clearDamage(p) {
    const k = key(p), chunk = `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`;
    this.damage.delete(k);
    const records = this.damageChunks.get(chunk); records?.delete(k);
    if (!records?.size) this.damageChunks.delete(chunk);
  }
  chunkDamage(cx, cz) { return [...(this.damageChunks.get(`${cx},${cz}`)?.values() || [])].map(d => ({ ...d })); }
  snapshot() { return { containers: structuredClone([...this.containers.values()]), construction: [...this.damage.values()].map(d => ({ ...d })) }; }
  storage(method, args, inventory, pose, id) {
    if (!position(args, this.world.size || SIZE)) return { ok: false, reason: 'invalid' };
    if (!inReach(pose, args)) return { ok: false, reason: 'reach' };
    if (!isCabinet(this.world.get(args.x, args.y, args.z))) return { ok: false, reason: 'changed' };
    const k = key(args);
    let c = this.containers.get(k);
    if (!c) {
      if (method !== 'openStorage') return { ok: false, reason: 'changed' };
      if (this.containers.size >= MAX_CONTAINERS) return { ok: false, reason: 'capacity' };
      c = { id, x: args.x, y: args.y, z: args.z, revision: 0, stacks: Array(STORAGE_SLOTS).fill(null) };
      this.containers.set(k, c);
    }
    const result = (ok, reason, moved = 0) => ({ ok, reason, moved, type: 'storage', storage: structuredClone(c) });
    if (method === 'openStorage') return result(true);
    if (args.containerId !== c.id || args.revision !== c.revision) return result(false, 'changed');
    if (!['player', 'storage'].includes(args.source) || !Number.isInteger(args.index) || !Number.isInteger(args.amount) || args.amount < 1 || args.amount > STACK_LIMIT) return result(false, 'invalid');
    const source = args.source === 'player' ? inventory.stacks : c.stacks;
    const destination = args.source === 'player' ? c.stacks : inventory.stacks;
    if (args.index < 0 || args.index >= source.length || !source[args.index] || !same(source[args.index], args.expectedSource)) return result(false, 'changed');
    const stack = source[args.index], next = destination.map(clone);
    const total = Math.min(args.amount, stack.count);
    let left = total;
    for (const s of next) if (s?.block === stack.block && s.count < STACK_LIMIT) { const add = Math.min(left, STACK_LIMIT - s.count); s.count += add; left -= add; }
    for (let i = 0; i < next.length && left; i++) if (!next[i]) { const count = Math.min(STACK_LIMIT, left); next[i] = { block: stack.block, count }; left -= count; }
    const moved = total - left;
    if (!moved) return result(false, 'inventory_full');
    if (args.source === 'player') c.stacks = next; else inventory.stacks = next;
    stack.count -= moved;
    if (!stack.count) source[args.index] = null;
    c.revision++;
    return result(true, undefined, moved);
  }
  guard(changes) {
    for (const c of changes) if (isCabinet(c.from) && !isCabinet(c.to) && this.containers.get(key(c))?.stacks.some(Boolean)) return { ok: false, reason: 'storage_not_empty' };
    return { ok: true };
  }
  strike(changes, time, actor = 'local') {
    const c = changes[0];
    if (c.to !== AIR || strength(c.from) <= 1) return null;
    const state = doorState(c.from), p = { x: c.x, y: c.y - Number(state?.upper || false), z: c.z }, k = key(p);
    const previous = this.lastHit.get(actor);
    if (previous && previous.key === k && time - previous.time < 0.3) return { ok: false, reason: 'cooldown' };
    const d = this.damage.get(k), block = buildBlock(c.from), remaining = (d?.block === block ? d.remaining : strength(block)) - 1;
    if (!remaining) { this.lastHit.set(actor, { key: k, time }); return null; }
    if (!d && this.damage.size >= MAX_DAMAGE) return { ok: false, reason: 'capacity' };
    this.lastHit.set(actor, { key: k, time });
    const damage = { ...p, block, remaining };
    this.setDamage(damage);
    return { ok: true, type: 'construction', damage: { ...damage }, remaining };
  }
  changed(changes) {
    for (const c of changes) if (buildBlock(c.from) !== buildBlock(c.to)) {
      this.clearDamage(c);
      if (isCabinet(c.from)) this.containers.delete(key(c));
    }
  }
}
