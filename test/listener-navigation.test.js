import test from 'node:test';
import assert from 'node:assert/strict';
import { World, SIZE, STONE, LEAVES, doorBlock } from '../src/world.js';
import { ListenerSystem, LISTENER_INTERVAL, NAV_NODE_BUDGET, NAV_READ_BUDGET } from '../src/listener.js';
import { ListenerRouteSearch, MAX_SPAWN_ROUTE_NODES } from '../src/listener-navigation.js';

function fixture() {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  const clock = { elapsedSeconds: 200, phase: .65 };
  const listener = new ListenerSystem(world, { clock: () => clock, shelters: { status: () => ({ state: 'exposed' }) } });
  const player = { id: 'p', pose: { x: 32.5, y: 1.01, z: 32.5, yaw: Math.PI / 2, pitch: 0 } };
  listener.mind.spawnOffset = 0; listener.mind.spawnOffsetAt = 200;
  const resetBudget = () => { listener.lastNodes = listener.lastReads = listener.lastCandidates = 0; clock.elapsedSeconds += LISTENER_INTERVAL; };
  return { world, clock, listener, player, resetBudget };
}

test('spawn rejects a foliage pocket even when it has a short path toward the sound', () => {
  const s = fixture();
  for (let x = 54; x <= 58; x++) for (let z = 30; z <= 34; z++) for (let y = 1; y <= 4; y++) {
    if (x === 54 || x === 58 || z === 30 || z === 34) s.world.set(x, y, z, LEAVES);
  }
  const noise = { ...s.player.pose, radius: 32, at: 200, source: 'p' };
  const spawned = s.listener.spawn(noise, [s.player], 200);
  if (spawned) assert.equal(s.listener.entity.x >= 55 && s.listener.entity.x < 58 && s.listener.entity.z >= 31 && s.listener.entity.z < 34, false);
  assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET && s.listener.lastReads <= NAV_READ_BUDGET);
});

test('movement spends its full distance across waypoint boundaries and replans at each configured speed', () => {
  for (const speed of [1.3, 1.4, 1.6, 1.7, 2.6, 5.4]) {
    const s = fixture(); Object.assign(s.listener.entity, { x: 5.5, y: 1.01, z: 32.5 });
    for (let i = 0; i < 20; i++) {
      s.resetBudget(); s.listener.move({ x: 45.5, y: 1.01, z: 32.5 }, speed, s.clock.elapsedSeconds);
      assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET && s.listener.lastReads <= NAV_READ_BUDGET);
    }
    assert.ok(Math.abs(s.listener.entity.x - 5.5 - speed * 4) < 1e-6, `lost movement at speed ${speed}`);
  }
});

test('movement carries distance around a corner without cutting across it', () => {
  const s = fixture(), e = s.listener.entity;
  Object.assign(e, { x: 20.5, y: 1.01, z: 20.5 });
  for (let y = 1; y <= 4; y++) s.world.set(21, y, 20, STONE);
  s.listener.path = [{ x: 20.5, y: 1.01, z: 21.5 }, { x: 21.5, y: 1.01, z: 21.5 }]; s.listener.pathAt = 300;
  s.listener.move({ x: 21.5, y: 1.01, z: 21.5 }, 5.4, 200);
  assert.ok(Math.abs(e.z - 21.5) < 1e-8); assert.ok(Math.abs(e.x - 20.58) < 1e-8);
});

test('a fast segment cannot tunnel through the thin panel of an open door', () => {
  const s = fixture(), e = s.listener.entity;
  Object.assign(e, { x: 20.5, y: 1.01, z: 20.5 });
  // Facing 0, swung open: the panel lies along the west edge of cell 21.
  s.world.set(21, 1, 20, doorBlock(0, true)); s.world.set(21, 2, 20, doorBlock(0, true, true));
  s.listener.path = [{ x: 21.5, y: 1.01, z: 20.5 }]; s.listener.pathAt = 300;
  s.listener.move({ x: 21.5, y: 1.01, z: 20.5 }, 5.4, 200);
  assert.ok(e.x < 20.75); assert.equal(s.listener.path.length, 0);
});

