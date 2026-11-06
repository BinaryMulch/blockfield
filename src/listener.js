import { HEIGHT, SIZE, WATER, LEAVES, EYE_HEIGHT, isSolid, isSupport, blockBounds, doorState } from './world.js';
import { loadedBlock, traceBarriers } from './perception.js';

export const LISTENER_INTERVAL = .2;
export const MAX_NOISE_EVENTS = 32;
export const NAV_NODE_BUDGET = 96;
export const NAV_READ_BUDGET = 4096;
export const LISTENER_GRACE = 90;
const states = ['dormant', 'investigate', 'stalk', 'retreat'];
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const finiteTime = n => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const point = (p, size) => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k])) && p.x >= 0 && p.z >= 0 && p.x < size && p.z < size && p.y >= 0 && p.y < HEIGHT;
const copyPoint = p => ({ x: p.x, y: p.y, z: p.z });

export function validListener(value, size = 512) {
  if (value === undefined) return true;
  return !!value && value.version === 1 && states.includes(value.state) && point(value, size) && Number.isFinite(value.yaw)
    && [value.interestUntil, value.encounterUntil, value.stateUntil, value.cooldownUntil, value.lastCueAt].every(finiteTime)
    && [value.cueSeq, value.stepSeq].every(n => Number.isSafeInteger(n) && n >= 0)
    && ['alert', 'breath', 'retreat'].includes(value.cueKind)
    && [value.target, value.home].every(p => p === null || point(p, size));
}

