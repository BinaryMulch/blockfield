export const DIRECTOR_INTERVAL = 1;
export const DIRECTOR_PHASES = ['quiet', 'unease', 'pressure', 'peak', 'release'];
export const MAX_DIRECTOR_PLAYERS = 64;
export const ENCOUNTER_BUDGET = 20;
export const MAX_PRESSURE_HITS = 6;
const clamp = n => Math.max(0, Math.min(1, n));
const time = n => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const keyOf = p => p.key || p.id;
const reason = s => typeof s === 'string' && s.length <= 160;

export function validDirector(s) {
  if (s === undefined) return true;
  if (!s || s.version !== 1 || !DIRECTOR_PHASES.includes(s.phase) || ![s.phaseAt, s.quietUntil, s.nextAt].every(time)
    || !Number.isInteger(s.rng) || s.rng < 1 || s.rng > 4294967295 || !Number.isFinite(s.budget) || s.budget < 0 || s.budget > ENCOUNTER_BUDGET
    || !Number.isInteger(s.hits) || s.hits < 0 || s.hits > MAX_PRESSURE_HITS || !reason(s.reason)
    || !Array.isArray(s.players) || s.players.length > MAX_DIRECTOR_PLAYERS || !Array.isArray(s.history) || s.history.length > 16) return false;
  const keys = new Set();
  return s.players.every(p => {
    if (!p || typeof p.key !== 'string' || !/^[\w-]{1,80}$/.test(p.key) || keys.has(p.key) || ![p.at, p.targetAt].every(time)
      || !Number.isFinite(p.pressure) || p.pressure < 0 || p.pressure > 1 || typeof p.downed !== 'boolean') return false;
    keys.add(p.key); return true;
  }) && s.history.every(h => h && DIRECTOR_PHASES.includes(h.phase) && time(h.at) && reason(h.reason));
}

