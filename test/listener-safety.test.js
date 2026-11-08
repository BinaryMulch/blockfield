import test from 'node:test';
import assert from 'node:assert/strict';
import { World, SIZE, AIR, STONE, LEAVES, LANTERN, SLAB, UPPER_SLAB } from '../src/world.js';
import { ListenerSystem, NAV_NODE_BUDGET, NAV_READ_BUDGET, validListener } from '../src/listener.js';
import { EncounterSystem, clearBody, rescueInReach } from '../src/encounters.js';
import { traceBarriers } from '../src/perception.js';

function fixture() {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  const clock = { elapsedSeconds: 200, phase: .65 }, players = [{ id: 'a', pose: { x: 22.06, y: 1.01, z: 21.5, active: true } }];
  const listener = new ListenerSystem(world, { clock: () => clock });
  Object.assign(listener.entity, { state: 'stalk', x: 20.98, y: 1.01, z: 21.5, home: { x: 15.5, y: 1.01, z: 21.5 }, encounterUntil: 275 });
  listener.director.setPhase('peak', 200, 'Test encounter'); listener.mind.burstReadyAt = 300;
  const tick = () => {
    clock.elapsedSeconds += .2; listener.advance(.2, players);
    assert.ok(listener.lastNodes <= NAV_NODE_BUDGET && listener.lastReads <= NAV_READ_BUDGET);
  };
  return { world, clock, players, listener, tick };
}

test('contact respects a solid lantern while sight and hearing retain their normal transmission', t => {
  const s = fixture(); s.world.set(21, 1, 21, LANTERN); let contacts = 0;
  // Isolate reaching across the fixture from navigation around its sides.
  t.mock.method(s.listener, 'move', () => {});
  s.listener.contact = () => { contacts++; return true; };
  assert.ok(s.listener.fits(s.listener.entity.x, s.listener.entity.y, s.listener.entity.z));
  assert.ok(clearBody(s.world, s.players[0].pose));
  const from = { ...s.listener.entity, y: 1.91 }, to = { ...s.players[0].pose, y: 1.91 };
  assert.equal(traceBarriers(s.world, from, to).barriers, 0);
  assert.equal(traceBarriers(s.world, from, to, { sight: true }).barriers, 0);
  for (let i = 0; i < 8; i++) s.tick();
  assert.equal(contacts, 0); assert.equal(s.listener.publicState().winding, false);
  s.world.set(21, 1, 21, AIR);
  for (let i = 0; i < 8 && !contacts; i++) s.tick();
  assert.equal(contacts, 1);
});

test('rescue cannot pass through foliage even when both players have clear body space', () => {
  const s = fixture(), actor = { id: 'rescuer', pose: { x: 20.7, y: 1.01, z: 20.7, active: true } }, target = s.players[0];
  Object.assign(target.pose, { x: 21.31, z: 21.31 });
  for (let y = 1; y <= 2; y++) s.world.set(21, y, 20, LEAVES);
  assert.ok(clearBody(s.world, actor.pose)); assert.ok(clearBody(s.world, target.pose));
  const encounters = new EncounterSystem(s.world, { clock: () => s.clock.elapsedSeconds });
  encounters.knockDown(target, [actor, target]);
  assert.equal(rescueInReach(s.world, actor.pose, target.pose), false);
  assert.equal(encounters.rescue(actor, target).ok, false);
  for (let y = 1; y <= 2; y++) s.world.set(21, y, 20, AIR);
  assert.equal(rescueInReach(s.world, actor.pose, target.pose), true);
  assert.equal(encounters.rescue(actor, target).ok, true);
});

