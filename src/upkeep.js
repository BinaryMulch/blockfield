import { AIR, HEIGHT, SIZE, STONE, SAND, WOOD, LEAVES, CONCRETE, WARD_LANTERN, SALVAGE_CRATE, SAPLING, SCRAP, BIOFUEL, REPAIR_TOOL, isSapling, isFlowerSoil, buildBlock, doorState, overlapsBlock } from './world.js';
import { DAY_LENGTH } from './clock.js';
import { inReach, strength } from './infrastructure.js';

export const MAX_PLANTS = 2048;
export const MAX_WARDS = 2048;
export const MAX_SALVAGE = 32;
export const GROWTH_BUDGET = 4;
export const GROWTH_STAGE_SECONDS = DAY_LENGTH;
export const WARD_CAPACITY = DAY_LENGTH * 3;
export const FUEL_SECONDS = DAY_LENGTH;
export const SALVAGE_INTERVAL = DAY_LENGTH;
const key = p => `${p.x},${p.y},${p.z}`;
const position = (p, size) => p && [p.x, p.y, p.z].every(Number.isInteger) && p.x >= 0 && p.z >= 0 && p.x < size && p.z < size && p.y > 0 && p.y < HEIGHT;
const time = n => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const resources = [SCRAP, STONE, SAND], bundle = [2, 4, 2], stockCap = [8, 16, 8];

// Indexed heap: replacing/removing plants never leaves stale timers behind.
const scheduledAt = p => p.checkAt ?? p.dueAt;
class DueQueue {
  heap = [];
  indices = new Map();
  swap(a, b) { const h = this.heap; [h[a], h[b]] = [h[b], h[a]]; this.indices.set(key(h[a]), a); this.indices.set(key(h[b]), b); }
  up(i) { while (i > 0) { const p = (i - 1) >> 1; if (scheduledAt(this.heap[p]) <= scheduledAt(this.heap[i])) break; this.swap(p, i); i = p; } return i; }
  down(i) { while (true) { let c = i * 2 + 1; if (c >= this.heap.length) break; if (c + 1 < this.heap.length && scheduledAt(this.heap[c + 1]) < scheduledAt(this.heap[c])) c++; if (scheduledAt(this.heap[i]) <= scheduledAt(this.heap[c])) break; this.swap(i, c); i = c; } }
  remove(k) {
    const i = this.indices.get(k); if (i === undefined) return;
    const last = this.heap.pop(); this.indices.delete(k);
    if (i < this.heap.length) { this.heap[i] = last; this.indices.set(key(last), i); this.down(this.up(i)); }
  }
  set(p) { this.remove(key(p)); this.heap.push(p); this.indices.set(key(p), this.heap.length - 1); this.up(this.heap.length - 1); }
  due(now) { return this.heap.length > 0 && scheduledAt(this.heap[0]) <= now; }
}

export function validUpkeep(saved, size = 512, now = Number.MAX_SAFE_INTEGER) {
  if (saved === undefined) return true;
  if (!saved || saved.version !== 1 || !Array.isArray(saved.plants) || saved.plants.length > MAX_PLANTS || !Array.isArray(saved.wards) || saved.wards.length > MAX_WARDS || !Array.isArray(saved.salvage) || saved.salvage.length > MAX_SALVAGE) return false;
  for (const [list, type] of [[saved.plants, 'plant'], [saved.wards, 'ward'], [saved.salvage, 'salvage']]) {
    const seen = new Set();
    for (const p of list) {
      if (!position(p, size) || seen.has(key(p))) return false;
      seen.add(key(p));
      if (type === 'plant' && (!Number.isInteger(p.stage) || p.stage < 0 || p.stage > 2 || !time(p.dueAt) || p.checkAt !== undefined && (!time(p.checkAt) || p.checkAt < p.dueAt) || ![undefined, null, 'space', 'unloaded', 'player', 'height'].includes(p.blocked))) return false;
      if (type === 'ward' && (!time(p.chargeSeconds) || p.chargeSeconds > WARD_CAPACITY || !time(p.updatedAt) || p.updatedAt > now || typeof p.enabled !== 'boolean')) return false;
      if (type === 'salvage' && (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40 || !Array.isArray(p.stock) || p.stock.length !== 3 || !Array.from(p.stock).every((n, i) => Number.isInteger(n) && n >= 0 && n <= stockCap[i]) || !time(p.updatedAt) || p.updatedAt > now)) return false;
    }
  }
  return true;
}

