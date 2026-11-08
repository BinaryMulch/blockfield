import test from 'node:test';
import assert from 'node:assert/strict';
import { World, SIZE, AIR, STONE, GLASS, LANTERN, REINFORCED_PANEL, doorBlock } from '../src/world.js';
import { ListenerPressure } from '../src/listener-pressure.js';
import { Infrastructure } from '../src/infrastructure.js';
import { ListenerSystem } from '../src/listener.js';
import { loadedBlock, traceBarriers } from '../src/perception.js';
import { TensionDirector, MAX_PRESSURE_HITS } from '../src/director.js';

function fixture() {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  for (let y = 1; y <= 2; y++) world.set(21, y, 20, REINFORCED_PANEL);
  const infrastructure = new Infrastructure(world), pressure = new ListenerPressure(world, { infrastructure });
  return { world, infrastructure, pressure, entity: { x: 20.6, y: 1.01, z: 21.4 }, target: { x: 23, y: 1.01, z: 18.95 } };
}

for (const barrier of ['glass', 'open door', 'lantern']) test(`pressure cannot skip a grazing ${barrier} corner to damage a panel behind it`, () => {
  const s = fixture();
  if (barrier === 'glass') for (let y = 1; y <= 2; y++) s.world.set(20, y, 20, GLASS);
  else if (barrier === 'open door') {
    s.world.set(20, 1, 20, doorBlock(2, true)); s.world.set(20, 2, 20, doorBlock(2, true, true));
  } else {
    s.world.set(20, 1, 20, LANTERN);
    Object.assign(s.entity, { x: 20.16, z: 21.1 }); s.target.z = 21.1 - (23 - 20.16) * .35 / .58;
  }
  const listener = new ListenerSystem(s.world);
  assert.ok(listener.fits(s.entity.x, s.entity.y, s.entity.z));
  assert.equal(s.pressure.candidate(s.entity, s.target), null);
  s.pressure.advance(s.entity, s.target, 200); s.pressure.advance(s.entity, s.target, 204);
  assert.equal(s.infrastructure.damage.size, 0); assert.equal(s.world.get(21, 1, 20), REINFORCED_PANEL);
});

test('an unobstructed exact reach still identifies and damages the first eligible panel', () => {
  const s = fixture(), from = { ...s.entity, y: s.entity.y + .7 }, to = { ...s.target, y: from.y };
  const hit = traceBarriers(s.world, from, to, { physical: true, first: true });
  assert.deepEqual({ x: hit.hit.x, y: hit.hit.y, z: hit.hit.z }, { x: 21, y: 1, z: 20 });
  assert.equal(s.pressure.candidate(s.entity, s.target).x, 21);
  s.pressure.advance(s.entity, s.target, 200); s.pressure.advance(s.entity, s.target, 203.1);
  assert.equal(s.infrastructure.damage.get('21,1,20').remaining, 3);
});

test('a pressure trace stops safely when its shared read budget runs out', () => {
  const s = fixture(); let reads = 0;
  const candidate = s.pressure.candidate(s.entity, s.target, { read: (x, y, z) => ++reads <= 1 ? loadedBlock(s.world, x, y, z) : undefined });
  assert.equal(candidate, null); assert.equal(reads, 2);
  assert.equal(s.infrastructure.damage.size, 0); assert.equal(s.world.get(20, 1, 20), AIR);
});

test('one encounter can breach a full-height unprotected timber wall with eight brisk bounded strikes', () => {
  const s = fixture(), director = new TensionDirector({ now: 200 });
  director.setPhase('pressure', 200, 'Breach test');
  const entity = { x: 20.5, y: 1.01, z: 20.5 }, target = { x: 24.5, y: 1.01, z: 20.5 };
  let now = 200, hits = 0;
  const pressure = new ListenerPressure(s.world, { infrastructure: s.infrastructure, shelters: { status: () => ({ state: 'exposed' }) },
    canHit: () => director.permissions(now).breach, onHit: () => { hits++; director.spend('hit', now, 'builder'); } });
  for (let i = 0; i <= 110 && s.world.get(21, 2, 20) !== AIR; i++) {
    now = 200 + i * .1;
    director.advance(now, [{ id: 'builder', key: 'builder', vulnerable: true, exposed: true, distance: 4 }], { night: true, active: true, pressing: true, evidence: true });
    pressure.advance(entity, target, now);
  }
  assert.equal(s.world.get(21, 1, 20), AIR); assert.equal(s.world.get(21, 2, 20), AIR);
  assert.equal(hits, 8); assert.ok(hits <= MAX_PRESSURE_HITS); assert.ok(now <= 211);
  assert.ok(director.state.budget >= 0); assert.equal(s.infrastructure.damage.size, 0);
});
