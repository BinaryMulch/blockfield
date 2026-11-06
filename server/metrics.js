import { performance } from 'node:perf_hooks';
import { TimingWindow } from '../src/metrics.js';

// 100% means one logical CPU core; this can exceed 100% with native worker activity.
export function cpuPercent(usage, elapsedMs) { return elapsedMs > 0 ? (usage.user + usage.system) / (elapsedMs * 10) : 0; }

export class ServerMetrics {
  tick = new TimingWindow(120);
  saves = new TimingWindow(60);
  constructor() {
    this.previousTime = performance.now();
    this.previousCPU = process.cpuUsage();
    this.previousLoop = performance.eventLoopUtilization();
    this.current = null;
    this.timer = setInterval(() => this.sample(), 1000);
    this.timer.unref();
  }
  sample() {
    const now = performance.now(), cpu = process.cpuUsage(), loop = performance.eventLoopUtilization();
    const intervalMs = now - this.previousTime;
    this.current = { cpuPercent: cpuPercent({ user: cpu.user - this.previousCPU.user, system: cpu.system - this.previousCPU.system }, intervalMs),
      eventLoopPercent: performance.eventLoopUtilization(loop, this.previousLoop).utilization * 100,
      intervalMs, sampledAt: Date.now() };
    this.previousTime = now; this.previousCPU = cpu; this.previousLoop = loop;
  }
  snapshot() {
    const memory = process.memoryUsage();
    return { ...this.current, uptimeSeconds: process.uptime(), memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal },
      tickMs: this.tick.summary(), saveMs: this.saves.summary() };
  }
  close() { clearInterval(this.timer); }
}
