import { WARD_LANTERN, LEAVES, HEIGHT, SIZE, EYE_HEIGHT, isSolid, isLantern, isSlab, isSupport, doorState } from './world.js';

export const SHELTER_SECTION_HEIGHT = 4;
export const SHELTER_WORK_BUDGET = 4096;
export const SHELTER_TIME_BUDGET_MS = 2;
export const MAX_CACHED_SECTIONS = 512;
export const MAX_CACHED_ZONES = 64;
export const MAX_ZONE_COMPONENTS = 8192;
export const WARD_VIEW_RANGE = 12;
export const MAX_VISIBLE_WARDS = 16;
const SECTION_CELLS = 16 * 16 * SHELTER_SECTION_HEIGHT;
const neighbors = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const sectionKey = (x, y, z) => `${Math.floor(x / 16)},${Math.floor(y / SHELTER_SECTION_HEIGHT)},${Math.floor(z / 16)}`;
const localIndex = (x, y, z) => x % 16 + 16 * (z % 16 + 16 * (y % SHELTER_SECTION_HEIGHT));
const pending = reason => ({ enclosed: false, reason, wards: [] });

export function sealsShelter(block) {
  const door = doorState(block);
  return door ? !door.open : isSolid(block) && block !== LEAVES && !isSlab(block) && !isLantern(block);
}

// Label small sections once, then search their connectivity graph rather than
// flooding every voxel of a house. All searches share one bounded work queue.
// Queries only request work; they never spend another per-player work budget.
export class ShelterSystem {
  constructor(world, { workBudget = SHELTER_WORK_BUDGET, timeBudgetMs = SHELTER_TIME_BUDGET_MS, maxSections = MAX_CACHED_SECTIONS, wardPower = () => ({ powered: true }) } = {}) {
    this.world = world; this.wardPower = wardPower; this.workBudget = workBudget; this.timeBudgetMs = timeBudgetMs; this.maxSections = maxSections;
    this.elapsed = 0; this.totalWork = 0; this.sectionBuilds = 0; this.lastWork = 0;
    this.invalidate();
  }

  invalidate() {
    this.stamp = -1; this.epoch = this.world.shelterRevisions;
    this.sections = new Map(); this.sectionQueue = [];
    this.zones = new Set(); this.zoneById = new Map(); this.nextZoneId = 0;
    this.componentZones = new Map(); this.requests = new Map(); this.zoneQueue = []; this.activeZone = null;
  }

  discard(zone) {
    zone.valid = false; this.zones.delete(zone); this.zoneById.delete(zone.id);
    if (this.requests.get(zone.ref) === zone) this.requests.delete(zone.ref);
    zone.seen.clear(); zone.dependencies.clear(); zone.queue = []; zone.finishing = null;
  }

  cachedZone(ref) { return this.zoneById.get(this.componentZones.get(ref)); }

  dropEntry(entry) {
    entry.valid = false; entry.labels = null; entry.blocks = null; entry.components = []; entry.queue = [];
    this.sections.delete(entry.key);
  }

  loaded(key) {
    if (!this.world.chunks) return true;
    const [cx, , cz] = key.split(',').map(Number);
    return this.world.chunks.has(`${cx},${cz}`);
  }

  revision(key) { return `${this.world.shelterRevisions?.get(key) || 0}:${this.loaded(key)}`; }

  sync() {
    if (this.epoch !== this.world.shelterRevisions) this.invalidate();
    if (this.stamp === this.world.serial) return;
    this.stamp = this.world.serial;
    for (const [key, entry] of this.sections) if (entry.revision !== this.revision(key)) {
      this.dropEntry(entry);
    }
    // Include solid sections examined at the boundary, not just air sections:
    // carving an opening into a previously solid neighbor must revoke safety.
    for (const zone of this.zones) if (zone.valid) {
      for (const [key, revision] of zone.dependencies) if (revision !== this.revision(key)) { this.discard(zone); break; }
    }
  }

