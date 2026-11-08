export const NAV_NODE_BUDGET = 96;
export const NAV_READ_BUDGET = 4096;
export const MAX_SPAWN_ROUTE_NODES = 768;
export const MAX_SPAWN_ROUTE_UPDATES = 12;
export const MAX_MOVE_SEGMENTS = 8;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const estimate = (a, b) => distance(a, b) + Math.abs(a.y - b.y);
// Reserve enough reads to finish all four edges before removing a frontier
// node. A budget yield must not silently discard its unvisited neighbors.
const EXPANSION_READ_RESERVE = 256;
const copy = p => ({ x: p.x, y: p.y, z: p.z });

// One slice shares the actor's existing work budget. Spawn checks, sound
// approaches, and stalled walking detours retain the frontier across updates;
// ordinary movement can use partial paths while keeping each update bounded.
export class ListenerRouteSearch {
  constructor(origin, target, { guarded = false, approachBarriers = false, maxExpanded = MAX_SPAWN_ROUTE_NODES } = {}) {
    this.origin = copy(origin); this.target = copy(target); this.guarded = guarded; this.approachBarriers = approachBarriers; this.maxExpanded = maxExpanded;
    this.start = { x: Math.floor(origin.x) + .5, y: origin.y, z: Math.floor(origin.z) + .5, parent: null, cost: 0 };
    this.open = [this.start]; this.seen = new Map([[`${this.start.x},${this.start.y},${this.start.z}`, 0]]);
    this.best = this.start; this.expanded = 0; this.status = 'pending'; this.barrier = null;
    this.dependencies = new Map(); this.epoch = undefined; this.serial = undefined;
  }
  track(x, y, z, world) {
    const key = `${Math.floor(x / 16)},${Math.floor(y / 4)},${Math.floor(z / 16)}`;
    if (!this.dependencies.has(key)) this.dependencies.set(key, world.shelterRevisions?.get(key) || 0);
  }
  valid(world) {
    if (this.epoch === undefined) return true;
    if (!this.epoch || !this.guarded) return this.serial === world.serial;
    return this.epoch === world.shelterRevisions && [...this.dependencies].every(([key, revision]) => (world.shelterRevisions.get(key) || 0) === revision);
  }
  step(navigator) {
    if (this.status !== 'pending') return this.status;
    if (this.epoch === undefined) { this.epoch = navigator.world.shelterRevisions || null; this.serial = navigator.world.serial; }
    const previousSearch = navigator.activeRouteSearch;
    if (this.guarded) navigator.activeRouteSearch = this;
    try { return this.expand(navigator); } finally { navigator.activeRouteSearch = previousSearch; }
  }
  expand(navigator) {
    const deadline = performance.now() + 2;
    while (this.open.length && this.expanded < this.maxExpanded && navigator.lastNodes < NAV_NODE_BUDGET
      && navigator.lastReads <= NAV_READ_BUDGET - EXPANSION_READ_RESERVE && performance.now() <= deadline) {
      let next = 0;
      for (let i = 1; i < this.open.length; i++) if (this.open[i].cost + estimate(this.open[i], this.target) < this.open[next].cost + estimate(this.open[next], this.target)) next = i;
      const node = this.open.splice(next, 1)[0]; this.expanded++; navigator.lastNodes++;
      if (estimate(node, this.target) < estimate(this.best, this.target)) this.best = node;
      if (distance(node, this.target) < .8 && Math.abs(node.y - this.target.y) < 1.25) { this.best = node; this.status = 'reached'; return this.status; }
      // Loud indoor activity can end the approach at an eligible barrier. The
      // walk to this node must still be complete; closed doors are never
      // traversed by the proof or by ordinary movement. Use the same bounded
      // pressure query and protection rules as the active encounter.
      if (this.approachBarriers) {
        const barrier = navigator.pressure?.candidate(node, this.target, { read: (x, y, z) => navigator.read(x, y, z) });
        if (barrier) { this.best = node; this.barrier = barrier; this.status = 'reached'; return this.status; }
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const p = navigator.ground(node.x + dx, node.z + dz, node.y);
        if (!p || distance(p, this.start) > 28) continue;
        const id = `${p.x},${p.y},${p.z}`, cost = node.cost + 1;
        if ((this.seen.get(id) ?? Infinity) <= cost) continue;
        // Endpoints alone miss a swung door panel between adjacent centers.
        const middle = navigator.pointOnRoute(node, p, (node.x + p.x) / 2, (node.z + p.z) / 2);
        if (!middle || this.guarded && (navigator.entryBlocked(p) || navigator.entryBlocked(middle))) continue;
        this.seen.set(id, cost); this.open.push({ ...p, cost, parent: node });
      }
    }
    if (!this.open.length || this.expanded >= this.maxExpanded) this.status = 'blocked';
    return this.status;
  }
  path(navigator) {
    const path = []; let node = this.best;
    while (node.parent) { path.unshift(copy(node)); node = node.parent; }
    // Align only the perpendicular axis before a turn, retaining progress on
    // straight sections when a new plan starts between cell centers.
    const next = path[0], e = this.origin;
    if (next) {
      const align = next.x !== this.start.x ? { x: e.x, y: e.y, z: this.start.z } : { x: this.start.x, y: e.y, z: e.z };
      if (distance(e, align) > .02 && navigator.fits(align.x, align.y, align.z)) path.unshift(align);
    }
    return path;
  }
}
