import { HEIGHT, LEAVES, WATER, isSolid, isSupport, isSlab, blockBounds, overlapsBlock } from './world.js';
import { loadedBlock, traceBarriers } from './perception.js';

export const RESCUE_SECONDS = 3;
export const RESCUE_REACH = 2.5;
export const RECOVERY_SECONDS = 30;
export const SOLO_RECOVERY_SECONDS = 8;
export const RECOVERY_GRACE = 20;
export const RECOVERY_RETRY_SECONDS = 1;
export const DOWNED_EYE_HEIGHT = .65;
const position = p => ({ x: p.x, y: p.y, z: p.z });
const time = n => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const validPoint = (p, size) => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k])) && p.x >= 0 && p.z >= 0 && p.x < size && p.z < size && p.y >= 0 && p.y < HEIGHT;

export function validEncounters(saved, size = 512) {
  if (saved === undefined) return true;
  if (!saved || saved.version !== 1 || !Array.isArray(saved.players) || saved.players.length > 10000) return false;
  const keys = new Set();
  return saved.players.every(r => {
    if (!r || typeof r.key !== 'string' || !/^[\w-]{1,80}$/.test(r.key) || keys.has(r.key) || !['ready', 'downed'].includes(r.state)
      || ![r.recoveryAt, r.immuneUntil].every(time) || !Number.isSafeInteger(r.revision) || r.revision < 1 || !validPoint(r.position, size)) return false;
    keys.add(r.key); return true;
  });
}

export function clearBody(world, pose, { allowWater = false } = {}) {
  for (let x = Math.floor(pose.x - .3); x <= Math.floor(pose.x + .3); x++) for (let z = Math.floor(pose.z - .3); z <= Math.floor(pose.z + .3); z++) for (let y = Math.floor(pose.y); y <= Math.floor(pose.y + 1.75); y++) {
    const block = loadedBlock(world, x, y, z);
    if (block === undefined || !allowWater && block === WATER || isSolid(block) && overlapsBlock(pose, x, y, z, block)) return false;
  }
  return true;
}

// Shared by the host's rescue validation and the client's help prompt. Solid
// foliage and fixtures can transmit sound without allowing physical help.
export function rescueInReach(world, from, to) {
  if (Math.hypot(from.x - to.x, from.z - to.z) > RESCUE_REACH || Math.abs(from.y - to.y) > 1.5) return false;
  const trace = traceBarriers(world, { ...from, y: from.y + .8 }, { ...to, y: to.y + .8 }, { physical: true });
  return !trace.unloaded && !trace.barriers;
}

// Recovery is rare: load at most four starter chunks, then search a bounded
// nine-by-nine patch for supported clearance. Never remove a player's build.
export function recoveryPoint(world, horror, occupied = []) {
  const cx = horror?.cabin ? horror.cabin.x + 3 : Math.floor((world.size || 64) / 2);
  const cz = horror?.cabin ? horror.cabin.z + 3 : Math.floor((world.size || 64) / 2);
  const preferredY = horror?.cabin ? horror.cabin.y + 1 : 1;
  for (let radius = 0; radius <= 4; radius++) for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
    const x = cx + dx, z = cz + dz;
    world.getChunk?.(Math.floor(x / 16), Math.floor(z / 16), true);
    for (let offset = 0; offset < HEIGHT - 2; offset++) {
      const feet = 1 + (preferredY - 1 + offset) % (HEIGHT - 2), support = loadedBlock(world, x, feet - 1, z);
      if (support === undefined || support === LEAVES || !(isSupport(support) || isSlab(support))) continue;
      const p = { x: x + .5, y: blockBounds(support, x, feet - 1, z).maxY + .01, z: z + .5 };
      if (clearBody(world, p)
        && !occupied.some(other => Math.hypot(other.x - p.x, other.z - p.z) < .8 && Math.abs(other.y - p.y) < 1.75)) return p;
    }
  }
  return null; // The encounter system can recover in place if this patch is blocked.
}

