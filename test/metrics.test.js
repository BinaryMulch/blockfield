import test from 'node:test';
import assert from 'node:assert/strict';
import { TimingWindow, FrameMetrics } from '../src/metrics.js';
import { cpuPercent, ServerMetrics } from '../server/metrics.js';
import { createGameServer } from '../server.js';

test('timings stay bounded, retain chronological spikes, and calculate nearest-rank percentiles', () => {
  const samples = new TimingWindow(20);
  for (let i = 1; i <= 30; i++) samples.add(i);
  samples.add(NaN); samples.add(-1); samples.add(Infinity);
  assert.deepEqual(samples.ordered(), Array.from({ length: 20 }, (_, i) => i + 11));
  assert.deepEqual(samples.summary(), { count: 20, total: 30, mean: 20.5, p95: 29, max: 30, last: 30 });
  samples.reset();
  assert.equal(samples.summary().mean, null);
  assert.equal(samples.summary().total, 0);
});

test('frame FPS uses actual intervals, keeps long stalls, and resets across paused sampling', () => {
  const frames = new FrameMetrics();
  frames.add(100, 102); frames.add(120, 123); frames.add(140, 144);
  assert.equal(frames.summary().fps, 50);
  assert.equal(frames.summary().workMs.mean, 3);
  frames.add(440, 445);
  assert.equal(frames.summary().frameMs.max, 300);
  frames.reset(); frames.add(10000, 10002);
  assert.equal(frames.summary().fps, null);
  frames.add(10010, 10012);
  assert.equal(frames.summary().fps, 100);
});

test('server CPU is normalized to one core and allows multicore process usage', () => {
  assert.equal(cpuPercent({ user: 400000, system: 100000 }, 1000), 50);
  assert.equal(cpuPercent({ user: 1000000, system: 500000 }, 1000), 150);
  assert.equal(cpuPercent({ user: 100, system: 100 }, 0), 0);
});

test('FPS measures rendered frames while main work includes callbacks skipped by the cap', () => {
  const frames = new FrameMetrics();
  frames.add(0, 3, true);
  frames.add(16, 17, false);
  frames.add(32, 35, true);
  frames.add(48, 49, false);
  frames.add(64, 67, true);
  assert.equal(frames.summary().fps, 31.25);
  assert.equal(frames.summary().frameMs.count, 2);
  assert.equal(frames.summary().workMs.count, 5);
  assert.equal(frames.summary().workMs.mean, 2.2);
});

test('server sampler measures process activity rather than presenting loop activity as CPU', () => {
  const metrics = new ServerMetrics();
  try {
    const end = performance.now() + 20;
    while (performance.now() < end) { /* Exercise actual process CPU counters. */ }
    metrics.sample();
    const result = metrics.snapshot();
    assert.ok(result.cpuPercent > 0);
    assert.ok(result.intervalMs >= 20);
    assert.ok(result.memory.rss > 0);
    assert.ok(result.eventLoopPercent >= 0 && result.eventLoopPercent <= 100);
  } finally { metrics.close(); }
});

test('performance endpoint supplies bounded diagnostics without joining or caching a world', async () => {
  const game = await createGameServer({ host: '127.0.0.1', port: 0 });
  try {
    const initialChunks = game.room.world.chunks.size;
    const response = await fetch(`http://127.0.0.1:${game.server.address().port}/api/performance`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.equal(result.version, 1);
    assert.equal(result.players, 0); assert.equal(result.loadedChunks, initialChunks); assert.ok(result.loadedChunks <= 16);
    assert.equal(result.saving, false); assert.equal(result.saveHealthy, true);
    assert.ok(result.memory.rss > 0);
    assert.equal(result.saveMs.last, null);
    assert.equal(result.world, undefined); assert.equal(result.environment, undefined);
  } finally { await game.close(); }
});
