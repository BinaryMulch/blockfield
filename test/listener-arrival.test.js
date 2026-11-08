import test from 'node:test';
import assert from 'node:assert/strict';
import { World, SIZE, AIR, STONE, REINFORCED_PANEL, SECURITY_DOOR, WARD_LANTERN, doorBlock } from '../src/world.js';
import { ListenerSystem, NAV_NODE_BUDGET, NAV_READ_BUDGET, validListener } from '../src/listener.js';
import { ListenerRouteSearch } from '../src/listener-navigation.js';
import { ListenerPressure, PRESSURE_INTERVAL } from '../src/listener-pressure.js';
import { Infrastructure } from '../src/infrastructure.js';
import { ShelterSystem } from '../src/shelter.js';

function fixture(type = 'service') {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  for (let x = 29; x <= 35; x++) for (let z = 29; z <= 35; z++) for (let y = 1; y <= 4; y++) {
    if (x === 29 || x === 35 || z === 29 || z === 35 || y === 4) world.set(x, y, z, STONE);
  }
  const bottom = type === 'panel' ? REINFORCED_PANEL : doorBlock(1, false, false, type === 'security' ? SECURITY_DOOR : undefined);
  const top = type === 'panel' ? REINFORCED_PANEL : doorBlock(1, false, true, type === 'security' ? SECURITY_DOOR : undefined);
  world.set(35, 1, 32, bottom); world.set(35, 2, 32, top);
  const clock = { elapsedSeconds: 200, phase: .65 }, player = { id: 'p', pose: { x: 32.5, y: 1.01, z: 32.5, yaw: 0, active: true } };
  let interior = 'exposed', contacts = 0;
  const shelters = { status: p => ({ state: p.x > 29 && p.x < 35 && p.z > 29 && p.z < 35 ? interior : 'exposed' }) };
  const infrastructure = new Infrastructure(world), results = [];
  const pressure = new ListenerPressure(world, { shelters, infrastructure,
    canHit: () => listener.director.permissions(clock.elapsedSeconds).breach,
    onHit: () => listener.director.spend('hit', clock.elapsedSeconds, listener.mind.focusKey),
    onResult: result => results.push({ ...result, at: clock.elapsedSeconds }) });
  const contact = () => { contacts++; return true; };
  let listener = new ListenerSystem(world, { clock: () => clock, shelters, pressure, contact });
  listener.director.state.quietUntil = 0; listener.mind.spawnOffset = .25; listener.mind.spawnOffsetAt = 200;
  let arrival = null, pressureAt = null, ticks = 0;
  const tick = (loud = true) => {
    clock.elapsedSeconds += .2;
    if (loud && ticks++ % 15 === 0) listener.noise(player.pose, 32, player.id);
    listener.shelters.advance?.(.2); listener.advance(.2, [player]);
    assert.ok(listener.lastNodes <= NAV_NODE_BUDGET && listener.lastReads <= NAV_READ_BUDGET);
    assert.ok(listener.lastCandidates <= 12);
    assert.ok(validListener(listener.snapshot(), SIZE, clock.elapsedSeconds));
    if (!arrival && listener.entity.state !== 'dormant') {
      arrival = { ...listener.entity };
      assert.ok(Math.hypot(arrival.x - player.pose.x, arrival.z - player.pose.z) >= 15);
      assert.equal(listener.inView(arrival, player.pose), false);
    }
    if (pressureAt === null && listener.entity.state === 'pressure') pressureAt = clock.elapsedSeconds;
  };
  return { world, clock, player, get listener() { return listener; }, pressure, infrastructure, results, tick, bottom, top,
    restore: () => { pressure.reset(); listener = new ListenerSystem(world, { clock: () => clock, shelters, pressure, contact, saved: listener.snapshot() }); },
    setInterior: state => { interior = state; }, arrival: () => arrival, pressureAt: () => pressureAt, contacts: () => contacts };
}

test('loud indoor work draws an offscreen Listener along a complete approach, then a closed service door yields to pressure', () => {
  const s = fixture();
  for (let i = 0; i < 180 && !s.results.length; i++) s.tick();
  assert.ok(s.arrival()); assert.ok(s.results.length);
  assert.ok(s.results[0].at >= s.pressureAt() + PRESSURE_INTERVAL);
  assert.equal(s.world.get(35, 1, 32), AIR); assert.equal(s.world.get(35, 2, 32), AIR);
  assert.equal(s.listener.director.state.hits, 1);
  for (let i = 0; i < 80 && !s.contacts(); i++) s.tick();
  assert.equal(s.contacts(), 1); assert.equal(s.listener.entity.state, 'retreat');
});

for (const type of ['security', 'panel']) test(`an unprotected ${type} boundary permits arrival but still requires progressive structural damage`, () => {
  const s = fixture(type);
  for (let i = 0; i < 180 && !s.results.length; i++) s.tick();
  assert.ok(s.arrival()); assert.ok(s.results.length);
  assert.equal(s.world.get(35, 1, 32), s.bottom); assert.equal(s.world.get(35, 2, 32), s.top);
  assert.equal(s.results[0].damage.remaining, type === 'security' ? 4 : 3);
  assert.equal(s.listener.director.state.hits, 1);
});

