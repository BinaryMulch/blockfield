import test from 'node:test';
import assert from 'node:assert/strict';
import { World, SIZE, AIR, STONE, GLASS, doorBlock } from '../src/world.js';
import { ListenerSystem, NAV_NODE_BUDGET, NAV_READ_BUDGET } from '../src/listener.js';
import { ListenerPressure } from '../src/listener-pressure.js';
import { Infrastructure } from '../src/infrastructure.js';

function fixture(state = 'stalk', width = 8) {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  for (let y = 1; y <= 4; y++) {
    for (let z = 26; z <= 38; z++) world.set(30, y, z, GLASS);
    for (let x = 30; x <= 30 + width; x++) for (const z of [26, 38]) world.set(x, y, z, GLASS);
  }
  const clock = { elapsedSeconds: 200, phase: .65 };
  const listener = new ListenerSystem(world, { clock: () => clock });
  Object.assign(listener.entity, { state, x: 32.5, y: 1.01, z: 32.5, encounterUntil: state === 'retreat' ? 190 : 1000 });
  const target = { x: 28.5, y: 1.01, z: 32.5 };
  const tick = (speed = 2.6) => {
    clock.elapsedSeconds += .2; listener.lastNodes = listener.lastReads = 0;
    listener.move(target, speed, clock.elapsedSeconds);
    assert.ok(listener.lastNodes <= NAV_NODE_BUDGET && listener.lastReads <= NAV_READ_BUDGET);
    // Clearance validation is separate from the actor's own read accounting.
    const reads = listener.lastReads; listener.lastReads = 0;
    assert.ok(listener.fits(listener.entity.x, listener.entity.y, listener.entity.z)); listener.lastReads = reads;
    assert.ok(Math.abs(listener.entity.y - 1.01) < 1e-8);
  };
  return { world, clock, listener, target, tick };
}

for (const [state, width, speed] of [['stalk', 8, 2.6], ['stalk', 16, 2.6], ['shadow', 8, 1.4], ['search', 8, 1.3], ['retreat', 8, 1.7]]) {
  test(`${state} finds the walking exit from a ${width}-block U enclosure within bounded updates`, () => {
    const s = fixture(state, width), blocks = s.world.blocks.slice();
    for (let i = 0; i < 300 && Math.hypot(s.listener.entity.x - s.target.x, s.listener.entity.z - s.target.z) > 1; i++) s.tick(speed);
    assert.ok(Math.hypot(s.listener.entity.x - s.target.x, s.listener.entity.z - s.target.z) <= 1);
    assert.deepEqual(s.world.blocks, blocks);
  });
}

test('pursuit fallback requires a walking exit and cannot treat a closed door as a completed route', () => {
  const s = fixture();
  for (let y = 1; y <= 4; y++) for (let z = 26; z <= 38; z++) s.world.set(39, y, z, GLASS);
  s.world.set(30, 1, 32, doorBlock(1)); s.world.set(30, 2, 32, doorBlock(1, false, true));
  s.listener.pressure = new ListenerPressure(s.world, { infrastructure: new Infrastructure(s.world) });
  let query;
  for (let i = 0; i < 20 && !query; i++) { s.tick(); query = s.listener.routeProbe?.search; }
  assert.ok(query);
  for (let i = 0; i < 12 && query.status === 'pending'; i++) s.tick();
  assert.equal(query.status, 'blocked'); assert.equal(query.barrier, null);
  assert.equal(s.world.get(30, 1, 32), doorBlock(1)); assert.equal(s.world.get(30, 2, 32), doorBlock(1, false, true));
  assert.ok(s.listener.entity.x > 30);
});

test('a pending withdrawal query is invalidated by terrain edits even though it can leave ward zones', () => {
  const s = fixture('retreat');
  s.listener.lastNodes = NAV_NODE_BUDGET - 1;
  assert.equal(s.listener.resumeRoute(s.target, 200), false);
  const previous = s.listener.routeProbe; assert.equal(previous.search.status, 'pending');
  assert.equal(previous.search.valid(s.world), true);
  s.world.set(2, 1, 2, STONE); assert.equal(previous.search.valid(s.world), false);
  s.listener.lastNodes = NAV_NODE_BUDGET - 1; s.listener.lastReads = 0;
  assert.equal(s.listener.resumeRoute(s.target, 200.2), false);
  assert.notEqual(s.listener.routeProbe, previous);
  assert.equal(s.world.get(2, 1, 2), STONE); assert.equal(s.world.get(2, 2, 2), AIR);
});

test('repeated escape scoring of the same goal preserves a watched withdrawal detour', t => {
  const s = fixture('retreat'), player = { id: 'watcher', pose: { ...s.target, yaw: -Math.PI / 2, pitch: 0 } };
  s.listener.entity.home = { ...s.target };
  t.mock.method(s.listener, 'retreatPosition', () => ({ ...s.target }));
  for (let i = 0; i < 150 && s.listener.entity.x < 39; i++) {
    s.clock.elapsedSeconds += .2; s.listener.advance(.2, [player]);
    assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET && s.listener.lastReads <= NAV_READ_BUDGET);
    assert.equal(s.listener.entity.state, 'retreat');
  }
  assert.ok(s.listener.entity.x >= 39);
});