export class ListenerSystem {
  constructor(world, { clock = () => ({ elapsedSeconds: 0, phase: .18 }), shelters, saved } = {}) {
    this.world = world; this.clock = clock; this.shelters = shelters;
    const center = Math.min((world.size || SIZE) - .5, (world.size || SIZE) / 2 + .5);
    this.entity = saved ? structuredClone(saved) : { version: 1, state: 'dormant', x: center, y: 1, z: center, yaw: 0, target: null, home: null,
      interestUntil: 0, encounterUntil: 0, stateUntil: 0, cooldownUntil: 0, lastCueAt: 0, cueSeq: 0, stepSeq: 0, cueKind: 'alert' };
    this.noises = []; this.motion = new Map(); this.actionTimes = new Map(); this.elapsed = 0; this.path = []; this.pathAt = 0; this.stride = 0;
    this.lastNodes = 0; this.lastReads = 0;
  }
  snapshot() { return structuredClone(this.entity); }
  publicState() {
    const e = this.entity, now = this.clock().elapsedSeconds;
    return { state: e.state, x: e.x, y: e.y, z: e.z, yaw: e.yaw, cueSeq: e.cueSeq, cueKind: e.cueKind, stepSeq: e.stepSeq,
      alpha: e.state === 'retreat' ? Math.min(1, Math.max(0, (e.stateUntil - now) / 2)) : 1 };
  }
  forget(id) { this.motion.delete(id); this.actionTimes.delete(id); }
  noise(position, radius, source = 'world') {
    const now = this.clock().elapsedSeconds;
    if (!point(position, this.world.size || SIZE) || !Number.isFinite(radius) || radius <= 0) return;
    this.noises.push({ ...copyPoint(position), radius: Math.min(32, radius), source, at: now });
    if (this.noises.length > MAX_NOISE_EVENTS) this.noises.shift();
  }
  action(id, method, args, result, pose) {
    if (!result?.ok) return;
    const radius = method === 'edit' ? args.block === 0 ? 32 : 26 : method.startsWith('place') ? 26 : method === 'toggleDoor' ? 16
      : method === 'repair' ? 24 : method === 'gatherSalvage' ? 22 : method === 'craft' ? 12 : method === 'refuelWard' ? 8 : 0;
    if (!radius) return;
    const now = this.clock().elapsedSeconds;
    if (now - (this.actionTimes.get(id) ?? -Infinity) < .4) return;
    this.actionTimes.set(id, now);
    const p = Number.isInteger(args.x) ? { x: args.x + .5, y: args.y + .5, z: args.z + .5 } : pose;
    this.noise(p, radius, id);
  }
  observe(players, now) {
    const ids = new Set();
    for (const { id, pose } of players) {
      ids.add(id); const previous = this.motion.get(id);
      const current = { ...copyPoint(pose), at: now, distance: previous?.distance || 0 };
      if (previous && pose.active) {
        const dt = now - previous.at, moved = distance(previous, pose);
        if (dt > 0 && moved <= dt * 12 + .2 && Math.abs(pose.y - previous.y) < 1.25) {
          const block = loadedBlock(this.world, Math.floor(pose.x), Math.floor(pose.y - .05), Math.floor(pose.z));
          const fluid = loadedBlock(this.world, Math.floor(pose.x), Math.floor(pose.y + .1), Math.floor(pose.z)) === WATER;
          if (fluid || block !== undefined && isSupport(block) && Math.abs(blockBounds(block, 0, Math.floor(pose.y - .05), 0).maxY - pose.y) < .22) {
            current.distance += moved;
            if (current.distance >= 1.7) { current.distance %= 1.7; this.noise(pose, fluid ? 14 : moved / dt > 5.2 ? 22 : 8, id); }
          }
        } else current.distance = 0;
      } else current.distance = 0;
      this.motion.set(id, current);
    }
    for (const id of this.motion.keys()) if (!ids.has(id)) this.forget(id);
  }
  cue(kind, now) { const e = this.entity; e.cueKind = kind; e.cueSeq++; e.lastCueAt = now; }
  setState(state, now) {
    const e = this.entity; if (state === e.state) return;
    e.state = state; this.path = []; this.pathAt = 0;
    if (state === 'retreat') { e.stateUntil = now + 8; this.cue('retreat', now); }
    if (state === 'stalk') this.cue('breath', now);
    if (state === 'dormant') { e.cooldownUntil = now + 45; e.target = null; }
  }
  read(x, y, z) { if (this.lastReads >= NAV_READ_BUDGET) return undefined; this.lastReads++; return loadedBlock(this.world, x, y, z); }
  fits(x, y, z) {
    for (let bx = Math.floor(x - .26); bx <= Math.floor(x + .26); bx++) for (let bz = Math.floor(z - .26); bz <= Math.floor(z + .26); bz++) for (let by = Math.floor(y); by <= Math.floor(y + 2.35); by++) {
      const block = this.read(bx, by, bz); if (block === undefined || doorState(block)?.open === false) return false;
      if (!isSolid(block)) continue;
      const b = blockBounds(block, bx, by, bz);
      if (x + .26 > b.minX && x - .26 < b.maxX && z + .26 > b.minZ && z - .26 < b.maxZ && y + 2.35 > b.minY && y < b.maxY) return false;
    }
    return true;
  }
  ground(x, z, reference) {
    const base = Math.floor(reference);
    for (const feet of [base, base + 1, base - 1]) {
      const support = this.read(Math.floor(x), feet - 1, Math.floor(z));
      if (support !== undefined && support !== LEAVES && isSupport(support) && this.fits(x, feet + .01, z)) return { x, y: feet + .01, z };
    }
    return null;
  }
  protection(p) { const status = this.shelters?.status(p); return status?.state === 'protected' || status?.state === 'checking'; }
  spawn(noise, players, now) {
    if (noise.radius < 18) return false;
    for (let i = 0; i < 12 && this.lastReads < NAV_READ_BUDGET; i++) {
      const angle = (i / 12 + this.entity.cueSeq * .137) * Math.PI * 2, radius = Math.min(24, noise.radius - 2) + i % 3;
      const x = Math.floor(noise.x + Math.cos(angle) * radius) + .5, z = Math.floor(noise.z + Math.sin(angle) * radius) + .5;
      if (players.some(p => distance(p.pose, { x, z }) < 15)) continue;
      for (let y = HEIGHT - 3; y >= 1; y--) {
        const p = this.ground(x, z, y); if (!p || this.protection(p)) continue;
        const trace = traceBarriers(this.world, { x: p.x, y: p.y + 1.4, z: p.z }, { x: noise.x, y: noise.y + .6, z: noise.z });
        if (trace.unloaded || distance(p, noise) > noise.radius * .6 ** trace.barriers) continue;
        Object.assign(this.entity, p, { state: 'investigate', target: copyPoint(noise), home: copyPoint(p), interestUntil: now + 22, encounterUntil: now + 75 });
        this.path = []; this.pathAt = 0; this.cue('alert', now); return true;
      }
    }
    return false;
  }
  route(target) {
    const e = this.entity, start = { x: Math.floor(e.x) + .5, y: e.y, z: Math.floor(e.z) + .5, parent: null, cost: 0 };
    const open = [start], seen = new Map([[`${start.x},${start.y},${start.z}`, 0]]);
    let best = start;
    const deadline = performance.now() + 2;
    while (open.length && this.lastNodes < NAV_NODE_BUDGET && this.lastReads < NAV_READ_BUDGET && performance.now() <= deadline) {
      let next = 0;
      for (let i = 1; i < open.length; i++) if (open[i].cost + distance(open[i], target) < open[next].cost + distance(open[next], target)) next = i;
      const node = open.splice(next, 1)[0]; this.lastNodes++;
      if (distance(node, target) < distance(best, target)) best = node;
      if (distance(node, target) < 1.5) { best = node; break; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const p = this.ground(node.x + dx, node.z + dz, node.y); if (!p || distance(p, start) > 28) continue;
        const id = `${p.x},${p.y},${p.z}`, cost = node.cost + 1;
        if ((seen.get(id) ?? Infinity) <= cost) continue;
        seen.set(id, cost); open.push({ ...p, cost, parent: node });
      }
    }
    const path = []; while (best.parent) { path.unshift(copyPoint(best)); best = best.parent; } return path;
  }
  move(target, speed, now) {
    const e = this.entity;
    if (now >= this.pathAt) { this.path = this.route(target); this.pathAt = now + 1; }
    const next = this.path[0]; if (!next) return;
    const length = distance(e, next), amount = Math.min(length, speed * LISTENER_INTERVAL);
    const candidate = { x: e.x + (next.x - e.x) / Math.max(.001, length) * amount, y: Math.max(e.y, next.y), z: e.z + (next.z - e.z) / Math.max(.001, length) * amount };
    if (next.y < candidate.y && this.fits(candidate.x, next.y, candidate.z)) candidate.y = next.y;
    if (!this.fits(candidate.x, candidate.y, candidate.z) || e.state !== 'retreat' && this.protection(candidate)) { this.path = []; this.pathAt = now + .6; return; }
    e.yaw = Math.atan2(e.x - candidate.x, e.z - candidate.z); Object.assign(e, candidate);
    this.stride += amount; if (this.stride >= 1.8) { this.stride %= 1.8; e.stepSeq++; }
    if (length <= amount + .02) this.path.shift();
  }
  advance(seconds, players) {
    if (!Number.isFinite(seconds) || seconds <= 0) return false;
    players = players.filter(p => point(p.pose, this.world.size || SIZE)).slice(0, 8);
    this.elapsed += seconds; if (this.elapsed < LISTENER_INTERVAL) return false;
    this.elapsed %= LISTENER_INTERVAL;
    const { elapsedSeconds: now, phase } = this.clock(), e = this.entity;
    this.lastNodes = this.lastReads = 0; this.observe(players, now);
    this.noises = this.noises.filter(n => now - n.at <= 10);
    const night = phase >= .52 && phase < .94;
    if (!players.length || now < LISTENER_GRACE) return true;
    if (e.state === 'dormant') {
      if (night && now >= e.cooldownUntil) {
        const loudest = [...this.noises].sort((a, b) => b.radius - a.radius || b.at - a.at)[0];
        if (loudest) this.spawn(loudest, players, now);
      }
      return true;
    }
    if ((!night || now >= e.encounterUntil || this.protection(e)) && e.state !== 'retreat') this.setState('retreat', now);
    if (e.state === 'retreat') {
      if (now >= e.stateUntil || players.every(p => distance(e, p.pose) > 32)) this.setState('dormant', now);
      else if (e.home) this.move(e.home, 1.7, now);
      return true;
    }
    let heard = null, loudness = 0;
    for (const noise of this.noises) {
      if (noise.at < now - 1) continue;
      const trace = traceBarriers(this.world, { x: e.x, y: e.y + 1.4, z: e.z }, { x: noise.x, y: noise.y + .6, z: noise.z });
      const strength = noise.radius * .6 ** trace.barriers - distance(e, noise);
      if (!trace.unloaded && strength > loudness) { loudness = strength; heard = noise; }
    }
    if (heard) { e.target = copyPoint(heard); e.interestUntil = now + 20; }
    let seen = null;
    for (const player of players) {
      if (distance(e, player.pose) > 22 || this.protection(player.pose)) continue;
      const trace = traceBarriers(this.world, { x: e.x, y: e.y + 1.8, z: e.z }, { x: player.pose.x, y: player.pose.y + EYE_HEIGHT, z: player.pose.z }, { sight: true });
      if (!trace.barriers && !trace.unloaded && (!seen || distance(e, player.pose) < distance(e, seen.pose))) seen = player;
    }
    if (seen) { this.setState('stalk', now); e.target = copyPoint(seen.pose); e.interestUntil = now + 12; }
    else if (e.state === 'stalk') this.setState('investigate', now);
    if (now >= e.interestUntil) this.setState('retreat', now);
    else if (e.target && distance(e, e.target) > (e.state === 'stalk' ? 5 : 1.5)) this.move(e.target, e.state === 'stalk' ? .95 : 1.3, now);
    if (e.state === 'stalk' && now - e.lastCueAt >= 9) this.cue('breath', now);
    return true;
  }
}