for (const state of ['protected', 'checking']) test(`${state} interior prevents using its boundary as a spawn approach`, () => {
  const s = fixture(); s.setInterior(state);
  for (let i = 0; i < 120; i++) s.tick();
  assert.equal(s.arrival(), null); assert.deepEqual(s.results, []);
  assert.equal(s.world.get(35, 1, 32), s.bottom); assert.equal(s.world.get(35, 2, 32), s.top);
});

test('the real enclosure worker verifies an unwarded house and allows the same arrival and pressure sequence', () => {
  const s = fixture(), shelters = new ShelterSystem(s.world);
  s.listener.shelters = shelters; s.pressure.shelters = shelters;
  for (let i = 0; i < 180 && !s.results.length; i++) s.tick();
  assert.ok(s.arrival()); assert.ok(s.results.length); assert.equal(s.world.get(35, 1, 32), AIR);
});

test('a real powered ward prevents boundary arrivals; disabling its power permits a later approach', () => {
  const s = fixture(); let powered = true;
  s.world.set(31, 1, 31, WARD_LANTERN);
  const shelters = new ShelterSystem(s.world, { wardPower: () => ({ powered }) });
  s.listener.shelters = shelters; s.pressure.shelters = shelters;
  for (let i = 0; i < 100; i++) s.tick();
  assert.equal(shelters.status(s.player.pose).state, 'protected');
  assert.equal(s.arrival(), null); assert.deepEqual(s.results, []);
  powered = false; s.listener.director.state.quietUntil = s.clock.elapsedSeconds;
  for (let i = 0; i < 180 && !s.results.length; i++) s.tick();
  assert.ok(s.arrival()); assert.ok(s.results.length); assert.equal(s.world.get(35, 1, 32), AIR);
});

test('a solid unbreakable boundary does not become an arrival goal merely because a partial path reaches it', () => {
  const s = fixture(); s.world.set(35, 1, 32, STONE); s.world.set(35, 2, 32, STONE);
  for (let i = 0; i < 120; i++) s.tick();
  assert.equal(s.arrival(), null); assert.deepEqual(s.results, []);
});

test('barrier proof is rechecked against ward protection before materializing', () => {
  const s = fixture(), noise = { ...s.player.pose, at: 200, radius: 32, source: 'p' };
  const point = { x: 48.5, y: 1.01, z: 32.5 }, search = new ListenerRouteSearch(point, noise, { guarded: true, approachBarriers: true });
  for (let i = 0; i < 12 && search.status === 'pending'; i++) {
    s.listener.lastNodes = s.listener.lastReads = 0; search.step(s.listener);
    assert.ok(s.listener.lastReads <= NAV_READ_BUDGET);
  }
  assert.equal(search.status, 'reached'); assert.ok(search.barrier);
  s.setInterior('protected'); s.listener.lastReads = 0;
  assert.equal(s.listener.finishSpawn({ point, noise, search, ambient: false }, [s.player], 200), false);
  assert.equal(s.listener.entity.state, 'dormant');
});

test('a new sound position discards a previously proved approach instead of following its stale destination', () => {
  const s = fixture();
  for (let i = 0; i < 75 && !s.arrival(); i++) s.tick();
  assert.ok(s.arrival()); assert.ok(s.listener.path.length > 0);
  // The source moves outside to another side of the house. A fresh target
  // invalidates the old long-lived route even before its encounter deadline.
  const next = { x: s.listener.entity.x - 4, y: s.listener.entity.y, z: s.listener.entity.z };
  const before = s.listener.entity.x;
  s.listener.lastNodes = s.listener.lastReads = 0;
  s.listener.move(next, 1.6, s.clock.elapsedSeconds);
  assert.ok(s.listener.entity.x < before);
});

test('saving and restoring midway through an approach reconstructs its detour and still reaches the door', () => {
  const s = fixture();
  for (let i = 0; i < 75 && !s.arrival(); i++) s.tick();
  assert.ok(s.arrival()); const position = { ...s.listener.entity };
  s.restore(); assert.deepEqual(s.listener.entity, position);
  for (let i = 0; i < 180 && !s.results.length; i++) s.tick();
  assert.ok(s.results.length); assert.equal(s.world.get(35, 1, 32), AIR);
});

test('unrelated construction does not discard a complete detour while it is being walked', () => {
  const s = fixture();
  for (let i = 0; i < 75 && !s.arrival(); i++) s.tick();
  assert.ok(s.arrival());
  for (let i = 0; i < 180 && !s.results.length; i++) {
    s.world.set(2, 1, 2, i % 2 ? AIR : STONE); s.tick();
  }
  assert.ok(s.results.length); assert.equal(s.world.get(35, 1, 32), AIR);
});
