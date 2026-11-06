import { TimingWindow } from './metrics.js';

export class WorldJobs {
  nextId = 0;
  pending = new Map();
  timings = new Map();

  constructor() {
    this.worker = new Worker(new URL('./world-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (!data.error && Number.isFinite(data.workMs)) {
        if (!this.timings.has(pending.kind)) this.timings.set(pending.kind, { work: new TimingWindow(60), turnaround: new TimingWindow(60) });
        const timing = this.timings.get(pending.kind);
        timing.work.add(data.workMs); timing.turnaround.add(performance.now() - pending.started);
      }
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data);
    };
    this.worker.onerror = () => {
      for (const pending of this.pending.values()) pending.reject(new Error('The terrain worker could not start. Reload to try again.'));
      this.pending.clear();
    };
  }

  call(job, transfer = []) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, kind: job.kind, started: performance.now() });
      this.worker.postMessage({ id, ...job }, transfer);
    });
  }

  stats(kind) {
    const timing = this.timings.get(kind);
    return { pending: [...this.pending.values()].filter(job => job.kind === kind).length,
      workMs: timing?.work.summary() || null, turnaroundMs: timing?.turnaround.summary() || null };
  }

  dispose() {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error('World closed'));
    this.pending.clear();
  }
}
