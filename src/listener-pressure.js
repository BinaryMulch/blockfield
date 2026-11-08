import { AIR, REINFORCED_PANEL, buildBlock, doorState, isSolid, blockBounds } from './world.js';
import { loadedBlock } from './perception.js';
import { strength } from './infrastructure.js';
import { EditHistory } from './history.js';

export const PRESSURE_INTERVAL = 3;

// Probe only the short segment immediately in front of the creature. This is
// independent of house size and never scans distant walls or loads chunks.
export class ListenerPressure {
  constructor(world, { shelters, infrastructure, upkeep, onResult = () => {}, canHit = () => true, onHit = () => {} }) {
    this.world = world; this.shelters = shelters; this.onResult = onResult; this.canHit = canHit; this.onHit = onHit;
    this.history = new EditHistory(world, 0); this.history.infrastructure = infrastructure; this.history.upkeep = upkeep; this.history.actorId = 'listener';
    this.key = null; this.nextHitAt = 0;
  }
  reset() { this.key = null; }
  candidate(entity, target) {
    const length = Math.hypot(target.x - entity.x, target.z - entity.z);
    if (length < .1 || Math.abs(target.y - entity.y) > 1.5) { return null; }
    let candidate;
    probe: for (let step = .2; step <= Math.min(1.7, length); step += .15) {
      const x = Math.floor(entity.x + (target.x - entity.x) / length * step), z = Math.floor(entity.z + (target.z - entity.z) / length * step);
      for (const height of [.7, 1.5]) {
        const py = entity.y + height, y = Math.floor(py), block = loadedBlock(this.world, x, y, z);
        if (block === undefined) break probe;
        if (!isSolid(block)) continue;
        const b = blockBounds(block, x, y, z), px = entity.x + (target.x - entity.x) / length * step, pz = entity.z + (target.z - entity.z) / length * step;
        // Open doors swung beside the route do not attract pressure.
        if (px < b.minX || px > b.maxX || pz < b.minZ || pz > b.maxZ || py < b.minY || py > b.maxY) continue;
        if (buildBlock(block) === REINFORCED_PANEL || doorState(block)?.open === false) candidate = { x, y: y - Number(doorState(block)?.upper || false), z };
        break probe;
      }
    }
    if (!candidate) { return null; }
    // Protect both sides of a boundary. Unknown enclosure waits for the normal
    // bounded shelter worker instead of risking a hole in a powered refuge.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const state = this.shelters?.status({ x: candidate.x + .5 + dx, y: entity.y, z: candidate.z + .5 + dz })?.state;
      if (state === 'protected' || state === 'checking') { return null; }
    }
    const block = this.world.get(candidate.x, candidate.y, candidate.z);
    const remaining = p => this.history.infrastructure.damage.get(`${p.x},${p.y},${p.z}`)?.remaining || strength(this.world.get(p.x, p.y, p.z));
    let hits = remaining(candidate);
    if (buildBlock(block) === REINFORCED_PANEL) {
      const otherY = Math.floor(entity.y + 1.5), upper = { ...candidate, y: otherY };
      if (otherY !== candidate.y && loadedBlock(this.world, upper.x, upper.y, upper.z) === REINFORCED_PANEL) hits += remaining(upper);
    }
    return { ...candidate, hits };
  }
  advance(entity, target, now) {
    const candidate = this.candidate(entity, target);
    if (!candidate) { this.reset(); return false; }
    const key = `${candidate.x},${candidate.y},${candidate.z}`;
    if (this.key !== key) { this.key = key; this.nextHitAt = now + PRESSURE_INTERVAL; }
    if (now >= this.nextHitAt && this.canHit()) {
      this.nextHitAt = now + PRESSURE_INTERVAL;
      this.history.attackTime = now;
      const result = this.history.edit(candidate.x, candidate.y, candidate.z, AIR);
      if (result.ok) { this.onHit(); this.onResult(result); if (result.changes) this.reset(); }
    }
    return true;
  }
}