  read(x, y, z) {
    if (!this.world.contains(x, y, z)) return null;
    if (this.world.chunks && !this.world.getChunk(Math.floor(x / 16), Math.floor(z / 16), false)) return undefined;
    return this.world.get(x, y, z);
  }

  // A vertical opening is a cheap, exact outdoor proof. It prevents enormous
  // outdoor regions from ever becoming whole-world searches.
  openSky(x, y, z, dependencies) {
    for (let h = y; h < HEIGHT; h++) {
      const key = sectionKey(x, h, z);
      if (dependencies) dependencies.set(key, this.revision(key));
      const block = this.read(x, h, z);
      if (block === undefined || block === null || sealsShelter(block)) return false;
    }
    return true;
  }

  entry(key) {
    if (this.sections.has(key)) {
      const entry = this.sections.get(key);
      this.sections.delete(key); this.sections.set(key, entry); return entry;
    }
    if (!this.loaded(key)) return null;
    if (this.sections.size >= this.maxSections) {
      // Do not evict an unfinished search's own working set and restart it
      // endlessly. Resource pressure leaves the result unknown, never exposed.
      const victim = [...this.sections].find(([id]) => !this.activeZone?.dependencies.has(id));
      if (!victim) return null;
      const [id, entry] = victim; this.dropEntry(entry);
      for (const zone of this.zones) if (zone.dependencies.has(id)) this.discard(zone);
    }
    const [cx, sy, cz] = key.split(',').map(Number);
    const entry = { key, x: cx * 16, y: sy * SHELTER_SECTION_HEIGHT, z: cz * 16, revision: this.revision(key), valid: true,
      phase: 'read', cursor: 0, labels: new Int16Array(SECTION_CELLS), blocks: new Uint8Array(SECTION_CELLS),
      components: [null], queue: [], head: 0, current: null };
    this.sections.set(key, entry); this.sectionQueue.push(entry);
    if (this.sectionQueue.length > this.maxSections * 2) this.sectionQueue = this.sectionQueue.filter(task => task.valid && task.phase !== 'ready');
    return entry;
  }

  coordinates(entry, i) { return [entry.x + i % 16, entry.y + Math.floor(i / 256), entry.z + Math.floor(i / 16) % 16]; }