test('carried movement stops at checking and protected ward boundaries', () => {
  for (const state of ['checking', 'protected']) {
    const s = fixture(), e = s.listener.entity;
    Object.assign(e, { state: 'stalk', x: 20.5, y: 1.01, z: 20.5 });
    s.listener.shelters.status = p => ({ state: p.x >= 21.5 ? state : 'exposed' });
    s.listener.path = [{ x: 21.5, y: 1.01, z: 20.5 }, { x: 22.5, y: 1.01, z: 20.5 }]; s.listener.pathAt = 300;
    s.listener.move({ x: 25.5, y: 1.01, z: 20.5 }, 5.4, 200);
    assert.ok(e.x < 21.5); assert.equal(s.listener.path.length, 0);
  }
});

for (const state of ['checking', 'protected']) test(`interruption at a ${state} boundary preserves crouching beneath the ceiling already entered`, () => {
  const s = fixture(), e = s.listener.entity;
  Object.assign(e, { state: 'stalk', x: 20.5, y: 1.01, z: 20.5, crouched: false });
  s.world.set(21, 3, 20, STONE);
  s.listener.shelters.status = p => ({ state: p.x >= 21 ? state : 'exposed' });
  s.listener.path = [{ x: 21.5, y: 1.01, z: 20.5 }, { x: 22.5, y: 1.01, z: 20.5 }]; s.listener.pathAt = 300;
  s.listener.move({ x: 25.5, y: 1.01, z: 20.5 }, 5.4, 200);
  assert.ok(e.x > 20.74 && e.x < 21); assert.equal(s.listener.path.length, 0);
  assert.equal(e.crouched, true);
  s.listener.lastReads = 0;
  assert.equal(s.listener.fits(e.x, e.y, e.z, 2.35), false);
  assert.equal(s.listener.fits(e.x, e.y, e.z), true);
});

test('read-budget exhaustion preserves a safe crouch after partial movement beneath a ceiling', () => {
  const s = fixture(), e = s.listener.entity;
  Object.assign(e, { state: 'stalk', x: 20.5, y: 1.01, z: 20.5, crouched: false });
  s.world.set(21, 3, 20, STONE);
  s.listener.path = [{ x: 21.5, y: 1.01, z: 20.5 }]; s.listener.pathAt = 300;
  s.listener.lastReads = NAV_READ_BUDGET - 6;
  s.listener.move({ x: 25.5, y: 1.01, z: 20.5 }, 5.4, 200);
  assert.ok(e.x > 20.74 && e.x < 21); assert.equal(e.crouched, true);
  assert.ok(s.listener.lastReads <= NAV_READ_BUDGET);
  s.listener.lastReads = 0; assert.equal(s.listener.fits(e.x, e.y, e.z), true);
});

test('a partial spawn proof stays dormant and resumes to a complete route within shared update budgets', () => {
  const s = fixture(), noise = { ...s.player.pose, radius: 32, at: 200, source: 'p' };
  s.listener.lastNodes = NAV_NODE_BUDGET - 1;
  assert.equal(s.listener.spawn(noise, [s.player], 200), false);
  assert.equal(s.listener.entity.state, 'dormant'); assert.ok(s.listener.spawnProbe);
  const search = s.listener.spawnProbe.search; assert.equal(search.status, 'pending');
  let spawned = false;
  for (let i = 0; i < 12 && !spawned; i++) {
    s.resetBudget(); spawned = s.listener.spawn(noise, [s.player], s.clock.elapsedSeconds);
    assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET && s.listener.lastReads <= NAV_READ_BUDGET);
  }
  assert.equal(spawned, true); assert.equal(search.status, 'reached');
  const end = s.listener.path.at(-1);
  assert.ok(Math.hypot(end.x - noise.x, end.z - noise.z) < .8); assert.ok(Math.abs(end.y - noise.y) < 1.25);
});

test('a pending spawn proof cancels immediately when an observer sees it or moves too close', () => {
  for (const change of ['looking', 'too_close']) {
    const s = fixture(), noise = { ...s.player.pose, radius: 32, at: 200, source: 'p' };
    s.listener.lastNodes = NAV_NODE_BUDGET - 1;
    assert.equal(s.listener.spawn(noise, [s.player], 200), false); assert.ok(s.listener.spawnProbe);
    if (change === 'looking') s.player.pose.yaw = -Math.PI / 2;
    else s.player.pose.x = 50.5;
    s.resetBudget(); s.listener.lastNodes = NAV_NODE_BUDGET - 1;
    assert.equal(s.listener.spawn(noise, [s.player], s.clock.elapsedSeconds), false);
    assert.equal(s.listener.entity.state, 'dormant'); assert.equal(s.listener.spawnProbe, null);
  }
});