// Persistent keys are local identity / profile tokens; public IDs stay ephemeral.
// Supplies are untouched. Recovery and rescue use occupied simulation time.
export class EncounterSystem {
  constructor(world, { clock, saved, recover = () => null } = {}) {
    this.world = world; this.clock = clock; this.recover = recover;
    this.records = new Map((saved?.players || []).map(r => [r.key, structuredClone(r)]));
    this.rescues = new Map(); this.recoveryRetries = new Map(); this.dirty = false;
  }
  snapshot() { return { version: 1, players: structuredClone([...this.records.values()]) }; }
  record(player) { return this.records.get(player.key || player.id); }
  downed(player) { return this.record(player)?.state === 'downed'; }
  vulnerable(player) { return !this.downed(player) && (this.record(player)?.immuneUntil || 0) <= this.clock(); }
  publicState(player) {
    const r = this.record(player), now = this.clock();
    let progress = 0;
    for (const rescue of this.rescues.values()) if (rescue.target === player.id && now - rescue.at <= .5) progress = Math.max(progress, rescue.progress / RESCUE_SECONDS);
    return r ? { state: r.state, recoveryAt: r.recoveryAt, immuneUntil: r.immuneUntil, revision: r.revision, position: { ...r.position }, rescueProgress: progress }
      : { state: 'ready', recoveryAt: 0, immuneUntil: 0, revision: 0, rescueProgress: 0 };
  }
  knockDown(player, players) {
    if (!this.vulnerable(player)) return false;
    const now = this.clock(), key = player.key || player.id;
    this.records.set(key, { key, state: 'downed', recoveryAt: now + (players.some(p => p.id !== player.id && !this.downed(p)) ? RECOVERY_SECONDS : SOLO_RECOVERY_SECONDS),
      immuneUntil: 0, revision: (this.record(player)?.revision || 0) + 1, position: position(player.pose) });
    player.pose.active = false;
    this.rescues.delete(player.id); this.recoveryRetries.delete(player.id); this.dirty = true; return true;
  }
  standUp(player, destination) {
    const r = this.record(player); if (!r || r.state !== 'downed' || !destination) return false;
    Object.assign(r, { state: 'ready', recoveryAt: 0, immuneUntil: this.clock() + RECOVERY_GRACE, revision: r.revision + 1, position: position(destination) });
    Object.assign(player.pose, destination, { active: false });
    this.recoveryRetries.delete(player.id);
    for (const [id, rescue] of this.rescues) if (rescue.target === player.id) this.rescues.delete(id);
    this.dirty = true; return true;
  }
  canRescue(actor, target) {
    if (!actor || !target || actor.id === target.id || this.downed(actor) || !this.downed(target) || !actor.pose.active) return false;
    return rescueInReach(this.world, actor.pose, target.pose);
  }
  rescue(actor, target) {
    const now = this.clock();
    if (!this.canRescue(actor, target)) { this.rescues.delete(actor.id); return { ok: false, reason: 'rescue_unavailable' }; }
    const previous = this.rescues.get(actor.id);
    const progress = previous?.target === target.id && now - previous.at <= .5 ? previous.progress + Math.min(.3, Math.max(0, now - previous.at)) : 0;
    this.rescues.set(actor.id, { target: target.id, at: now, progress });
    if (progress >= RESCUE_SECONDS && clearBody(this.world, target.pose, { allowWater: true })) this.standUp(target, target.pose);
    return { ok: true, type: 'players' };
  }
  forget(id) {
    this.rescues.delete(id); this.recoveryRetries.delete(id);
    for (const [actor, rescue] of this.rescues) if (rescue.target === id) this.rescues.delete(actor);
  }
  advance(players) {
    const now = this.clock(), byId = new Map(players.map(p => [p.id, p]));
    for (const id of this.recoveryRetries.keys()) if (!byId.has(id)) this.recoveryRetries.delete(id);
    for (const [actor, rescue] of this.rescues) if (now - rescue.at > .5 || !this.canRescue(byId.get(actor), byId.get(rescue.target))) this.rescues.delete(actor);
    for (const player of players) {
      const r = this.record(player); if (r?.state !== 'downed') continue;
      Object.assign(player.pose, r.position, { active: false });
      if (!players.some(p => p.id !== player.id && !this.downed(p)) && r.recoveryAt > now + SOLO_RECOVERY_SECONDS) { r.recoveryAt = now + SOLO_RECOVERY_SECONDS; this.dirty = true; }
      if (now >= r.recoveryAt && now >= (this.recoveryRetries.get(player.id) || 0)) {
        // A fully obstructed/unknown return patch is not a per-frame task.
        // Keep dry outpost placement first, but water alone must not prevent
        // recovery in place: players need to be able to stand and swim clear.
        this.recoveryRetries.set(player.id, now + RECOVERY_RETRY_SECONDS);
        const destination = this.recover(player) || (clearBody(this.world, player.pose, { allowWater: true }) ? player.pose : null);
        this.standUp(player, destination);
      }
    }
  }
}
