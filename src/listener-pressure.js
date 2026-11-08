import { AIR, BRACED_TIMBER, buildBlock, doorState } from './world.js';
import { loadedBlock, traceBarriers } from './perception.js';
import { strength } from './infrastructure.js';
import { EditHistory } from './history.js';

export const PRESSURE_INTERVAL = 1.1;

// Probe only the short segment immediately in front of the creature. This is
// independent of house size and never scans distant walls or loads chunks.
export class ListenerPressure {
  constructor(world, { shelters, infrastructure, upkeep, onResult = () => {}, canHit = () => true, onHit = () => {} }) {
    this.world = world; this.shelters = shelters; this.onResult = onResult; this.canHit = canHit; this.onHit = onHit;
    this.history = new EditHistory(world, 0); this.history.infrastructure = infrastructure; this.history.upkeep = upkeep; this.history.actorId = 'listener';
    this.key = null; this.nextHitAt = 0; this.activity = 'No barrier selected';
  }
  reset() { this.key = null; }
  diagnostics(now) { return { target: this.key, nextHitSeconds: this.key ? Math.max(0, this.nextHitAt - now) : 0, activity: this.activity }; }
  candidate(entity, target, { read = (x, y, z) => loadedBlock(this.world, x, y, z) } = {}) {
    const length = Math.hypot(target.x - entity.x, target.z - entity.z);
    if (length < .1 || Math.abs(target.y - entity.y) > 1.5) { return null; }
    const range = Math.min(1.7, length); let nearest = null;
    for (const height of [.7, 1.5]) {
      const from = { x: entity.x, y: entity.y + height, z: entity.z };
      const to = { x: entity.x + (target.x - entity.x) / length * range, y: from.y, z: entity.z + (target.z - entity.z) / length * range };
      const trace = traceBarriers(this.world, from, to, { physical: true, first: true, read });
      if (trace.unloaded) return null;
      if (trace.hit && (!nearest || trace.hit.at < nearest.at)) nearest = trace.hit;
    }
    // An exact first hit prevents reaching through grazing glass, fixtures,
    // or a thin swung panel. Ineligible material blocks pressure behind it.
    if (!nearest || !(buildBlock(nearest.block) === BRACED_TIMBER || doorState(nearest.block)?.open === false)) return null;
    const candidate = { x: nearest.x, y: nearest.y - Number(doorState(nearest.block)?.upper || false), z: nearest.z };
    // Protect both sides of a boundary. Unknown enclosure waits for the normal
    // bounded shelter worker instead of risking a hole in a powered refuge.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const state = this.shelters?.status({ x: candidate.x + .5 + dx, y: entity.y, z: candidate.z + .5 + dz })?.state;
      if (state === 'protected' || state === 'checking') { return null; }
    }
    const block = read(candidate.x, candidate.y, candidate.z);
    if (block === undefined) return null;
    const remaining = (p, block) => this.history.infrastructure.damage.get(`${p.x},${p.y},${p.z}`)?.remaining || strength(block);
    let hits = remaining(candidate, block);
    if (buildBlock(block) === BRACED_TIMBER) {
      const otherY = Math.floor(entity.y + 1.5), upper = { ...candidate, y: otherY };
      if (otherY !== candidate.y) {
        const upperBlock = read(upper.x, upper.y, upper.z);
        if (upperBlock === undefined) return null;
        if (upperBlock === BRACED_TIMBER) hits += remaining(upper, upperBlock);
      }
    }
    return { ...candidate, hits };
  }
  advance(entity, target, now) {
    const candidate = this.candidate(entity, target);
    if (!candidate) { this.reset(); this.activity = 'No reachable, unprotected breakable barrier'; return false; }
    const key = `${candidate.x},${candidate.y},${candidate.z}`;
    if (this.key !== key) { this.key = key; this.nextHitAt = now + PRESSURE_INTERVAL; }
    this.activity = this.canHit() ? 'Winding up a strike' : 'Director breach allowance unavailable';
    if (now >= this.nextHitAt && this.canHit()) {
      this.nextHitAt = now + PRESSURE_INTERVAL;
      this.history.attackTime = now;
      const result = this.history.edit(candidate.x, candidate.y, candidate.z, AIR);
      if (result.ok) { this.activity = result.changes ? 'Barrier broken' : 'Struck barrier'; this.onHit(); this.onResult(result); if (result.changes) this.reset(); }
      else this.activity = `Strike blocked: ${result.reason}`;
    }
    return true;
  }
}
