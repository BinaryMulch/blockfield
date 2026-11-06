import test from 'node:test';
import assert from 'node:assert/strict';
import { graphicsSettings, renderPixelRatio, FrameLimiter, GraphicsSettings, fogDistances, FOG_LEVELS } from '../src/graphics.js';

test('graphics defaults favor lower rendering work on mobile and validate saved values', () => {
  assert.deepEqual(graphicsSettings(null), { version: 1, fps: 60, resolution: 1, fog: 'light' });
  assert.deepEqual(graphicsSettings(null, true), { version: 1, fps: 30, resolution: 0.75, fog: 'light' });
  assert.deepEqual(graphicsSettings({ version: 1, fps: 120, resolution: 0.5 }, true), { version: 1, fps: 120, resolution: 0.5, fog: 'light' });
  assert.deepEqual(graphicsSettings({ version: 1, fps: '120', resolution: Infinity }), graphicsSettings(null));
  assert.deepEqual(graphicsSettings({ version: 2, fps: 120, resolution: 0.5 }), graphicsSettings(null));
});

test('fog settings preserve old preferences and stay inside rendered terrain unless disabled', () => {
  for (const fog of FOG_LEVELS) {
    assert.equal(graphicsSettings({ version: 1, fog }).fog, fog);
    const [near, far] = fogDistances(fog);
    assert.ok(near < far);
    if (fog !== 'off') assert.ok(far <= 48);
    else assert.ok(near >= 100);
  }
  assert.equal(graphicsSettings({ version: 1, fog: 'invalid' }).fog, 'light');
  assert.ok(fogDistances('light')[0] > fogDistances('normal')[0]);
  assert.deepEqual(fogDistances('off', 150), [150, 151]);
});

test('fog loads from browser storage, changes immediately, and persists with other graphics settings', t => {
  const elements = new Map(['#graphics-note', '#fps-limit', '#render-resolution', '#fog-level'].map(id => [id, {
    value: '', addEventListener(event, handler) { this.change = handler; },
  }]));
  let saved = JSON.stringify({ version: 1, fps: 120, resolution: 0.5, fog: 'dense' });
  const globals = {
    window: { matchMedia: () => ({ matches: false }), devicePixelRatio: 1, innerWidth: 800, innerHeight: 600 },
    document: { querySelector: id => elements.get(id) },
    localStorage: { getItem: () => saved, setItem(key, value) { saved = value; } },
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
  }
  const renderer = { ratio: 1, domElement: {}, getPixelRatio() { return this.ratio; },
    setPixelRatio(ratio) { this.ratio = ratio; }, setSize() {} };
  const color = {}, fog = { color };
  const graphics = new GraphicsSettings(renderer, fog);
  assert.deepEqual([fog.near, fog.far], fogDistances('dense'));
  assert.equal(elements.get('#fog-level').value, 'dense');
  elements.get('#fog-level').value = 'off';
  elements.get('#fog-level').change();
  assert.deepEqual([fog.near, fog.far], fogDistances('off'));
  assert.equal(fog.color, color, 'sky can keep updating the existing fog color');
  assert.deepEqual(JSON.parse(saved), { version: 1, fps: 120, resolution: 0.5, fog: 'off' });
  assert.equal(graphics.snapshot().fog, 'off');
  localStorage.setItem = () => { throw new Error('Storage unavailable'); };
  elements.get('#fog-level').value = 'light';
  elements.get('#fog-level').change();
  assert.deepEqual([fog.near, fog.far], fogDistances('light'));
  assert.match(elements.get('#graphics-note').textContent, /Applied for this visit/);
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
