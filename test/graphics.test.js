import test from 'node:test';
import assert from 'node:assert/strict';
import { graphicsSettings, renderPixelRatio, FrameLimiter } from '../src/graphics.js';

test('graphics defaults favor lower rendering work on mobile and validate saved values', () => {
  assert.deepEqual(graphicsSettings(null), { version: 1, fps: 60, resolution: 1 });
  assert.deepEqual(graphicsSettings(null, true), { version: 1, fps: 30, resolution: 0.75 });
  assert.deepEqual(graphicsSettings({ version: 1, fps: 120, resolution: 0.5 }, true), { version: 1, fps: 120, resolution: 0.5 });
  assert.deepEqual(graphicsSettings({ version: 1, fps: '120', resolution: Infinity }), graphicsSettings(null));
  assert.deepEqual(graphicsSettings({ version: 2, fps: 120, resolution: 0.5 }), graphicsSettings(null));
});

test('resolution scales drawing dimensions and retains the existing device-ratio ceiling', () => {
  assert.equal(renderPixelRatio(3, 1), 2);
  assert.equal(renderPixelRatio(3, 0.75), 1.5);
  assert.equal(renderPixelRatio(2, 0.5), 1);
  assert.equal(renderPixelRatio(1, 0.5), 0.5);
  assert.equal(renderPixelRatio(NaN, 1), 1);
  assert.equal(renderPixelRatio(2, -10), 2);
});

test('FPS pacing holds its target across common refresh rates without exceeding the display rate', () => {
  for (const refresh of [30, 60, 90, 120, 144, 165]) for (const cap of [30, 60, 120]) {
    const limiter = new FrameLimiter(cap);
    let count = 0;
    for (let i = 0; i < refresh * 10; i++) if (limiter.allow(i * 1000 / refresh)) count++;
    const target = Math.min(refresh, cap) * 10;
    assert.ok(Math.abs(count - target) <= 1, `${refresh}Hz / ${cap}FPS: ${count}`);
  }
});

test('a long stall does not cause catch-up renders, and settings changes reset pacing', () => {
  const limiter = new FrameLimiter(30);
  assert.equal(limiter.allow(0), true);
  assert.equal(limiter.allow(10), false);
  assert.equal(limiter.allow(1000), true);
  assert.equal(limiter.allow(1001), false);
  assert.equal(limiter.allow(1016.67), false);
  assert.equal(limiter.allow(1033.34), true);
  limiter.setFPS(60);
  assert.equal(limiter.allow(1034), true);
  assert.equal(limiter.allow(1040), false);
});

test('small refresh timestamp jitter does not alternate long and short intervals at a 30 FPS cap', () => {
  const limiter = new FrameLimiter(30), rendered = [];
  for (let i = 0; i < 120; i++) if (limiter.allow(i * 1000 / 60 + (i % 3 - 1) * 0.2)) rendered.push(i);
  assert.equal(rendered.length, 60);
  assert.ok(rendered.slice(1).every((index, i) => index - rendered[i] === 2));
});
