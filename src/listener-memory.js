export const MAX_MEMORIES = 8;
export const MAX_SEARCHED = 12;
export const MAX_FAILED_ROUTES = 8;
const time = n => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const point = (p, size) => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k])) && p.x >= 0 && p.x < size && p.z >= 0 && p.z < size && p.y >= 0 && p.y < 24;
const copy = p => ({ x: p.x, y: p.y, z: p.z });
export function validMemory(s, size) {
  if (s === undefined) return true;
  return !!s && s.version === 1 && Array.isArray(s.facts) && s.facts.length <= MAX_MEMORIES
    && s.facts.every(f => f && ['sound', 'sight'].includes(f.kind) && point(f.point, size) && time(f.at) && Number.isFinite(f.confidence) && f.confidence >= 0 && f.confidence <= 1
      && (f.key === null || typeof f.key === 'string' && /^[\w-]{1,80}$/.test(f.key)) && f.direction && ['x', 'z'].every(k => Number.isFinite(f.direction[k]) && Math.abs(f.direction[k]) <= 1))
    && Array.isArray(s.searched) && s.searched.length <= MAX_SEARCHED && s.searched.every(p => point(p, size))
    && Array.isArray(s.failed) && s.failed.length <= MAX_FAILED_ROUTES && s.failed.every(f => f && point(f.point, size) && time(f.until));
}
export class ListenerMemory {
  constructor(saved) { this.state = saved ? structuredClone(saved) : { version: 1, facts: [], searched: [], failed: [] }; }
  snapshot() { return structuredClone(this.state); }
  remember(kind, point, at, confidence, key = null) {
    const previous = this.state.facts.find(f => f.kind === kind && f.key === key);
    if (previous && previous.at >= at) return previous;
    let direction = { x: 0, z: 0 };
    if (kind === 'sight' && previous && at - previous.at < 2) {
      const dx = point.x - previous.point.x, dz = point.z - previous.point.z, length = Math.hypot(dx, dz);
      if (length > .05 && length <= (at - previous.at) * 12 + .2) direction = { x: dx / length, z: dz / length };
      else direction = previous.direction;
    }
    const record = { kind, point: copy(point), at, confidence, key, direction };
    if (previous) this.state.facts.splice(this.state.facts.indexOf(previous), 1);
    this.state.facts.unshift(record); this.state.facts.length = Math.min(MAX_MEMORIES, this.state.facts.length);
    this.state.searched = []; return record;
  }
  confidence(f, now) { return f.confidence * Math.max(0, 1 - Math.max(0, now - f.at) / (f.kind === 'sight' ? 18 : 22)); }
  best(now) { return this.state.facts.reduce((best, f) => this.confidence(f, now) > (best ? this.confidence(best, now) : .05) ? f : best, null); }
  advance(now) { this.state.facts = this.state.facts.filter(f => this.confidence(f, now) > .05); this.state.failed = this.state.failed.filter(f => f.until > now); }
  searched(p) { return this.state.searched.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 1.3 && Math.abs(q.y - p.y) < 1); }
  visit(p) { this.state.searched.push(copy(p)); if (this.state.searched.length > MAX_SEARCHED) this.state.searched.shift(); }
  blocked(p, now) { return this.state.failed.some(f => f.until > now && Math.hypot(f.point.x - p.x, f.point.z - p.z) < 1 && Math.abs(f.point.y - p.y) < 1); }
  fail(p, now) { if (!this.blocked(p, now)) this.state.failed.push({ point: copy(p), until: now + 8 }); if (this.state.failed.length > MAX_FAILED_ROUTES) this.state.failed.shift(); }
}
