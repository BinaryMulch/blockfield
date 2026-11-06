// Wheels step once per notch; small trackpad deltas accumulate into a step.
export class HotbarScroll {
  delta = 0;
  lastTime = -Infinity;

  reset() { this.delta = 0; this.lastTime = -Infinity; }

  update(event, now) {
    const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!Number.isFinite(raw) || raw === 0) return 0;
    const delta = raw * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 120 : 1);
    if (now - this.lastTime > 180 || Math.sign(delta) !== Math.sign(this.delta)) this.delta = 0;
    this.lastTime = now;
    this.delta += delta;
    if (Math.abs(this.delta) < 40) return 0;
    this.delta = 0;
    return Math.sign(delta);
  }
}
