import { HEIGHT, SIZE, WATER, LEAVES, EYE_HEIGHT, isSolid, isSupport, isSlab, blockBounds, doorState } from './world.js';
import { loadedBlock, traceBarriers } from './perception.js';
import { TensionDirector, validDirector } from './director.js';
import { ListenerMemory, validMemory } from './listener-memory.js';
import { chooseListenerAction } from './listener-decisions.js';

export const LISTENER_INTERVAL = .2;
export const MAX_NOISE_EVENTS = 32;
export const NAV_NODE_BUDGET = 96;
export const NAV_READ_BUDGET = 4096;
export const LISTENER_GRACE = 90;
export const LISTENER_STANDING_HEIGHT = 2.35;
export const LISTENER_PASSAGE_HEIGHT = 1.85;
const states = ['dormant', 'listen', 'investigate', 'shadow', 'search', 'stalk', 'pressure', 'retreat'];
export const LISTENER_CUES = ['alert', 'notice', 'search', 'pursuit', 'pressure', 'breath', 'retreat'];
const keyOf = p => p.key || p.id;
const goalDistance = (a, b) => distance(a, b) + Math.abs(a.y - b.y);
const validMind = (m, size) => m === undefined || !!m && m.version === 1
  && [m.actionAt, m.decideAt, m.progressAt, m.warningUntil, m.burstUntil, m.burstReadyAt, m.goalAt, m.spawnOffsetAt].every(finiteTime)
  && (m.spawnOffset === null || Number.isFinite(m.spawnOffset) && m.spawnOffset >= 0 && m.spawnOffset <= 1)
  && Number.isInteger(m.failures) && m.failures >= 0 && m.failures <= 20
  && [m.progress, m.goal].every(p => p === null || point(p, size))
  && (m.focusKey === null || typeof m.focusKey === 'string' && /^[\w-]{1,80}$/.test(m.focusKey));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const finiteTime = n => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const point = (p, size) => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k])) && p.x >= 0 && p.z >= 0 && p.x < size && p.z < size && p.y >= 0 && p.y < HEIGHT;
const copyPoint = p => ({ x: p.x, y: p.y, z: p.z });

export function validListener(value, size = 512, now = Infinity) {
  if (value === undefined) return true;
  return !!value && value.version === 1 && states.includes(value.state) && point(value, size) && Number.isFinite(value.yaw)
    && [value.interestUntil, value.encounterUntil, value.stateUntil, value.cooldownUntil, value.lastCueAt].every(finiteTime)
    && [value.cueSeq, value.stepSeq].every(n => Number.isSafeInteger(n) && n >= 0)
    && LISTENER_CUES.includes(value.cueKind)
    && validDirector(value.director) && validMemory(value.memory, size) && validMind(value.mind, size)
    && (!value.director || value.director.phaseAt <= now && value.director.players.every(p => p.at <= now && p.targetAt <= now) && value.director.history.every(h => h.at <= now))
    && (!value.memory || value.memory.facts.every(f => f.at <= now))
    && (value.crouched === undefined || typeof value.crouched === 'boolean')
    && [value.target, value.home].every(p => p === null || point(p, size));
}

