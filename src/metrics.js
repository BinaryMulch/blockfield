// Bounded samples: diagnostics must not grow with the length of a play session.
export class TimingWindow {
  constructor(capacity = 120) { this.capacity = capacity; this.reset(); }
  reset() { this.values = []; this.cursor = 0; this.total = 0; }
  add(value) {
    if (!Number.isFinite(value) || value < 0) return;
    this.total++;
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
  }
  ordered() { return this.values.length < this.capacity ? [...this.values] : [...this.values.slice(this.cursor), ...this.values.slice(0, this.cursor)]; }
  summary() {
    const sorted = [...this.values].sort((a, b) => a - b), count = sorted.length;
    return { count, total: this.total, mean: count ? sorted.reduce((a, b) => a + b, 0) / count : null,
      p95: count ? sorted[Math.ceil(count * 0.95) - 1] : null, max: count ? sorted[count - 1] : null,
      last: count ? this.values[(this.cursor + count - 1) % count] : null };
  }
}

export class FrameMetrics {
  intervals = new TimingWindow(240);
  work = new TimingWindow(240);
  reset() { this.previous = null; this.intervals.reset(); this.work.reset(); }
  add(start, end, rendered = true) {
    if (rendered) {
      if (this.previous != null && start > this.previous) this.intervals.add(start - this.previous);
      this.previous = start;
    }
    this.work.add(end - start);
  }
  summary() {
    const frame = this.intervals.summary();
    return { fps: frame.mean > 0 ? 1000 / frame.mean : null, frameMs: frame, workMs: this.work.summary() };
  }
}
