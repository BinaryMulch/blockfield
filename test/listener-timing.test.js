import test from 'node:test';
import assert from 'node:assert/strict';
import { World, SIZE, STONE, GLASS, SLAB, doorBlock } from '../src/world.js';
import { ListenerSystem, NAV_NODE_BUDGET, NAV_READ_BUDGET, validListener } from '../src/listener.js';
import { clearBody } from '../src/encounters.js';

function fixture() {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  const clock = { elapsedSeconds: 200, phase: .65 }, player = { id: 'p', pose: { x: 30.5, y: 1.01, z: 32.5, active: true } };
  let contacts = 0;
  const listener = new ListenerSystem(world, { clock: () => clock, contact: () => { contacts++; return true; } });
  listener.director.setPhase('peak', 200, 'Test pursuit'); listener.mind.burstReadyAt = 300;
  Object.assign(listener.entity, { state: 'stalk', x: 8.5, y: 1.01, z: 32.5, home: { x: 5.5, y: 1.01, z: 32.5 }, encounterUntil: 275 });
  const tick = (seconds = .2) => {
    clock.elapsedSeconds += seconds; listener.advance(seconds, [player]);
    assert.ok(listener.lastNodes <= NAV_NODE_BUDGET && listener.lastReads <= NAV_READ_BUDGET);
    assert.ok(validListener(listener.snapshot(), SIZE, clock.elapsedSeconds));
  };
  return { world, clock, player, listener, tick, contacts: () => contacts };
}

function prepareStraightRoute(s) {
  // Isolate elapsed movement from the path search's wall-clock yield target.
  s.listener.path = Array.from({ length: 22 }, (_, i) => ({ x: 9.5 + i, y: 1.01, z: 32.5 }));
  s.listener.pathAt = 300;
}

test('a nearby raised player still triggers a pursuit route up reachable steps', () => {
  const s = fixture(); Object.assign(s.listener.entity, { x: 20.2, z: 20.5 });
  Object.assign(s.player.pose, { x: 21.1, y: 2.51, z: 20.5 });
  s.world.set(21, 2, 20, SLAB); s.world.set(20, 1, 21, STONE); s.world.set(21, 1, 21, STONE);
  assert.ok(clearBody(s.world, s.player.pose)); assert.ok(s.listener.fits(20.2, 1.01, 20.5));
  for (let i = 0; i < 40 && !s.contacts(); i++) s.tick();
  assert.equal(s.contacts(), 1); assert.ok(s.listener.entity.y > 1.01);
});

test('pursuit routes around a nearby glass corner instead of freezing or reaching through it', () => {
  const s = fixture(); Object.assign(s.listener.entity, { x: 20.7, z: 20.7 });
  Object.assign(s.player.pose, { x: 21.31, z: 21.31 });
  s.world.set(21, 1, 20, GLASS); s.world.set(21, 2, 20, GLASS);
  assert.ok(clearBody(s.world, s.player.pose)); assert.ok(s.listener.fits(20.7, 1.01, 20.7));
  s.tick(); assert.equal(s.contacts(), 0); assert.equal(s.listener.publicState().winding, false);
  for (let i = 0; i < 40 && !s.contacts(); i++) s.tick();
  assert.equal(s.contacts(), 1);
  assert.ok(Math.hypot(s.listener.entity.x - 20.7, s.listener.entity.z - 20.7) > .2);
});

for (const [name, intervals] of [
  ['frequent', Array(60).fill(.05)],
  ['normal', Array(15).fill(.2)],
  ['delayed', Array(10).fill(.3)],
  ['irregular', Array.from({ length: 5 }, () => [.11, .17, .07, .25]).flat()],
]) test(`${name} updates preserve movement distance over occupied simulation time`, () => {
  const s = fixture(); prepareStraightRoute(s);
  for (const seconds of intervals) s.tick(seconds);
  assert.ok(Math.abs(s.listener.entity.x - 8.5 - 2.6 * 3) < 1e-7);
});

test('a long delayed update caps travel and performs only one bounded navigation update', () => {
  const s = fixture(); prepareStraightRoute(s); s.tick(10);
  assert.ok(Math.abs(s.listener.entity.x - 8.5 - 2.6) < 1e-7);
  assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET && s.listener.lastReads <= NAV_READ_BUDGET);
});

test('a delayed fall sweeps the whole descent and lands on a thin slab', () => {
  const s = fixture();
  Object.assign(s.listener.entity, { state: 'retreat', x: 20.5, y: 12.01, z: 20.5, home: null, stateUntil: 300 });
  s.world.set(20, 2, 20, SLAB);
  for (let i = 0; i < 2; i++) { s.tick(1); assert.ok(s.listener.entity.y >= 2.51 - 1e-8); }
  assert.ok(Math.abs(s.listener.entity.y - 2.51) < 1e-8);
});

test('a longer investigation step still stops at a newly swung thin door panel', () => {
  const s = fixture();
  s.listener.entity.state = 'investigate'; s.listener.director.setPhase('pressure', 200, 'Test approach');
  s.listener.memory.remember('sound', s.player.pose, 200, 1, 'p');
  s.listener.path = [9.5, 10.5, 11.5].map(x => ({ x, y: 1.01, z: 32.5 }));
  s.listener.pathAt = 300; s.listener.pathGoal = { ...s.player.pose }; s.listener.verifiedApproach = true;
  s.world.set(10, 1, 32, doorBlock(0, true)); s.world.set(10, 2, 32, doorBlock(0, true, true));
  s.tick(1);
  assert.ok(s.listener.entity.x > 9.5 && s.listener.entity.x < 9.74);
  assert.equal(s.listener.path.length, 0); assert.equal(s.contacts(), 0);
});

test('a longer pursuit burst still stops at a ward boundary', () => {
  const s = fixture();
  s.listener.shelters = { status: p => ({ state: p.x >= 12 ? 'protected' : 'exposed' }) };
  s.listener.memory.remember('sight', s.player.pose, 200, 1, 'p');
  Object.assign(s.listener.mind, { decideAt: 300, warningUntil: 200, burstUntil: 206 });
  s.listener.path = [9.5, 10.5, 11.5, 12.5, 13.5, 14.5].map(x => ({ x, y: 1.01, z: 32.5 })); s.listener.pathAt = 300;
  s.tick(1);
  assert.ok(s.listener.entity.x > 11 && s.listener.entity.x < 12); assert.equal(s.contacts(), 0);
});