export class ListenerSystem {
  constructor(world, { clock = () => ({ elapsedSeconds: 0, phase: .18 }), shelters, saved, contact = () => false, pressure } = {}) {
    this.world = world; this.clock = clock; this.shelters = shelters; this.contact = contact; this.pressure = pressure; this.strikeTarget = null; this.strikeAt = 0;
    const center = Math.min((world.size || SIZE) - .5, (world.size || SIZE) / 2 + .5);
    const { director, memory, mind, ...entity } = saved || {};
    this.director = new TensionDirector({ now: clock().elapsedSeconds, saved: director, seed: world.seed ? [...String(world.seed)].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261) : 71831 }); this.memory = new ListenerMemory(memory);
    const now = clock().elapsedSeconds;
    this.mind = mind ? structuredClone(mind) : { version: 1, actionAt: now, decideAt: 0, progressAt: now, warningUntil: 0, burstUntil: 0, burstReadyAt: 0, goalAt: 0, spawnOffset: null, spawnOffsetAt: 0, failures: 0, focusKey: null, progress: null, goal: null };
    this.entity = saved ? structuredClone(entity) : { version: 1, state: 'dormant', x: center, y: 1, z: center, yaw: 0, target: null, home: null,
      interestUntil: 0, encounterUntil: 0, stateUntil: 0, cooldownUntil: 0, lastCueAt: 0, cueSeq: 0, stepSeq: 0, cueKind: 'alert' };
    this.entity.crouched ??= false; this.activity = 'Waiting'; this.lastSeenAt = this.entity.state === 'stalk' ? clock().elapsedSeconds : -Infinity;
    this.noises = []; this.motion = new Map(); this.actionTimes = new Map(); this.elapsed = 0; this.path = []; this.pathAt = 0; this.stride = 0;
    this.lastNodes = 0; this.lastReads = 0; this.lastSenseSteps = 0; this.lastCandidates = 0; this.decision = 'Waiting for evidence'; this.scores = []; this.revision = world.serial;
  }
  snapshot() { return { ...structuredClone(this.entity), director: this.director.snapshot(), memory: this.memory.snapshot(), mind: structuredClone(this.mind) }; }
  publicState() {
    const e = this.entity, now = this.clock().elapsedSeconds;
    return { state: e.state, x: e.x, y: e.y, z: e.z, yaw: e.yaw, cueSeq: e.cueSeq, cueKind: e.cueKind, stepSeq: e.stepSeq, crouched: e.crouched, winding: !!this.strikeTarget, pressing: e.state === 'pressure', sprinting: e.state === 'stalk' && now >= this.mind.warningUntil && now < this.mind.burstUntil, directorPhase: this.director.state.phase,
      alpha: 1 };
  }
  diagnostics() {
    const now = this.clock().elapsedSeconds, fact = this.memory.best(now);
    return { state: this.entity.state, activity: this.activity, decision: this.decision, crouched: this.entity.crouched, pathNodes: this.path.length,
      noiseEvents: this.noises.length, expandedNodes: this.lastNodes, blockReads: this.lastReads, perceptionSteps: this.lastSenseSteps, candidates: this.lastCandidates,
      evidence: fact ? `${fact.kind} · ${Math.floor(now - fact.at)}s old · ${Math.round(this.memory.confidence(fact, now) * 100)}%` : 'None',
      failedRoutes: this.memory.state.failed.length, scores: this.scores, director: this.director.diagnostics(now) };
  }
  trace(a, b, options) { const result = traceBarriers(this.world, a, b, options); this.lastSenseSteps += result.steps; return result; }
  inView(p, observer) {
    const eye = { x: observer.x, y: observer.y + EYE_HEIGHT, z: observer.z }, dx = p.x - eye.x, dy = p.y + 1.3 - eye.y, dz = p.z - eye.z;
    const length = Math.hypot(dx, dy, dz), yaw = observer.yaw || 0, pitch = observer.pitch || 0;
    const dot = (-Math.sin(yaw) * Math.cos(pitch) * dx + Math.sin(pitch) * dy - Math.cos(yaw) * Math.cos(pitch) * dz) / Math.max(.001, length);
    if (length > 56 || dot < Math.cos(70 * Math.PI / 180)) return false;
    for (const height of [p.crouched ? 1.65 : 2.2, 1.2, .25]) {
      const trace = this.trace(eye, { x: p.x, y: p.y + height, z: p.z }, { sight: true });
      if (trace.unloaded || !trace.barriers) return true;
    }
    return false;
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
          if (fluid || block !== undefined && (isSupport(block) || isSlab(block)) && Math.abs(blockBounds(block, 0, Math.floor(pose.y - .05), 0).maxY - pose.y) < .22) {
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
    e.state = state; this.path = []; this.pathAt = 0; this.strikeTarget = null; this.pressure?.reset();
    this.mind.actionAt = now; this.mind.goal = null; this.mind.goalAt = 0;
    if (state !== 'stalk') { this.mind.burstUntil = 0; this.mind.warningUntil = 0; }
    if (state === 'retreat') { this.activity = 'Retreating'; e.stateUntil = now + 8; this.cue('retreat', now); }
    if (state === 'shadow') this.cue('notice', now);
    if (state === 'search') this.cue('search', now);
    if (state === 'pressure') this.cue('pressure', now);
    if (state === 'retreat') this.director.setPhase('release', now, this.decision || 'Creature withdrawing');
    if (state === 'dormant') { this.mind.spawnOffset = null; this.activity = 'Encounter cooldown'; e.cooldownUntil = now + 45; e.target = null; }
  }
  read(x, y, z) { if (this.lastReads >= NAV_READ_BUDGET) return undefined; this.lastReads++; return loadedBlock(this.world, x, y, z); }
  fits(x, y, z, height = LISTENER_PASSAGE_HEIGHT) {
    for (let bx = Math.floor(x - .26); bx <= Math.floor(x + .26); bx++) for (let bz = Math.floor(z - .26); bz <= Math.floor(z + .26); bz++) for (let by = Math.floor(y); by <= Math.floor(y + height); by++) {
      const block = this.read(bx, by, bz); if (block === undefined || doorState(block)?.open === false) return false;
      if (!isSolid(block)) continue;
      const b = blockBounds(block, bx, by, bz);
      if (x + .26 > b.minX && x - .26 < b.maxX && z + .26 > b.minZ && z - .26 < b.maxZ && y + height > b.minY && y < b.maxY) return false;
    }
    return true;
  }
  ground(x, z, reference) {
    const base = Math.floor(reference);
    for (const feet of [base, base + 1, base - 1]) {
      const support = this.read(Math.floor(x), feet - 1, Math.floor(z));
      if (support === undefined || support === LEAVES || !(isSupport(support) || isSlab(support))) continue;
      const y = blockBounds(support, Math.floor(x), feet - 1, Math.floor(z)).maxY + .01;
      if (this.fits(x, y, z)) return { x, y, z };
    }
    return null;
  }
  shelterState(p) { return this.shelters?.status(p)?.state; }
  protection(p) { return this.shelterState(p) === 'protected'; }
  entryBlocked(p) { return ['protected', 'checking'].includes(this.shelterState(p)); }
  spawn(noise, players, now, ambient = false) {
    if (noise.radius < 18) return false;
    if (this.mind.spawnOffset === null || now - this.mind.spawnOffsetAt > 8) { this.mind.spawnOffset = this.director.random(); this.mind.spawnOffsetAt = now; }
    const offset = this.mind.spawnOffset;
    for (let i = 0; i < 12 && this.lastReads < NAV_READ_BUDGET && this.lastNodes < NAV_NODE_BUDGET; i++) {
      this.lastCandidates++;
      const angle = (i / 12 + offset) * Math.PI * 2, radius = Math.min(24, noise.radius - 2) + i % 3;
      const x = Math.floor(noise.x + Math.cos(angle) * radius) + .5, z = Math.floor(noise.z + Math.sin(angle) * radius) + .5;
      if (players.some(p => distance(p.pose, { x, z }) < 15)) continue;
      for (let y = HEIGHT - 3; y >= 1; y--) {
        const p = this.ground(x, z, y); if (!p || this.entryBlocked(p) || players.some(player => this.inView(p, player.pose))) continue;
        const trace = this.trace({ x: p.x, y: p.y + 1.4, z: p.z }, { x: noise.x, y: noise.y + .6, z: noise.z });
        if (!ambient && (trace.unloaded || distance(p, noise) > noise.radius * .6 ** trace.barriers)) continue;
        const goal = { ...copyPoint(noise), y: Math.abs(noise.y - p.y) < 2 ? noise.y : p.y };
        const path = this.route(goal, p);
        if (!path.length && goalDistance(p, goal) > 2) continue;
        Object.assign(this.entity, p, { state: ambient ? 'listen' : 'investigate', target: ambient ? null : copyPoint(noise), home: copyPoint(p), interestUntil: now + 22, encounterUntil: now + 75 });
        this.entity.crouched = !this.fits(p.x, p.y, p.z, LISTENER_STANDING_HEIGHT);
        if (!ambient) this.memory.remember('sound', noise, noise.at, .65, keyOf(players.find(p => p.id === noise.source) || {}) || null);
        this.mind.focusKey = null; this.path = path; this.pathAt = now + 1; this.mind.actionAt = now; this.mind.progressAt = now; this.mind.progress = copyPoint(p); this.mind.failures = 0;
        this.decision = ambient ? 'Safe distant presence; no invented target' : 'Fresh sound and a safe offscreen route';
        this.activity = ambient ? 'Listening in the distance' : 'Following noise'; this.cue('alert', now); return true;
      }
    }
    return false;
  }

  route(target, e = this.entity) {
    const start = { x: Math.floor(e.x) + .5, y: e.y, z: Math.floor(e.z) + .5, parent: null, cost: 0 };
    const open = [start], seen = new Map([[`${start.x},${start.y},${start.z}`, 0]]);
    let best = start;
    const deadline = performance.now() + 2;
    while (open.length && this.lastNodes < NAV_NODE_BUDGET && this.lastReads < NAV_READ_BUDGET && performance.now() <= deadline) {
      let next = 0;
      for (let i = 1; i < open.length; i++) if (open[i].cost + goalDistance(open[i], target) < open[next].cost + goalDistance(open[next], target)) next = i;
      const node = open.splice(next, 1)[0]; this.lastNodes++;
      if (goalDistance(node, target) < goalDistance(best, target)) best = node;
      if (distance(node, target) < .8 && Math.abs(node.y - target.y) < 1.25) { best = node; break; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const p = this.ground(node.x + dx, node.z + dz, node.y); if (!p || distance(p, start) > 28) continue;
        const id = `${p.x},${p.y},${p.z}`, cost = node.cost + 1;
        if ((seen.get(id) ?? Infinity) <= cost) continue;
        seen.set(id, cost); open.push({ ...p, cost, parent: node });
      }
    }
    const path = []; while (best.parent) { path.unshift(copyPoint(best)); best = best.parent; }
    // Searches begin at a cell center, while the creature may still be between
    // waypoints. Align the perpendicular axis before turning so replans cannot
    // repeatedly cut the same solid corner. Preserve forward progress on straights.
    const next = path[0];
    if (next) {
      const align = next.x !== start.x ? { x: e.x, y: e.y, z: start.z } : { x: start.x, y: e.y, z: e.z };
      if (distance(e, align) > .02 && this.fits(align.x, align.y, align.z)) path.unshift(align);
    }
    return path;
  }
  move(target, speed, now) {
    const e = this.entity;
    if (now >= this.pathAt) { this.path = this.route(target); this.pathAt = now + 1; }
    const next = this.path[0]; if (!next) { this.activity = 'No clear route'; return; }
    const length = distance(e, next), amount = Math.min(length, speed * LISTENER_INTERVAL);
    const candidate = { x: e.x + (next.x - e.x) / Math.max(.001, length) * amount, y: Math.max(e.y, next.y), z: e.z + (next.z - e.z) / Math.max(.001, length) * amount };
    if (next.y < candidate.y && this.fits(candidate.x, next.y, candidate.z)) candidate.y = next.y;
    if (!this.fits(candidate.x, candidate.y, candidate.z)) { this.activity = 'Path obstructed'; this.path = []; this.pathAt = now + .6; return; }
    if (e.state !== 'retreat' && this.entryBlocked(candidate)) { this.activity = 'Checking shelter'; this.path = []; this.pathAt = now + .6; return; }
    e.crouched = !this.fits(candidate.x, candidate.y, candidate.z, LISTENER_STANDING_HEIGHT) || !this.fits(next.x, next.y, next.z, LISTENER_STANDING_HEIGHT);
    this.activity = e.state === 'retreat' ? 'Moving away' : 'Following route';
    e.yaw = Math.atan2(e.x - candidate.x, e.z - candidate.z); Object.assign(e, candidate);
    this.stride += amount; if (this.stride >= .9) { this.stride %= .9; e.stepSeq++; }
    if (length <= amount + .02) this.path.shift();
  }
  perceive(players, now) {
    const e = this.entity; let seen = null, score = -Infinity, heard = null, loudness = 0;
    for (const noise of this.noises) {
      if (noise.at < now - 1) continue;
      const trace = this.trace({ x: e.x, y: e.y + 1.4, z: e.z }, { x: noise.x, y: noise.y + .6, z: noise.z });
      const strength = noise.radius * .6 ** trace.barriers - distance(e, noise);
      if (!trace.unloaded && strength > loudness) { loudness = strength; heard = noise; }
    }
    if (heard) this.memory.remember('sound', heard, heard.at, Math.min(.85, .45 + loudness / 40), keyOf(players.find(p => p.id === heard.source) || {}) || null);
    for (const player of players) {
      if (distance(e, player.pose) > 22 || this.entryBlocked(player.pose)) continue;
      const trace = this.trace({ x: e.x, y: e.y + 1.8, z: e.z }, { x: player.pose.x, y: player.pose.y + EYE_HEIGHT, z: player.pose.z }, { sight: true });
      if (trace.barriers || trace.unloaded) continue;
      const rank = 1 - distance(e, player.pose) / 30 - (keyOf(player) === this.mind.focusKey ? 0 : this.director.targetPenalty(keyOf(player), now)) + (keyOf(player) === this.mind.focusKey ? .15 : 0);
      if (rank > score) { score = rank; seen = player; }
    }
    if (seen) {
      this.lastSeenAt = now; this.memory.remember('sight', seen.pose, now, 1, keyOf(seen));
      if (this.mind.focusKey !== keyOf(seen)) { this.mind.focusKey = keyOf(seen); this.director.focus(keyOf(seen), now); }
    }
    return seen;
  }
  positionFor(kind, fact, now) {
    if (this.mind.goal && now < this.mind.goalAt && !this.memory.blocked(this.mind.goal, now)) return this.mind.goal;
    const e = this.entity, candidates = [], base = fact.point, age = Math.max(0, now - fact.at);
    for (let i = 0; i < 12 && this.lastReads < NAV_READ_BUDGET; i++) {
      this.lastCandidates++;
      const radius = kind === 'shadow' ? 8 + i % 3 : i === 0 ? 0 : Math.min(7, 2 + age * .2 + i % 3);
      const angle = i / 11 * Math.PI * 2 + (kind === 'shadow' ? Math.atan2(e.z - base.z, e.x - base.x) : 0);
      const lead = kind === 'search' ? Math.min(3, age * .4) : 0;
      const p = this.ground(Math.floor(base.x + fact.direction.x * lead + Math.cos(angle) * radius) + .5, Math.floor(base.z + fact.direction.z * lead + Math.sin(angle) * radius) + .5, base.y);
      if (!p || this.entryBlocked(p) || this.memory.blocked(p, now) || kind === 'search' && this.memory.searched(p)) continue;
      let score = -distance(e, p) * .05;
      if (kind === 'shadow') {
        const trace = this.trace({ x: base.x, y: base.y + EYE_HEIGHT, z: base.z }, { x: p.x, y: p.y + 1.5, z: p.z }, { sight: true });
        if (trace.unloaded) continue;
        score += trace.barriers ? .2 : .5; score -= Math.abs(distance(base, p) - 9) * .08;
      } else score -= distance(base, p) * .025;
      candidates.push({ point: p, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    this.mind.goal = candidates[0]?.point || null; this.mind.goalAt = now + (kind === 'shadow' ? 2 : 4);
    return this.mind.goal;
  }
  retreatPosition(players, now) {
    const e = this.entity, nearest = [...players].sort((a, b) => distance(e, a.pose) - distance(e, b.pose))[0];
    if (!nearest) return e.home;
    const away = Math.atan2(e.z - nearest.pose.z, e.x - nearest.pose.x), candidates = [];
    for (let i = 0; i < 12 && this.lastReads < NAV_READ_BUDGET; i++) {
      this.lastCandidates++;
      const angle = away + (i % 2 ? -1 : 1) * Math.ceil(i / 2) * Math.PI / 6;
      const p = this.ground(Math.floor(e.x + Math.cos(angle) * 7) + .5, Math.floor(e.z + Math.sin(angle) * 7) + .5, e.y);
      if (!p || this.memory.blocked(p, now)) continue;
      const closest = Math.min(...players.map(player => distance(p, player.pose)));
      if (closest < Math.min(5, distance(e, nearest.pose))) continue;
      const hidden = !players.some(player => this.inView(p, player.pose));
      candidates.push({ point: p, score: (hidden ? 80 : 0) + closest - distance(e, p) * .2 });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.point || e.home;
  }
  choose(seen, fact, barrier, now) {
    const e = this.entity, permission = this.director.permissions(now), confidence = fact ? this.memory.confidence(fact, now) : 0;
    const recentSight = fact?.kind === 'sight' && now - fact.at <= 1.5;
    const candidates = [
      { action: 'stalk', allowed: permission.pursue && (!!seen || recentSight), score: .95, reason: 'Confirmed discovery; pursuit permitted' },
      { action: 'shadow', allowed: !!seen && permission.presence, score: .78, reason: 'Watching a visible player while tension builds' },
      { action: 'pressure', allowed: !!barrier && permission.breach && confidence > .15, score: .9 - (barrier?.detour ? .25 : 0), reason: 'Nearby unprotected barrier; breach allowance available' },
      { action: 'investigate', allowed: !!fact && fact.kind === 'sound' && !this.memory.searched(fact.point) && !this.memory.blocked(fact.point, now), score: .55 + confidence * .3, reason: 'Following remembered sound' },
      { action: 'search', allowed: !!fact && !seen, score: .5 + confidence * .2, reason: 'Searching around last evidence; player location unknown' },
      { action: 'listen', allowed: true, score: .12, reason: 'Pausing to listen for fresh evidence' },
    ];
    this.scores = candidates.filter(c => c.allowed).map(c => ({ action: c.action, score: Math.round(c.score * 100) }));
    const choice = chooseListenerAction(candidates, e.state, now - this.mind.actionAt, () => this.director.random());
    if (fact?.key && fact.key !== this.mind.focusKey) { this.mind.focusKey = fact.key; this.director.focus(fact.key, now); }
    this.decision = choice.reason; this.setState(choice.action, now); this.mind.decideAt = now + 1;
  }
  advance(seconds, players) {
    if (!Number.isFinite(seconds) || seconds <= 0) return false;
    const present = players.filter(p => point(p.pose, this.world.size || SIZE)).slice(0, 8), eligible = present.filter(p => p.vulnerable !== false);
    this.elapsed += seconds; if (this.elapsed < LISTENER_INTERVAL) return false; this.elapsed %= LISTENER_INTERVAL;
    const { elapsedSeconds: now, phase } = this.clock(), e = this.entity, m = this.mind;
    this.lastNodes = this.lastReads = this.lastSenseSteps = this.lastCandidates = 0;
    if (this.revision !== this.world.serial) { this.revision = this.world.serial; this.pathAt = 0; this.memory.state.failed = []; }
    this.observe(eligible, now); this.noises = this.noises.filter(n => now - n.at <= 10); this.memory.advance(now);
    const night = phase >= .52 && phase < .94, grace = now < LISTENER_GRACE;
    const active = e.state !== 'dormant', retiring = e.state === 'retreat';
    const seen = active && !retiring ? this.perceive(eligible, now) : null;
    const fact = this.memory.best(now), freshNoise = this.noises.filter(n => n.radius >= 18).sort((a, b) => b.radius - a.radius || b.at - a.at)[0];
    this.director.advance(now, present.map(p => ({ ...p, distance: distance(e, p.pose), exposed: !this.entryBlocked(p.pose) })),
      { night, grace, active, retiring, evidence: !!freshNoise || !!fact, seen: !!seen, distance: seen ? distance(e, seen.pose) : Infinity, pressing: e.state === 'pressure' });
    const permission = this.director.permissions(now);
    if (e.state === 'dormant') {
      this.activity = !night ? 'Waiting for night' : grace ? 'Starting grace' : 'Director: ' + this.director.state.reason;
      if (night && !grace && eligible.length && now >= e.cooldownUntil && permission.presence) {
        if (freshNoise) this.spawn(freshNoise, present, now);
        else { const anchor = eligible.find(p => !this.entryBlocked(p.pose)); if (anchor) this.spawn({ ...anchor.pose, radius: 26 }, present, now, true); }
      }
      return true;
    }
    if (!night || grace || !eligible.length || now >= e.encounterUntil || this.protection(e) || permission.rest) {
      this.decision = !night ? 'Daylight' : this.protection(e) ? 'Powered ward refuge' : !eligible.length ? 'Players down or recovering' : now >= e.encounterUntil ? 'Encounter duration limit' : this.director.state.reason;
      this.setState('retreat', now);
    }
    if (e.state === 'retreat') {
      // Do not remove a creature under observation. Fade/retire only after it is
      // out of every player's view; no active-encounter teleportation.
      if (now >= e.stateUntil && !present.some(p => this.inView(e, p.pose))) this.setState('dormant', now);
      else {
        if (now >= e.stateUntil && now >= m.goalAt) { e.home = this.retreatPosition(present, now); m.goalAt = now + 3; this.pathAt = 0; }
        if (e.home) this.move(e.home, 1.7, now);
        if (!m.progress || distance(e, m.progress) > .3) { m.progress = copyPoint(e); m.progressAt = now; }
        else if (now - m.progressAt >= 3) { if (e.home) this.memory.fail(e.home, now); m.goalAt = 0; m.progressAt = now; }
      }
      return true;
    }
    if (!fact && now - m.actionAt > 4) { this.decision = 'Evidence expired'; this.setState('retreat', now); return true; }
    const barrier = fact && this.pressure?.candidate(e, fact.point);
    if (barrier && now >= m.decideAt) {
      const detour = this.route(fact.point), end = detour.at(-1);
      barrier.detour = !!end && goalDistance(end, fact.point) < 2 && detour.length / 1.6 < barrier.hits * 3;
      if (barrier.detour) { this.path = detour; this.pathAt = now + 1; }
    }
    if (now >= m.decideAt || e.state === 'pressure' && !permission.breach || e.state === 'stalk' && !permission.pursue) this.choose(seen, fact, barrier, now);
    if (fact) e.interestUntil = fact.at + (fact.kind === 'sight' ? 18 : 22);
    let moving = false;
    if (e.state === 'stalk') {
      e.target = seen ? copyPoint(seen.pose) : fact && copyPoint(fact.point);
      if (seen && now >= m.burstReadyAt && permission.burst && this.director.spend('burst', now, m.focusKey)) {
        m.warningUntil = now + 1.2; m.burstUntil = m.warningUntil + 5; m.burstReadyAt = m.burstUntil + 5; this.cue('pursuit', now);
      }
      const touching = seen && distance(e, seen.pose) <= 1.25 && Math.abs(e.y - seen.pose.y) < 1.2 && now >= m.warningUntil;
      const trace = touching && this.trace({ x: e.x, y: e.y + .9, z: e.z }, { ...seen.pose, y: seen.pose.y + .9 });
      if (touching && !trace.unloaded && !trace.barriers) {
        if (this.strikeTarget !== seen.id) { this.strikeTarget = seen.id; this.strikeAt = now + .9; this.cue('breath', now); }
        this.activity = 'Reaching for player'; e.yaw = Math.atan2(e.x - seen.pose.x, e.z - seen.pose.z); m.progressAt = now;
        if (now >= this.strikeAt && this.contact(seen.id)) { this.director.knockdown(keyOf(seen), now); this.decision = 'Successful contact: group recovery'; this.setState('retreat', now); return true; }
      } else {
        this.strikeTarget = null;
        if (e.target && distance(e, e.target) > 1) { this.move(e.target, now < m.warningUntil ? 1.2 : now < m.burstUntil ? 5.4 : 2.6, now); moving = true; }
        if (now < m.warningUntil) this.activity = 'Warning before pursuit burst';
      }
    } else if (e.state === 'shadow' && fact) {
      this.strikeTarget = null;
      const goal = this.positionFor('shadow', fact, now); e.target = goal;
      if (goal && distance(e, goal) > .6) { this.move(goal, 1.4, now); moving = true; }
      else { this.activity = 'Watching from a distance'; e.yaw = Math.atan2(e.x - fact.point.x, e.z - fact.point.z); m.progressAt = now; }
    } else if (e.state === 'pressure' && fact && permission.breach) {
      this.strikeTarget = null; e.target = copyPoint(fact.point); m.progressAt = now;
      if (this.pressure?.advance(e, e.target, now)) { this.activity = 'Pressing on structure'; e.yaw = Math.atan2(e.x - e.target.x, e.z - e.target.z); }
      else { m.decideAt = 0; this.activity = 'Barrier changed: reassessing'; }
    } else if (e.state === 'investigate' && fact) {
      e.target = copyPoint(fact.point);
      if (distance(e, e.target) > .9 || Math.abs(e.y - e.target.y) > 1.25) { this.move(e.target, 1.6, now); moving = true; }
      else { this.memory.visit(fact.point); m.decideAt = 0; this.activity = 'Listening at sound source'; m.progressAt = now; }
    } else if (e.state === 'search' && fact) {
      const goal = this.positionFor('search', fact, now); e.target = goal;
      if (goal && goalDistance(e, goal) > .8) { this.move(goal, 1.3, now); moving = true; }
      else { if (goal) this.memory.visit(goal); m.goal = null; m.goalAt = 0; this.activity = 'Checking a remembered area'; m.progressAt = now; }
    } else { this.strikeTarget = null; this.activity = 'Listening for fresh evidence'; m.progressAt = now; e.yaw += .12; }
    if (!m.progress || distance(e, m.progress) >= .3 || Math.abs(e.y - m.progress.y) >= .3) { m.progress = copyPoint(e); m.progressAt = now; m.failures = 0; }
    else if (moving && now - m.progressAt >= 3) {
      if (e.target) this.memory.fail(e.target, now); m.failures = Math.min(20, m.failures + 1); m.progressAt = now; m.goalAt = 0; m.decideAt = 0; this.pathAt = 0;
      if (m.failures >= 3) { this.decision = 'Repeated route failures: withdraw'; this.setState('retreat', now); }
    }
    if (e.state === 'shadow' && now - e.lastCueAt >= 9) this.cue('breath', now);
    return true;
  }
}