// The director sees encounter outcomes, not a secret target location. Decisions
// and random state use occupied simulation time and survive save/rejoin.
export class TensionDirector {
  constructor({ now = 0, saved, seed = 71831 } = {}) {
    this.state = saved ? structuredClone(saved) : { version: 1, phase: 'quiet', phaseAt: now, quietUntil: now + 18, nextAt: now,
      rng: (seed >>> 0) || 1, budget: ENCOUNTER_BUDGET, hits: 0, reason: 'Starting breathing room', players: [], history: [] };
    this.updates = 0;
  }
  snapshot() { return structuredClone(this.state); }
  random() { let n = this.state.rng; n ^= n << 13; n ^= n >>> 17; n ^= n << 5; this.state.rng = (n >>> 0) || 1; return this.state.rng / 4294967296; }
  setPhase(phase, now, reason) {
    const s = this.state; if (s.phase === phase) return;
    s.phase = phase; s.phaseAt = now; s.reason = reason;
    s.history.push({ phase, at: now, reason }); if (s.history.length > 16) s.history.shift();
    if (phase === 'unease') { s.budget = ENCOUNTER_BUDGET; s.hits = 0; }
    if (phase === 'quiet') s.quietUntil = now + 45 + this.random() * 20;
  }
  player(key, now) {
    let p = this.state.players.find(p => p.key === key);
    if (!p) {
      if (this.state.players.length >= MAX_DIRECTOR_PLAYERS) this.state.players.sort((a, b) => a.at - b.at).shift();
      p = { key, at: now, targetAt: 0, pressure: 0, downed: false }; this.state.players.push(p);
    }
    return p;
  }
  targetPenalty(key, now) { const p = this.state.players.find(p => p.key === key); return p?.targetAt ? clamp(1 - (now - p.targetAt) / 90) * .28 : 0; }
  focus(key, now) { if (key) this.player(key, now).targetAt = now; }
  spend(kind, now, key) {
    const s = this.state, cost = kind === 'burst' ? 4 : kind === 'hit' ? 2 : 0;
    if (s.budget < cost || kind === 'hit' && s.hits >= MAX_PRESSURE_HITS) return false;
    s.budget -= cost; if (kind === 'hit') s.hits++;
    if (key) this.player(key, now).pressure = Math.min(1, this.player(key, now).pressure + (kind === 'hit' ? .08 : .12));
    return true;
  }
  knockdown(key, now) {
    if (key) { const p = this.player(key, now); p.pressure = 1; p.downed = true; }
    this.setPhase('release', now, 'Knockdown: let the group recover');
  }
  permissions(now) {
    const s = this.state;
    return { presence: ['unease', 'pressure', 'peak'].includes(s.phase), pursue: s.phase === 'peak' && s.budget >= 0,
      breach: ['pressure', 'peak'].includes(s.phase) && s.budget >= 2 && s.hits < MAX_PRESSURE_HITS,
      burst: s.phase === 'peak' && s.budget >= 4, rest: s.phase === 'quiet' || s.phase === 'release', at: now };
  }
  advance(now, players, { night, grace, active, retiring, evidence = false, seen = false, distance = Infinity, pressing = false } = {}) {
    const s = this.state;
    // Recovery overrides are immediate, even between one-second pacing updates.
    const newlyDown = players.find(p => p.downed && !s.players.find(r => r.key === keyOf(p))?.downed);
    if (newlyDown) this.knockdown(keyOf(newlyDown), now);
    if (now < s.nextAt) return false;
    this.updates++; s.nextAt = now + DIRECTOR_INTERVAL;
    for (const player of players.slice(0, 8)) {
      const p = this.player(keyOf(player), now), dt = Math.min(2, Math.max(0, now - p.at)); p.at = now; p.downed = !!player.downed;
      const engaged = active && !retiring && player.exposed && player.distance < 14;
      p.pressure = clamp(p.pressure + dt * (engaged ? .025 : -.035));
    }
    const pressure = Math.max(0, ...players.map(p => s.players.find(r => r.key === keyOf(p))?.pressure || 0));
    // Relief begins when the threat has left, even during daylight or player
    // immunity. Those conditions prevent escalation, not the passage of rest.
    if (s.phase === 'release' && !active) { this.setPhase('quiet', now, 'Threat has left: begin actual rest'); return true; }
    if (!night || grace || !players.some(p => p.vulnerable !== false)) {
      if (active && !retiring) this.setPhase('release', now, !night ? 'Daylight' : 'Starting or recovery grace');
      return true;
    }
    const age = now - s.phaseAt;
    if (s.phase === 'quiet' && now >= s.quietUntil && (evidence || now >= s.quietUntil + 60 && players.some(p => p.exposed))) this.setPhase('unease', now, evidence ? 'Fresh activity after breathing room' : 'Distant presence after a long quiet');
    else if (s.phase === 'unease') {
      if (active && age >= 4) this.setPhase('pressure', now, 'Presence established');
      else if (!active && age > 15) this.setPhase('release', now, 'No safe encounter opportunity');
    } else if (s.phase === 'pressure') {
      if (pressure >= .85 || s.budget < 2 || age >= 30) this.setPhase('release', now, 'Pressure allowance reached');
      else if (seen && distance < 14 && age >= 3 && !pressing) this.setPhase('peak', now, 'Confirmed discovery after warning period');
      else if (!active && age > 5) this.setPhase('release', now, 'Encounter ended');
    } else if (s.phase === 'peak' && (pressure >= .9 || age >= 14 || s.budget < 2 || !active)) this.setPhase('release', now, 'Peak complete');
    return true;
  }
  diagnostics(now) {
    const s = this.state;
    return { phase: s.phase, reason: s.reason, budget: s.budget, hits: s.hits, maxPressure: Math.round(Math.max(0, ...s.players.map(p => p.pressure)) * 100),
      quietSeconds: Math.max(0, Math.ceil(s.quietUntil - now)), updates: this.updates };
  }
}