export class UpkeepSystem {
  constructor(world, { saved, clock = () => 0, infrastructure, sites = [] } = {}) {
    this.world = world; this.clock = clock; this.infrastructure = infrastructure;
    this.plants = new Map((saved?.plants || []).map(p => [key(p), { ...p }]));
    this.wards = new Map((saved?.wards || []).map(p => [key(p), { ...p }]));
    this.salvage = new Map((saved?.salvage || sites.map(p => ({ ...p, stock: [...stockCap], updatedAt: clock() }))).map(p => [key(p), structuredClone(p)]));
    this.queue = new DueQueue(); for (const p of this.plants.values()) this.queue.set(p);
    this.lastWork = 0;
    // One-time bootstrap for the authored starting ward and earlier worlds.
    if (!saved) {
      const add = p => { if (this.wards.size < MAX_WARDS) this.wards.set(key(p), { ...p, chargeSeconds: WARD_CAPACITY, updatedAt: clock(), enabled: true }); };
      if (world.edits) for (const [chunk, cells] of world.edits) {
        const [cx, cz] = chunk.split(',').map(Number);
        for (const [index, block] of cells) if (block === WARD_LANTERN) add({ x: cx * 16 + index % 16, y: Math.floor(index / 256), z: cz * 16 + Math.floor(index / 16) % 16 });
      } else for (const wards of world.wardChunks?.values() || []) for (const p of wards.values()) add(p);
    }
  }
  wardPower(p) {
    const w = this.wards.get(key(p)), now = this.clock();
    const remainingSeconds = w ? Math.max(0, w.chargeSeconds - (w.enabled ? Math.max(0, now - w.updatedAt) : 0)) : 0;
    return { remainingSeconds, enabled: w?.enabled ?? true, powered: !!w?.enabled && remainingSeconds > 0, low: remainingSeconds <= FUEL_SECONDS, fraction: remainingSeconds / WARD_CAPACITY };
  }
  stock(p) {
    const elapsed = Math.max(0, this.clock() - p.updatedAt), cycles = Math.floor(elapsed / SALVAGE_INTERVAL);
    return { stock: p.stock.map((n, i) => Math.min(stockCap[i], n + cycles * bundle[i])), updatedAt: p.updatedAt + cycles * SALVAGE_INTERVAL };
  }
  snapshot() {
    return { version: 1, plants: [...this.plants.values()].map(p => ({ ...p })),
      wards: [...this.wards.values()].map(w => ({ x: w.x, y: w.y, z: w.z, chargeSeconds: this.wardPower(w).remainingSeconds, updatedAt: this.clock(), enabled: w.enabled })),
      salvage: [...this.salvage.values()].map(p => ({ ...p, ...this.stock(p) })) };
  }
  guard(changes) {
    if (changes.some(c => c.from === SALVAGE_CRATE || c.to === SALVAGE_CRATE)) return { ok: false, reason: 'landmark' };
    const addedPlants = changes.filter(c => isSapling(c.to) && !isSapling(c.from)).length;
    const addedWards = changes.filter(c => c.to === WARD_LANTERN && c.from !== WARD_LANTERN).length;
    if (this.plants.size + addedPlants > MAX_PLANTS || this.wards.size + addedWards > MAX_WARDS) return { ok: false, reason: 'capacity' };
    return { ok: true };
  }
  changed(changes) {
    const now = this.clock();
    for (const c of changes) {
      const k = key(c);
      if (isSapling(c.from)) { this.plants.delete(k); this.queue.remove(k); }
      if (isSapling(c.to)) { const p = { x: c.x, y: c.y, z: c.z, stage: c.to - SAPLING, dueAt: now + GROWTH_STAGE_SECONDS }; this.plants.set(k, p); this.queue.set(p); }
      if (c.from === WARD_LANTERN && c.to !== WARD_LANTERN) this.wards.delete(k);
      if (c.to === WARD_LANTERN && c.from !== WARD_LANTERN) this.wards.set(k, { x: c.x, y: c.y, z: c.z, chargeSeconds: 0, updatedAt: now, enabled: true });
    }
  }
  inspect(p) {
    const k = key(p), w = this.wards.get(k), plant = this.plants.get(k), site = this.salvage.get(k);
    if (w) return { x: w.x, y: w.y, z: w.z, kind: 'ward', ...this.wardPower(w) };
    if (plant) return { ...plant, kind: 'plant', remainingSeconds: Math.max(0, plant.dueAt - this.clock()) };
    if (site) { const state = this.stock(site); return { ...site, ...state, kind: 'salvage', remainingSeconds: Math.max(0, state.updatedAt + SALVAGE_INTERVAL - this.clock()) }; }
    return null;
  }
  command(method, p, inventory, pose) {
    if (!position(p, this.world.size || SIZE)) return { ok: false, reason: 'invalid' };
    if (!inReach(pose, p)) return { ok: false, reason: 'reach' };
    const block = this.world.get(p.x, p.y, p.z), now = this.clock(), k = key(p);
    if (method === 'repair') {
      if (!inventory.count(REPAIR_TOOL)) return { ok: false, reason: 'tool' };
      const base = { x: p.x, y: p.y - Number(doorState(block)?.upper || false), z: p.z }, damaged = this.infrastructure?.damage.get(key(base));
      if (!damaged || damaged.block !== buildBlock(block)) return { ok: false, reason: 'undamaged' };
      const material = buildBlock(block) === CONCRETE ? STONE : SCRAP;
      const plan = inventory.balance(new Map([[material, -1]])); if (!plan.ok) return plan;
      inventory.applyBalance(plan); this.infrastructure.clearDamage(base);
      return { ok: true, type: 'upkeep', damage: { ...base, block: damaged.block, remaining: strength(block) }, message: 'Structure repaired to full strength.' };
    }
    const info = this.inspect(p);
    if (!info || info.kind === 'ward' && block !== WARD_LANTERN || info.kind === 'plant' && !isSapling(block) || info.kind === 'salvage' && block !== SALVAGE_CRATE) return { ok: false, reason: 'changed' };
    if (method === 'inspectUpkeep') return { ok: true, type: 'inspection', info };
    if (method === 'gatherSalvage' && info.kind === 'salvage') {
      const site = this.salvage.get(k), state = this.stock(site);
      if (state.stock.some((n, i) => n < bundle[i])) return { ok: false, reason: 'replenishing', info };
      const plan = inventory.balance(new Map(resources.map((b, i) => [b, bundle[i]]))); if (!plan.ok) return { ...plan, info };
      inventory.applyBalance(plan); site.stock = state.stock.map((n, i) => n - bundle[i]); site.updatedAt = state.updatedAt;
    } else if (method === 'refuelWard' && info.kind === 'ward') {
      if (info.remainingSeconds > WARD_CAPACITY - FUEL_SECONDS + .01) return { ok: false, reason: 'fuel_full', info };
      const plan = inventory.balance(new Map([[BIOFUEL, -1]])); if (!plan.ok) return { ...plan, info };
      inventory.applyBalance(plan); Object.assign(this.wards.get(k), { chargeSeconds: Math.min(WARD_CAPACITY, info.remainingSeconds + FUEL_SECONDS), updatedAt: now });
    } else if (method === 'setWardPower' && info.kind === 'ward' && typeof p.enabled === 'boolean') {
      Object.assign(this.wards.get(k), { chargeSeconds: info.remainingSeconds, updatedAt: now, enabled: p.enabled });
    } else return { ok: false, reason: 'invalid' };
    return { ok: true, type: 'upkeep', info: this.inspect(p) };
  }
  hasDue() { return this.queue.due(this.clock()); }
  step(poses = []) {
    const changes = [], now = this.clock(); this.lastWork = 0;
    while (this.lastWork < GROWTH_BUDGET && this.queue.due(now)) {
      this.lastWork++;
      const p = this.queue.heap[0], k = key(p); this.queue.remove(k);
      const loaded = c => !this.world.chunks || !!this.world.getChunk(Math.floor(c.x / 16), Math.floor(c.z / 16), false);
      const retry = reason => { p.blocked = reason; p.checkAt = now + 10; this.queue.set(p); };
      if (!loaded(p)) { retry('unloaded'); continue; }
      if (!isSapling(this.world.get(p.x, p.y, p.z)) || !isFlowerSoil(this.world.get(p.x, p.y - 1, p.z))) { this.plants.delete(k); continue; }
      const cells = [];
      if (p.stage < 2) cells.push({ x: p.x, y: p.y, z: p.z, to: SAPLING + p.stage + 1 });
      else {
        for (let dy = 0; dy < 4; dy++) cells.push({ x: p.x, y: p.y + dy, z: p.z, to: WOOD });
        for (let dy = 2; dy <= 4; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0 && dy < 4 || dy === 4 && Math.abs(dx) + Math.abs(dz) > 1) continue;
          cells.push({ x: p.x + dx, y: p.y + dy, z: p.z + dz, to: LEAVES });
        }
      }
      let blocked = null;
      for (const c of cells) {
        if (!this.world.contains(c.x, c.y, c.z)) { blocked = 'height'; break; }
        if (!loaded(c)) { blocked = 'unloaded'; break; }
        const old = this.world.get(c.x, c.y, c.z);
        if (key(c) !== k && old !== AIR) { blocked = 'space'; break; }
        if (p.stage === 2 && poses.some(pose => overlapsBlock(pose, c.x, c.y, c.z, c.to))) { blocked = 'player'; break; }
      }
      if (blocked) { retry(blocked); continue; }
      for (const c of cells) { const from = this.world.get(c.x, c.y, c.z); this.world.set(c.x, c.y, c.z, c.to); changes.push({ ...c, from }); }
      if (p.stage < 2) { p.stage++; p.dueAt += GROWTH_STAGE_SECONDS; delete p.checkAt; p.blocked = null; this.queue.set(p); }
      else this.plants.delete(k);
    }
    return changes;
  }
}