  sectionStep(entry) {
    if (entry.phase === 'read') {
      const i = entry.cursor++, [x, y, z] = this.coordinates(entry, i), block = this.read(x, y, z);
      entry.blocks[i] = block ?? 0; entry.labels[i] = block === null || sealsShelter(block) ? -1 : 0;
      if (entry.cursor === SECTION_CELLS) { entry.cursor = 0; entry.phase = 'label'; }
      return;
    }
    if (entry.head < entry.queue.length) {
      const i = entry.queue[entry.head++], [x, y, z] = this.coordinates(entry, i), component = entry.current;
      if (entry.blocks[i] === WARD_LANTERN) component.wards.push({ x, y, z });
      for (const [dx, dy, dz] of neighbors) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (!this.world.contains(nx, ny, nz)) { component.open = true; continue; }
        if (nx < entry.x || nx >= entry.x + 16 || ny < entry.y || ny >= entry.y + SHELTER_SECTION_HEIGHT || nz < entry.z || nz >= entry.z + 16) {
          const size = this.world.size || SIZE;
          component.portals.push(nx + size * (nz + size * ny)); continue;
        }
        const next = localIndex(nx, ny, nz);
        if (entry.labels[next] === 0) { entry.labels[next] = component.id; entry.queue.push(next); }
      }
      return;
    }
    if (entry.cursor === SECTION_CELLS) {
      entry.phase = 'ready'; entry.queue = []; entry.blocks = null; this.sectionBuilds++; return;
    }
    const i = entry.cursor++;
    if (entry.labels[i] === 0) {
      const component = { id: entry.components.length, portals: [], wards: [], open: false, seed: this.coordinates(entry, i) };
      entry.components.push(component); entry.current = component; entry.queue = [i]; entry.head = 0; entry.labels[i] = component.id;
    }
  }

  request(entry, id) {
    const ref = `${entry.key}/${id}`, cached = this.cachedZone(ref);
    if (cached?.valid) { this.zones.delete(cached); this.zones.add(cached); return cached; }
    if (this.activeZone?.valid && this.activeZone.seen.has(ref)) return this.activeZone;
    const existing = this.requests.get(ref);
    if (existing?.valid) return existing;
    if (this.zones.size >= MAX_CACHED_ZONES) {
      const victim = [...this.zones].find(zone => zone !== this.activeZone);
      if (victim) this.discard(victim);
    }
    const zone = { id: ++this.nextZoneId, ref, valid: true, done: false, reason: 'calculating', dependencies: new Map(), seen: new Set([ref]),
      queue: [{ entry, id }], head: 0, edge: -1, wards: [] };
    this.requests.set(ref, zone); this.zoneQueue.push(zone); this.zones.add(zone); this.zoneById.set(zone.id, zone);
    if (this.zoneQueue.length > MAX_CACHED_ZONES * 2) this.zoneQueue = this.zoneQueue.filter(job => job.valid && !job.done);
    return zone;
  }

  finish(zone, reason = null) {
    zone.reason = reason; zone.finishing = zone.seen.values();
    // Bound stale reference storage independently of cache invalidation.
    if (this.componentZones.size > 32768) this.componentZones.clear();
    zone.queue = [];
  }

  zoneStep(zone) {
    if (zone.finishing) {
      const next = zone.finishing.next();
      if (next.done) { zone.done = true; this.activeZone = null; }
      else this.componentZones.set(next.value, zone.id);
      return true;
    }
    if (zone.head === zone.queue.length) { this.finish(zone); return true; }
    const { entry, id } = zone.queue[zone.head], component = entry.components[id];
    zone.dependencies.set(entry.key, entry.revision);
    if (zone.edge === -1) {
      if (!entry.valid) { this.discard(zone); return true; }
      if (component.open || this.openSky(...component.seed, zone.dependencies)) { this.finish(zone, 'open'); return true; }
      zone.wardCursor = 0; zone.edge = -2; return true;
    }
    if (zone.edge === -2) {
      if (zone.wards.length || zone.wardCursor === component.wards.length) zone.edge = 0;
      else {
        const ward = component.wards[zone.wardCursor++];
        if (isSupport(this.read(ward.x, ward.y - 1, ward.z) ?? 0)) zone.wards.push(ward);
      }
      return true;
    }
    if (zone.edge === component.portals.length) { zone.head++; zone.edge = -1; return true; }
    const point = component.portals[zone.edge], size = this.world.size || SIZE;
    const x = point % size, y = Math.floor(point / (size * size)), z = Math.floor(point / size) % size;
    const key = sectionKey(x, y, z);
    zone.dependencies.set(key, this.revision(key));
    if (!this.loaded(key)) { this.finish(zone, 'unloaded'); return true; }
    const other = this.entry(key);
    if (!other) { this.finish(zone, 'capacity'); return true; }
    if (other.phase !== 'ready') return false;
    zone.edge++;
    const label = other.labels[localIndex(x, y, z)];
    if (label > 0) {
      const ref = `${key}/${label}`;
      if (!zone.seen.has(ref)) {
        if (zone.seen.size >= MAX_ZONE_COMPONENTS) { this.finish(zone, 'capacity'); return true; }
        zone.seen.add(ref); zone.queue.push({ entry: other, id: label });
      }
    }
    return true;
  }

  update() {
    this.sync(); this.lastWork = 0;
    const deadline = performance.now() + this.timeBudgetMs;
    while (this.lastWork < this.workBudget) {
      if ((this.lastWork & 15) === 0 && performance.now() >= deadline) break;
      if (!this.activeZone?.valid || this.activeZone.done) this.activeZone = null;
      if (!this.activeZone) {
        while (this.zoneQueue.length && !this.activeZone) {
          const zone = this.zoneQueue.shift();
          const cached = this.cachedZone(zone.ref);
          if (zone.valid && !zone.done && !(cached?.valid && cached.done)) this.activeZone = zone;
          else this.discard(zone);
        }
      }
      let worked = false;
      if (this.activeZone) worked = this.zoneStep(this.activeZone);
      if (!worked) {
        while (this.sectionQueue.length && (!this.sectionQueue[0].valid || this.sectionQueue[0].phase === 'ready')) this.sectionQueue.shift();
        if (!this.sectionQueue.length) break;
        this.sectionStep(this.sectionQueue[0]); worked = true;
      }
      if (worked) this.lastWork++;
    }
    this.totalWork += this.lastWork;
    return this.lastWork;
  }

  advance(seconds) {
    this.elapsed += seconds;
    if (this.elapsed < .1) return false;
    this.elapsed %= .1; this.update(); return true;
  }

  roomAt(position) {
    this.sync();
    const point = [Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)], block = this.read(...point);
    if (block === undefined) return pending('unloaded');
    if (block === null) return pending('open');
    if (sealsShelter(block)) return pending('blocked');
    if (this.openSky(...point)) return pending('open');
    const entry = this.entry(sectionKey(...point));
    if (!entry) return pending('capacity');
    if (entry.phase !== 'ready') return pending('calculating');
    const id = entry.labels[localIndex(...point)];
    if (id <= 0) return pending('blocked');
    const zone = this.request(entry, id);
    return { enclosed: zone.done && zone.reason === null, reason: zone.done ? zone.reason : 'calculating', wards: zone.wards, zone };
  }

  status(pose) {
    const room = this.roomAt({ x: pose.x, y: pose.y + .1, z: pose.z });
    if (!room.enclosed) return { state: ['calculating', 'unloaded', 'capacity'].includes(room.reason) ? 'checking' : 'exposed', reason: room.reason, ward: null };
    const head = [Math.floor(pose.x), Math.floor(pose.y + EYE_HEIGHT), Math.floor(pose.z)], block = this.read(...head);
    if (block === undefined) return { state: 'checking', reason: 'unloaded', ward: null };
    const entry = this.sections.get(sectionKey(...head)), id = entry?.labels[localIndex(...head)];
    if (block === null || sealsShelter(block) || !room.zone.seen.has(`${entry?.key}/${id}`)) return { state: 'exposed', reason: 'blocked', ward: null };
    const ward = room.wards.find(ward => this.wardPower(ward).powered) || null;
    return { state: ward ? 'protected' : 'sheltered', reason: ward ? null : room.wards.length ? 'no_power' : 'no_ward', ward, power: ward ? this.wardPower(ward) : null };
  }

  nearbyWards(pose) {
    const wards = [], cx = Math.floor(pose.x / 16), cz = Math.floor(pose.z / 16);
    let candidates = 0;
    // Rendering is bounded too; a pathological field of wards cannot turn each
    // HUD update into an unbounded sort. This never limits zone protection.
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const ward of this.world.wardChunks?.get(`${cx + dx},${cz + dz}`)?.values() || []) {
        if (++candidates > 512) return wards;
        const distance = Math.hypot(ward.x + .5 - pose.x, ward.y - pose.y, ward.z + .5 - pose.z);
        if (distance > WARD_VIEW_RANGE) continue;
        const index = wards.findIndex(other => distance < other.distance);
        wards.splice(index < 0 ? wards.length : index, 0, { ...ward, distance });
        if (wards.length > MAX_VISIBLE_WARDS) wards.pop();
      }
    }
    return wards;
  }

  snapshot(pose) {
    const status = this.status(pose);
    const wards = this.nearbyWards(pose).map(({ distance, ...ward }) => {
      const room = this.roomAt(ward), supported = isSupport(this.read(ward.x, ward.y - 1, ward.z) ?? 0);
      const power = this.wardPower(ward);
      return { ...ward, ...power, active: room.enclosed && supported && power.powered, reason: room.reason || (!supported ? 'support' : !power.powered ? 'no_power' : null) };
    });
    return { ...status, wards };
  }
}
