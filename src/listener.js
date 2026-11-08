import { PRESSURE_INTERVAL } from './listener-pressure.js';
import { HEIGHT, SIZE, WATER, LEAVES, EYE_HEIGHT, isSolid, isSupport, isSlab, blockBounds, doorState } from './world.js';
import { loadedBlock, traceBarriers } from './perception.js';
import { TensionDirector, validDirector } from './director.js';
import { ListenerMemory, validMemory } from './listener-memory.js';
import { chooseListenerAction } from './listener-decisions.js';
import { DOWNED_EYE_HEIGHT } from './encounters.js';
import { ListenerRouteSearch, NAV_NODE_BUDGET, NAV_READ_BUDGET, MAX_SPAWN_ROUTE_UPDATES, MAX_MOVE_SEGMENTS } from './listener-navigation.js';
export { NAV_NODE_BUDGET, NAV_READ_BUDGET } from './listener-navigation.js';

export const LISTENER_INTERVAL = .2;
export const MAX_LISTENER_STEP = 1;
export const MAX_NOISE_EVENTS = 32;
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
    this.noises = []; this.motion = new Map(); this.actionTimes = new Map(); this.elapsed = 0; this.pendingSeconds = 0; this.stepSeconds = LISTENER_INTERVAL; this.path = []; this.pathAt = 0; this.pathGoal = null; this.verifiedApproach = false; this.routeProbe = null; this.stride = 0; this.fallSpeed = 0;
    this.lastNodes = 0; this.lastReads = 0; this.lastSenseSteps = 0; this.lastCandidates = 0; this.decision = 'Waiting for evidence'; this.scores = []; this.revision = world.serial; this.spawnProbe = null; this.spawnCursor = 0;
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
      position: { x: this.entity.x, y: this.entity.y, z: this.entity.z }, target: this.entity.target, barrier: this.pressure?.diagnostics(now), failedRoutes: this.memory.state.failed.length, scores: this.scores, director: this.director.diagnostics(now) };
  }
  trace(a, b, options) { const result = traceBarriers(this.world, a, b, options); this.lastSenseSteps += result.steps; return result; }
  inView(p, observer, eyeHeight = EYE_HEIGHT) {
    const eye = { x: observer.x, y: observer.y + eyeHeight, z: observer.z }, yaw = observer.yaw || 0, pitch = observer.pitch || 0;
    const forward = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    const right = { x: Math.cos(yaw) * .4, z: -Math.sin(yaw) * .4 };
    const samples = [{ x: p.x, y: p.y + (p.crouched ? 1.65 : 2.2), z: p.z },
      { x: p.x, y: p.y + 1.2, z: p.z }, { x: p.x, y: p.y + .25, z: p.z },
      { x: p.x - right.x, y: p.y + 1.2, z: p.z - right.z }, { x: p.x + right.x, y: p.y + 1.2, z: p.z + right.z }];
    for (const sample of samples) {
      // Each sample needs its own cone check: a center outside the cone does
      // not mean the extremities are offscreen. Side samples conservatively
      // cover the raincoat/arms peeking past a narrow post or wall edge.
      const dx = sample.x - eye.x, dy = sample.y - eye.y, dz = sample.z - eye.z;
      const length = Math.hypot(dx, dy, dz), dot = (forward.x * dx + forward.y * dy + forward.z * dz) / Math.max(.001, length);
      if (length > 56 || length > .001 && dot < Math.cos(70 * Math.PI / 180)) continue;
      const trace = this.trace(eye, sample, { sight: true });
      if (trace.unloaded || !trace.barriers) return true;
    }
    return false;
  }
  inPlayerView(p, player) { return this.inView(p, player.pose, player.downed ? DOWNED_EYE_HEIGHT : EYE_HEIGHT); }

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
    e.state = state; this.path = []; this.pathAt = 0; this.pathGoal = null; this.verifiedApproach = false; this.routeProbe = null; this.strikeTarget = null; this.pressure?.reset();
    this.mind.actionAt = now; this.mind.goal = null; this.mind.goalAt = 0;
    if (state !== 'stalk') { this.mind.burstUntil = 0; this.mind.warningUntil = 0; }
    if (state === 'retreat') { this.activity = 'Retreating'; e.stateUntil = now + 8; this.cue('retreat', now); }
    if (state === 'shadow') this.cue('notice', now);
    if (state === 'search') this.cue('search', now);
    if (state === 'pressure') this.cue('pressure', now);
    if (state === 'retreat') this.director.setPhase('release', now, this.decision || 'Creature withdrawing');
    if (state === 'dormant') { this.fallSpeed = 0; this.spawnProbe = null; this.spawnCursor = 0; this.mind.spawnOffset = null; this.activity = 'Encounter cooldown'; e.cooldownUntil = now + 45; e.target = null; }
  }
  guard(changes) {
    const e = this.entity;
    if (e.state === 'dormant') return { ok: true };
    const height = e.crouched ? LISTENER_PASSAGE_HEIGHT : LISTENER_STANDING_HEIGHT;
    for (const c of changes) {
      if (c.from === c.to || !isSolid(c.to)) continue;
      // Closed doors occupy a whole navigation cell. Closing either half over
      // an actor in its frame would otherwise strand it despite a valid route.
      const b = doorState(c.to)?.open === false
        ? { minX: c.x, maxX: c.x + 1, minY: c.y, maxY: c.y + 1, minZ: c.z, maxZ: c.z + 1 }
        : blockBounds(c.to, c.x, c.y, c.z);
      if (e.x + .26 > b.minX && e.x - .26 < b.maxX && e.z + .26 > b.minZ && e.z - .26 < b.maxZ && e.y + height > b.minY && e.y < b.maxY)
        return { ok: false, reason: 'creature' };
    }
    return { ok: true };
  }
  read(x, y, z) {
    if (this.lastReads >= NAV_READ_BUDGET) return undefined;
    this.lastReads++; this.activeRouteSearch?.track(x, y, z, this.world);
    return loadedBlock(this.world, x, y, z);
  }
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
  settle() {
    const e = this.entity, speed = Math.min(8, this.fallSpeed + 20 * this.stepSeconds);
    const bottom = Math.max(.01, e.y - speed * this.stepSeconds);
    let surface = -Infinity;
    // Sweep only the footprint and at most nine vertical cells per column.
    // Even at terminal speed this catches thin slabs, without scanning a shaft
    // or generating terrain. Unknown support waits for normal chunk streaming.
    for (let x = Math.floor(e.x - .26); x <= Math.floor(e.x + .26); x++) for (let z = Math.floor(e.z - .26); z <= Math.floor(e.z + .26); z++) {
      for (let y = Math.floor(e.y - .01); y >= Math.floor(bottom - .01); y--) {
        const block = this.read(x, y, z);
        if (block === undefined) { this.fallSpeed = 0; this.activity = 'Waiting for loaded ground'; return false; }
        if (!isSolid(block)) continue;
        const b = blockBounds(block, x, y, z);
        if (e.x + .26 > b.minX && e.x - .26 < b.maxX && e.z + .26 > b.minZ && e.z - .26 < b.maxZ
          && b.maxY <= e.y + .001 && b.maxY + .01 >= bottom) surface = Math.max(surface, b.maxY);
      }
    }
    const grounded = Number.isFinite(surface), y = grounded ? surface + .01 : bottom;
    if (!this.fits(e.x, y, e.z)) { this.fallSpeed = 0; this.activity = 'Checking ground clearance'; return false; }
    this.fallSpeed = grounded ? 0 : speed;
    if (Math.abs(e.y - y) > 1e-8) {
      e.y = y; this.path = []; this.pathAt = 0; this.verifiedApproach = false; this.routeProbe = null; this.mind.goal = null; this.mind.goalAt = 0;
      e.crouched = !this.fits(e.x, y, e.z, LISTENER_STANDING_HEIGHT);
    }
    if (!grounded) { this.strikeTarget = null; this.pressure?.reset(); this.activity = 'Falling'; }
    return grounded;
  }
  shelterState(p) { return this.shelters?.status(p)?.state; }
  protection(p) { return this.shelterState(p) === 'protected'; }
  entryBlocked(p) { return ['protected', 'checking'].includes(this.shelterState(p)); }
  finishSpawn(probe, players, now) {
    const { point: p, noise, ambient, search } = probe;
    // A proof can take multiple slices. Recheck the current world and observers
    // before materializing, including players who moved/joined while it ran.
    if (!this.fits(p.x, p.y, p.z) || this.entryBlocked(p)
      || players.some(player => distance(p, player.pose) < 15 || this.inPlayerView(p, player))) return false;
    // Fuel/protection can change without a terrain revision while a proof is
    // pending. A barrier goal must still be eligible when the actor arrives.
    if (search.barrier && !this.pressure?.candidate(search.best, noise, { read: (x, y, z) => this.read(x, y, z) })) return false;
    const trace = this.trace({ x: p.x, y: p.y + 1.4, z: p.z }, { x: noise.x, y: noise.y + .6, z: noise.z });
    if (!ambient && (trace.unloaded || distance(p, noise) > noise.radius * .6 ** trace.barriers)) return false;
    Object.assign(this.entity, p, { state: ambient ? 'listen' : 'investigate', target: ambient ? null : copyPoint(noise), home: copyPoint(p), interestUntil: now + 22, encounterUntil: now + 75 });
    this.entity.crouched = !this.fits(p.x, p.y, p.z, LISTENER_STANDING_HEIGHT);
    if (!ambient) this.memory.remember('sound', noise, noise.at, .65, keyOf(players.find(player => player.id === noise.source) || {}) || null);
    // Keep the complete approach we just proved. Replacing it after one second
    // with a shorter partial search can strand the actor against the wrong wall.
    this.mind.focusKey = null; this.path = search.path(this); this.pathAt = this.entity.encounterUntil; this.pathGoal = copyPoint(noise); this.verifiedApproach = true; this.routeProbe = null; this.mind.actionAt = now;
    this.mind.progressAt = now; this.mind.progress = copyPoint(p); this.mind.failures = 0;
    this.decision = ambient ? 'Safe distant presence; confirmed route' : search.barrier ? 'Heard indoor work; verified approach to an unprotected barrier' : 'Fresh sound and a confirmed offscreen route';
    this.activity = ambient ? 'Listening in the distance' : 'Following noise'; this.cue('alert', now); return true;
  }
  continueSpawn(players, now) {
    const probe = this.spawnProbe;
    if (!probe) return false;
    probe.updates++;
    const status = probe.search.step(this);
    if (status === 'pending' && probe.updates < MAX_SPAWN_ROUTE_UPDATES) { this.activity = 'Verifying a complete spawn route'; return false; }
    this.spawnProbe = null;
    return status === 'reached' && this.finishSpawn(probe, players, now);
  }
  spawn(noise, players, now, ambient = false) {
    if (noise.radius < 18) return false;
    if (this.spawnProbe && (!this.spawnProbe.search.valid(this.world) || this.spawnProbe.ambient !== ambient || now - this.spawnProbe.at > 3)) this.spawnProbe = null;
    if (this.spawnProbe && players.some(player => distance(this.spawnProbe.point, player.pose) < 15 || this.inPlayerView(this.spawnProbe.point, player))) {
      // Stop spending route work as soon as an observer invalidates the
      // candidate, even if this update could not finish its remaining proof.
      this.spawnProbe = null; return false;
    }
    if (this.spawnProbe) return this.continueSpawn(players, now);
    if (this.mind.spawnOffset === null || now - this.mind.spawnOffsetAt > 8) {
      this.mind.spawnOffset = this.director.random(); this.mind.spawnOffsetAt = now; this.spawnCursor = 0;
    }
    const offset = this.mind.spawnOffset;
    for (let attempt = 0; attempt < 12 && this.lastReads < NAV_READ_BUDGET && this.lastNodes < NAV_NODE_BUDGET; attempt++) {
      const i = this.spawnCursor++ % 12; this.lastCandidates++;
      const angle = (i / 12 + offset) * Math.PI * 2, outer = Math.min(24, noise.radius - 2);
      // Include nearer safe candidates so a wall's hearing attenuation does
      // not rule out every arrival. All observers still enforce 15 blocks.
      const radius = ambient ? outer + i % 3 : i % 3 === 0 ? outer : Math.max(16, outer * (i % 3 === 1 ? .75 : 2 / 3));
      const x = Math.floor(noise.x + Math.cos(angle) * radius) + .5, z = Math.floor(noise.z + Math.sin(angle) * radius) + .5;
      if (players.some(p => distance(p.pose, { x, z }) < 15)) continue;
      for (let y = HEIGHT - 3; y >= 1; y--) {
        const p = this.ground(x, z, y); if (!p || this.entryBlocked(p) || players.some(player => this.inPlayerView(p, player))) continue;
        const trace = this.trace({ x: p.x, y: p.y + 1.4, z: p.z }, { x: noise.x, y: noise.y + .6, z: noise.z });
        if (!ambient && (trace.unloaded || distance(p, noise) > noise.radius * .6 ** trace.barriers)) continue;
        const goal = copyPoint(noise);
        this.spawnProbe = { point: p, noise: { ...noise }, ambient, at: now, updates: 0, search: new ListenerRouteSearch(p, goal, { guarded: true, approachBarriers: !ambient }) };
        if (this.continueSpawn(players, now)) return true;
        if (this.spawnProbe) return false;
      }
    }
    return false;
  }
  pointOnRoute(from, next, x, z) {
    const p = { x, y: Math.max(from.y, next.y), z };
    if (next.y < p.y && this.fits(x, next.y, z)) p.y = next.y;
    else if (!this.fits(x, p.y, z)) return null;
    return p;
  }
  route(target, e = this.entity, { requireComplete = false } = {}) {
    const search = new ListenerRouteSearch(e, target);
    search.step(this);
    return requireComplete && search.status !== 'reached' ? [] : search.path(this);
  }
  beginRoute(target, now) {
    const state = this.entity.state;
    return { state, at: now, updates: 0, search: new ListenerRouteSearch(this.entity, target,
      { guarded: state !== 'retreat', approachBarriers: state === 'investigate' }) };
  }
  resumeRoute(target, now) {
    let probe = this.routeProbe;
    if (probe && (probe.state !== this.entity.state || !probe.search.valid(this.world) || goalDistance(target, probe.search.target) > 1.3 || now - probe.at > 3)) probe = null;
    if (!probe) probe = this.beginRoute(target, now);
    this.routeProbe = probe; probe.updates++;
    const status = probe.search.step(this);
    if (status === 'pending' && probe.updates < MAX_SPAWN_ROUTE_UPDATES) { this.activity = 'Verifying an approach route'; return false; }
    this.path = probe.search.path(this); this.pathGoal = copyPoint(target);
    this.verifiedApproach = status === 'reached';
    // A watched withdrawal can outlive the encounter. Its complete detour must
    // remain usable while repeated escape scoring returns the same goal.
    const completeUntil = this.entity.state === 'retreat' ? now + 75 : this.entity.encounterUntil;
    this.pathAt = this.verifiedApproach ? completeUntil : now + 1;
    this.routeProbe = null; return true;
  }
  move(target, speed, now) {
    const e = this.entity;
    if (!Number.isFinite(speed) || speed <= 0) return;
    if (this.pathGoal && goalDistance(target, this.pathGoal) > 1.3) { this.pathAt = 0; this.verifiedApproach = false; }
    if (now >= this.pathAt) {
      if (e.state === 'investigate' || this.routeProbe) { if (!this.resumeRoute(target, now)) return; }
      else { this.routeProbe = null; this.verifiedApproach = false; this.path = this.route(target); this.pathAt = now + 1; this.pathGoal = copyPoint(target); }
    }
    if (!this.path.length) {
      // A short partial search can reach a local dead end even when a longer
      // walking detour exists. Retain a bounded search instead of repeating
      // that same empty prefix every update. Only investigation can use a
      // pressure barrier as its goal; pursuit/withdrawal require walkable paths.
      if (e.state !== 'investigate' && !this.routeProbe) this.routeProbe = this.beginRoute(target, now);
      this.pathAt = 0; this.activity = 'No clear route'; return;
    }
    let remaining = speed * this.stepSeconds;
    for (let segment = 0; segment < MAX_MOVE_SEGMENTS && this.path.length && remaining > 1e-8; segment++) {
      const next = this.path[0], length = distance(e, next);
      if (length < 1e-8 && Math.abs(e.y - next.y) < .02) { this.path.shift(); continue; }
      const amount = Math.min(length, remaining), start = copyPoint(e), steps = Math.max(1, Math.ceil(amount / .2));
      // Check the sweep as well as the endpoint, including thin swung panels.
      // Each leg gets its own checks; distance carries through corners, never
      // diagonally across them. World/read budgets remain shared with routing.
      for (let step = 1; step <= steps; step++) {
        const progress = length > 1e-8 ? amount / length * step / steps : 1;
        const candidate = this.pointOnRoute(e, next, start.x + (next.x - start.x) * progress, start.z + (next.z - start.z) * progress);
        const shelterBlocked = candidate && e.state !== 'retreat' && this.entryBlocked(candidate);
        if (!candidate || shelterBlocked) {
          // Earlier sweep samples may already have entered a low ceiling.
          // Publish posture for the last accepted position even when the leg
          // stops before its waypoint (including exhausted read budgets).
          e.crouched = !this.fits(e.x, e.y, e.z, LISTENER_STANDING_HEIGHT);
          this.activity = shelterBlocked ? 'Checking shelter' : 'Path obstructed';
          this.path = []; this.pathAt = now + .6; this.verifiedApproach = false; return;
        }
        const travelled = distance(e, candidate);
        e.yaw = Math.atan2(e.x - candidate.x, e.z - candidate.z); Object.assign(e, candidate);
        this.stride += travelled;
        const footfalls = Math.floor(this.stride / .9); if (footfalls) { this.stride %= .9; e.stepSeq += footfalls; }
      }
      remaining -= amount;
      this.activity = e.state === 'retreat' ? 'Moving away' : 'Following route';
      e.crouched = !this.fits(e.x, e.y, e.z, LISTENER_STANDING_HEIGHT) || !this.fits(next.x, next.y, next.z, LISTENER_STANDING_HEIGHT);
      if (length <= amount + 1e-8) this.path.shift();
      else break;
    }
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
      this.mind.focusKey = keyOf(seen); this.director.focus(keyOf(seen), now);
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
      const hidden = !players.some(player => this.inPlayerView(p, player));
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
      { action: 'pressure', allowed: !!barrier && !barrier.detour && permission.breach && confidence > .15, score: 1.15, reason: 'Nearby unprotected barrier; breach allowance available' },
      { action: 'investigate', allowed: !!fact && fact.kind === 'sound' && !this.memory.searched(fact.point) && !this.memory.blocked(fact.point, now), score: .55 + confidence * .3, reason: 'Following remembered sound' },
      { action: 'search', allowed: !!fact && !seen, score: .5 + confidence * .2, reason: 'Searching around last evidence; player location unknown' },
      { action: 'listen', allowed: true, score: .12, reason: 'Pausing to listen for fresh evidence' },
    ];
    this.scores = candidates.filter(c => c.allowed).map(c => ({ action: c.action, score: Math.round(c.score * 100) }));
    const choice = chooseListenerAction(candidates, e.state, now - this.mind.actionAt, () => this.director.random());
    if (fact?.key) { this.mind.focusKey = fact.key; this.director.focus(fact.key, now); }
    this.decision = choice.reason; this.setState(choice.action, now); this.mind.decideAt = now + 1;
  }
  advance(seconds, players) {
    if (!Number.isFinite(seconds) || seconds <= 0) return false;
    const present = players.filter(p => point(p.pose, this.world.size || SIZE)).slice(0, 8), eligible = present.filter(p => p.vulnerable !== false);
    this.elapsed += seconds; this.pendingSeconds += seconds;
    if (this.elapsed < LISTENER_INTERVAL) return false;
    this.elapsed %= LISTENER_INTERVAL;
    // Keep the existing bounded update cadence, but move for the actual time
    // since the previous executed update. The cadence remainder has already
    // contributed to that move and must not be counted again next time.
    this.stepSeconds = Math.min(MAX_LISTENER_STEP, this.pendingSeconds); this.pendingSeconds = 0;
    const { elapsedSeconds: now, phase } = this.clock(), e = this.entity, m = this.mind;
    this.lastNodes = this.lastReads = this.lastSenseSteps = this.lastCandidates = 0;
    if (this.revision !== this.world.serial) {
      this.revision = this.world.serial;
      // A completed approach is swept again as it is walked. Distant edits or
      // streaming must not throw away a useful detour; a real obstruction,
      // ward boundary, or target change still cancels it immediately.
      if (!this.verifiedApproach) this.pathAt = 0;
      this.memory.state.failed = [];
    }
    this.observe(eligible, now); this.noises = this.noises.filter(n => now - n.at <= 10); this.memory.advance(now);
    const night = phase >= .52 && phase < .94, grace = now < LISTENER_GRACE;
    const active = e.state !== 'dormant', retiring = e.state === 'retreat';
    const grounded = !active || this.settle(), groundActivity = this.activity;
    if (!grounded) { this.strikeTarget = null; this.pressure?.reset(); }
    const seen = active && !retiring && grounded ? this.perceive(eligible, now) : null;
    const fact = this.memory.best(now), team = present.map(p => ({ ...p, distance: distance(e, p.pose), exposed: !this.entryBlocked(p.pose) }));
    const sources = new Map(team.map(p => [p.id, p]));
    // A protected/recovering teammate's louder work cannot monopolize arrival
    // attempts while an exposed teammate is active elsewhere. Existing actors
    // still hear every physical noise through perceive(); this only chooses a
    // viable anchor for a new encounter, using authoritative shelter state.
    const canAnchor = n => {
      if (n.radius < 18) return false;
      const source = sources.get(n.source);
      return source?.vulnerable !== false && !this.entryBlocked(n);
    };
    const priority = n => Number(sources.get(n.source)?.exposed || false);
    const freshNoise = this.noises.filter(canAnchor).sort((a, b) => priority(b) - priority(a) || b.radius - a.radius || b.at - a.at)[0];
    this.director.advance(now, team,
      { night, grace, active, retiring, evidence: !!freshNoise || !!fact, seen: !!seen, distance: seen ? distance(e, seen.pose) : Infinity, pressing: e.state === 'pressure' });
    const permission = this.director.permissions(now);
    if (e.state === 'dormant') {
      if (this.spawnProbe && !canAnchor(this.spawnProbe.noise)) this.spawnProbe = null;
      if (!night || grace || !eligible.length || !permission.presence) this.spawnProbe = null;
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
      if (now >= e.stateUntil && !present.some(p => this.inPlayerView(e, p))) this.setState('dormant', now);
      else if (!grounded) this.activity = groundActivity;
      else {
        if (now >= e.stateUntil && now >= m.goalAt) { e.home = this.retreatPosition(present, now); m.goalAt = now + 3; }
        if (e.home) this.move(e.home, 1.7, now);
        if (!m.progress || distance(e, m.progress) > .3) { m.progress = copyPoint(e); m.progressAt = now; }
        else if (now - m.progressAt >= 3) { if (e.home) this.memory.fail(e.home, now); m.goalAt = 0; m.progressAt = now; }
      }
      return true;
    }
    if (!grounded) { this.activity = groundActivity; return true; }
    if (!fact && now - m.actionAt > 4) { this.decision = 'Evidence expired'; this.setState('retreat', now); return true; }
    const barrier = fact && this.pressure?.candidate(e, fact.point);
    if (barrier && now >= m.decideAt) {
      const detour = this.route(fact.point, e, { requireComplete: true }), end = detour.at(-1);
      barrier.detour = !!end && goalDistance(end, fact.point) < 2 && detour.length / 1.6 < barrier.hits * PRESSURE_INTERVAL;
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
      const trace = touching && this.trace({ x: e.x, y: e.y + .9, z: e.z }, { ...seen.pose, y: seen.pose.y + .9 }, { physical: true });
      if (touching && !trace.unloaded && !trace.barriers) {
        if (this.strikeTarget !== seen.id) { this.strikeTarget = seen.id; this.strikeAt = now + .9; this.cue('breath', now); }
        this.activity = 'Reaching for player'; e.yaw = Math.atan2(e.x - seen.pose.x, e.z - seen.pose.z); m.progressAt = now;
        if (now >= this.strikeAt && this.contact(seen.id)) { this.director.knockdown(keyOf(seen), now); this.decision = 'Successful contact: group recovery'; this.setState('retreat', now); return true; }
      } else {
        this.strikeTarget = null;
        const obstructed = touching && (trace.unloaded || trace.barriers);
        if (e.target && (distance(e, e.target) > 1 || Math.abs(e.y - e.target.y) >= 1.2 || obstructed)) {
          this.move(e.target, now < m.warningUntil ? 1.2 : now < m.burstUntil ? 5.4 : 2.6, now); moving = true;
        }
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