test('terrain changes invalidate an unfinished spawn proof before its old route can be used', () => {
  const s = fixture(), noise = { ...s.player.pose, radius: 32, at: 200, source: 'p' };
  s.listener.lastNodes = NAV_NODE_BUDGET - 1; s.listener.spawn(noise, [s.player], 200);
  const previous = s.listener.spawnProbe; assert.ok(previous);
  for (let x = 54; x <= 58; x++) for (let z = 30; z <= 34; z++) for (let y = 1; y <= 4; y++) {
    if (x === 54 || x === 58 || z === 30 || z === 34) s.world.set(x, y, z, LEAVES);
  }
  s.resetBudget(); s.listener.spawn(noise, [s.player], s.clock.elapsedSeconds);
  assert.notEqual(s.listener.spawnProbe, previous);
  if (s.listener.entity.state !== 'dormant') assert.equal(s.listener.entity.x >= 55 && s.listener.entity.x < 58 && s.listener.entity.z >= 31 && s.listener.entity.z < 34, false);
});

test('incomplete searches remain resumable when reads run out and have a bounded total search size', () => {
  const s = fixture(), search = new ListenerRouteSearch({ x: 56.5, y: 1.01, z: 32.5 }, s.player.pose, { guarded: true });
  s.listener.lastReads = NAV_READ_BUDGET - 1;
  assert.equal(search.step(s.listener), 'pending'); assert.equal(search.expanded, 0); assert.equal(search.open.length, 1);
  // An unverified band has no eligible route across it at any Z coordinate.
  s.listener.shelters.status = p => ({ state: p.x >= 44 && p.x < 45 ? 'checking' : 'exposed' });
  for (let i = 0; i < 24 && search.status === 'pending'; i++) {
    s.resetBudget(); search.step(s.listener);
    assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET && s.listener.lastReads <= NAV_READ_BUDGET);
  }
  assert.equal(search.status, 'blocked'); assert.ok(search.expanded <= MAX_SPAWN_ROUTE_NODES);
  assert.ok(search.seen.size <= MAX_SPAWN_ROUTE_NODES * 4 + 1);
});

test('planned routes avoid a thin open door panel instead of claiming its crossed edge is clear', () => {
  const s = fixture();
  for (let x = 18; x <= 24; x++) for (let y = 1; y <= 4; y++) for (const z of [19, 21]) s.world.set(x, y, z, STONE);
  s.world.set(21, 1, 20, doorBlock(0, true)); s.world.set(21, 2, 20, doorBlock(0, true, true));
  // Close both ends so a path cannot detour outside the narrow corridor.
  for (let y = 1; y <= 4; y++) for (const x of [18, 24]) s.world.set(x, y, 20, STONE);
  const path = s.listener.route({ x: 23.5, y: 1.01, z: 20.5 }, { x: 20.5, y: 1.01, z: 20.5 }, { requireComplete: true });
  assert.deepEqual(path, []);
});

test('unrelated construction preserves an unfinished proof while edits along its route invalidate it', () => {
  const s = fixture(), noise = { ...s.player.pose, radius: 32, at: 200, source: 'p' };
  s.listener.lastNodes = NAV_NODE_BUDGET - 1; s.listener.spawn(noise, [s.player], 200);
  const probe = s.listener.spawnProbe; assert.ok(probe); assert.ok(probe.search.dependencies.size > 0);
  s.world.set(2, 1, 2, STONE); assert.equal(probe.search.valid(s.world), true);
  let spawned = false;
  for (let i = 0; i < 12 && !spawned; i++) {
    assert.equal(s.listener.spawnProbe, probe);
    s.resetBudget(); spawned = s.listener.spawn(noise, [s.player], s.clock.elapsedSeconds);
    assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET && s.listener.lastReads <= NAV_READ_BUDGET);
  }
  assert.equal(spawned, true);
  assert.equal(probe.search.status, 'reached');
  s.world.set(50, 1, 32, STONE); assert.equal(probe.search.valid(s.world), false);
});

test('spawn proof cannot flatten an inaccessible upper-floor sound onto the ground below it', () => {
  const s = fixture(); s.world.set(32, 11, 32, STONE); s.player.pose.y = 12.01;
  const noise = { ...s.player.pose, radius: 32, at: 200, source: 'p' };
  for (let i = 0; i < 14; i++) {
    s.resetBudget(); assert.equal(s.listener.spawn(noise, [s.player], s.clock.elapsedSeconds), false);
    assert.equal(s.listener.entity.state, 'dormant');
    assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET && s.listener.lastReads <= NAV_READ_BUDGET);
  }
});