test('target recency lasts from the most recent attention rather than the first sighting', () => {
  const s = fixture(); Object.assign(s.listener.entity, { x: 32.5, z: 32.5 });
  s.players[0].pose = { x: 30.5, y: 1.01, z: 32.5 };
  s.players.push({ id: 'b', pose: { x: 34.5, y: 1.01, z: 32.5 } });
  assert.equal(s.listener.perceive(s.players, 200).id, 'a');
  assert.equal(s.listener.perceive(s.players, 240).id, 'a');
  // A later encounter starts without a committed target. Both players are
  // equally visible and equally far away, so recent attention breaks the tie.
  s.listener.mind.focusKey = null;
  assert.equal(s.listener.perceive(s.players, 290).id, 'b');
});

test('removing support makes the Listener fall and prevents a midair reach', () => {
  const s = fixture(); let contacts = 0; s.listener.contact = () => { contacts++; return true; };
  Object.assign(s.listener.entity, { x: 20.5, y: 4.01, z: 20.5 });
  Object.assign(s.players[0].pose, { x: 21.5, y: 4.01, z: 20.5 });
  s.world.set(20, 3, 20, STONE); s.world.set(21, 3, 20, STONE);
  s.tick(); assert.equal(s.listener.publicState().winding, true);
  s.world.set(20, 3, 20, AIR); s.tick();
  assert.ok(s.listener.entity.y < 4.01); assert.equal(s.listener.publicState().winding, false);
  for (let i = 0; i < 8; i++) s.tick();
  assert.equal(contacts, 0); assert.ok(Math.abs(s.listener.entity.y - 1.01) < 1e-8);
  assert.ok(validListener(s.listener.snapshot(), SIZE, s.clock.elapsedSeconds));
});

test('falling stops on lower and upper slabs without tunnelling through their surfaces', () => {
  for (const [block, surface] of [[SLAB, 2.51], [UPPER_SLAB, 3.01]]) {
    const s = fixture(); Object.assign(s.listener.entity, { state: 'retreat', x: 20.5, y: 7.01, z: 20.5, home: null, stateUntil: 300 });
    s.world.set(20, 2, 20, block);
    for (let i = 0; i < 10; i++) { s.tick(); assert.ok(s.listener.entity.y >= surface - 1e-8); }
    assert.ok(Math.abs(s.listener.entity.y - surface) < 1e-8);
    const restored = new ListenerSystem(s.world, { clock: () => s.clock, saved: s.listener.snapshot() });
    s.clock.elapsedSeconds += .2; restored.advance(.2, s.players);
    assert.equal(restored.entity.y, s.listener.entity.y);
  }
});

test('unknown support holds position without loading terrain, then falling resumes when terrain returns', () => {
  const s = fixture(); Object.assign(s.listener.entity, { state: 'retreat', x: 20.5, y: 4.01, z: 20.5, home: null, stateUntil: 300 });
  s.world.chunks = new Map();
  s.world.getChunk = (_x, _z, create) => { assert.equal(create, false); return undefined; };
  s.tick(); assert.equal(s.listener.entity.y, 4.01);
  s.world.chunks = null;
  for (let i = 0; i < 8; i++) s.tick();
  assert.ok(Math.abs(s.listener.entity.y - 1.01) < 1e-8);
});

test('saving during a fall preserves position and resumes safe falling after restoration', () => {
  const s = fixture(); Object.assign(s.listener.entity, { state: 'retreat', x: 20.5, y: 7.01, z: 20.5, home: null, stateUntil: 300 });
  s.tick(); const saved = s.listener.snapshot();
  assert.ok(saved.y < 7.01 && saved.y > 1.01); assert.ok(validListener(saved, SIZE, s.clock.elapsedSeconds));
  const restored = new ListenerSystem(s.world, { clock: () => s.clock, saved });
  assert.deepEqual(restored.snapshot(), saved);
  for (let i = 0; i < 10; i++) {
    s.clock.elapsedSeconds += .2; restored.advance(.2, s.players);
    assert.ok(restored.entity.y >= 1.01 - 1e-8);
    assert.ok(restored.lastReads <= NAV_READ_BUDGET);
  }
  assert.ok(Math.abs(restored.entity.y - 1.01) < 1e-8);
});
