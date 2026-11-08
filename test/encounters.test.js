import test from 'node:test';
import assert from 'node:assert/strict';
import { World, SIZE, AIR, STONE, GLASS, LANTERN, SLAB, UPPER_SLAB, WATER, REINFORCED_PANEL, SECURITY_DOOR, WARD_LANTERN, doorBlock } from '../src/world.js';
import { EncounterSystem, RECOVERY_GRACE, recoveryPoint, validEncounters, rescueInReach, clearBody } from '../src/encounters.js';
import { ListenerSystem } from '../src/listener.js';
import { ListenerPressure, PRESSURE_INTERVAL } from '../src/listener-pressure.js';
import { Infrastructure, strength } from '../src/infrastructure.js';
import { ShelterSystem } from '../src/shelter.js';
import { GameRoom } from '../server/room.js';
import { validateSave } from '../src/saves.js';

function setup() {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  let now = 200;
  const players = ['a', 'b'].map((id, i) => ({ id, key: id, pose: { x: 20.5 + i * 2, y: 1.01, z: 20.5, active: true } }));
  const system = new EncounterSystem(world, { clock: () => now, recover: () => ({ x: 32.5, y: 1.01, z: 32.5 }) });
  const advance = (seconds, present = players) => { now += seconds; system.advance(present); };
  return { world, players, system, advance, now: () => now };
}

test('the help prompt and host share physical clearance for fixtures, distance, height, and unloaded terrain', () => {
  const s = setup(), [actor, target] = s.players;
  Object.assign(actor.pose, { x: 20.94, z: 21.5 }); Object.assign(target.pose, { x: 22.06, z: 21.5 });
  s.world.set(21, 1, 21, LANTERN); s.system.knockDown(target, s.players);
  assert.ok(clearBody(s.world, actor.pose)); assert.ok(clearBody(s.world, target.pose));
  assert.equal(rescueInReach(s.world, actor.pose, target.pose), false); assert.equal(s.system.canRescue(actor, target), false);
  s.world.set(21, 1, 21, AIR);
  assert.equal(rescueInReach(s.world, actor.pose, target.pose), true); assert.equal(s.system.canRescue(actor, target), true);
  for (const pose of [{ ...target.pose, x: 30 }, { ...target.pose, y: 4 }]) assert.equal(rescueInReach(s.world, actor.pose, pose), false);
  s.world.chunks = new Map();
  s.world.getChunk = (_x, _z, create) => { assert.equal(create, false); return undefined; };
  assert.equal(rescueInReach(s.world, actor.pose, target.pose), false);
});

test('contact knocks down once, freezes movement, and leaves time for teammate help', () => {
  const s = setup(), [a] = s.players;
  assert.equal(s.system.knockDown(a, s.players), true);
  assert.equal(s.system.publicState(a).recoveryAt, 230);
  assert.equal(s.system.knockDown(a, s.players), false);
  a.pose.x = 40; s.advance(.2); assert.equal(a.pose.x, 20.5); assert.equal(a.pose.active, false);
  assert.equal(s.system.publicState(a).revision, 1);
});

test('rescue requires three seconds of fresh, nearby, unobstructed requests and provides recovery grace', () => {
  const s = setup(), [a, b] = s.players;
  s.system.knockDown(a, s.players);
  for (let i = 0; i < 20 && s.system.downed(a); i++) { assert.equal(s.system.rescue(b, a).ok, true); s.advance(.2); }
  assert.equal(s.system.downed(a), false);
  assert.equal(a.pose.x, 20.5); assert.equal(s.system.publicState(a).revision, 2);
  assert.ok(s.system.publicState(a).immuneUntil > s.now());
  assert.equal(s.system.knockDown(a, s.players), false);
  s.advance(RECOVERY_GRACE + .1); assert.equal(s.system.knockDown(a, s.players), true);
});

test('rescue cannot be accelerated by spam, held across a gap, continued out of range, or performed through glass', () => {
  const s = setup(), [a, b] = s.players; s.system.knockDown(a, s.players);
  for (let i = 0; i < 100; i++) s.system.rescue(b, a);
  assert.equal(s.system.publicState(a).rescueProgress, 0);
  s.advance(.2); s.system.rescue(b, a); assert.ok(s.system.publicState(a).rescueProgress > 0);
  s.advance(.7); s.system.rescue(b, a); assert.equal(s.system.publicState(a).rescueProgress, 0);
  b.pose.x = 25; assert.equal(s.system.rescue(b, a).ok, false);
  b.pose.x = 22.5; s.world.set(21, 1, 20, GLASS); assert.equal(s.system.rescue(b, a).ok, false);
  s.world.set(21, 1, 20, AIR); b.pose.active = false; assert.equal(s.system.rescue(b, a).ok, false);
  assert.equal(s.system.rescue(a, b).ok, false);
});

test('solo recovery and all-down recovery return players with grace; disconnected state remains saved', () => {
  const s = setup(), [a, b] = s.players;
  s.system.knockDown(a, s.players); s.advance(1, [a]);
  assert.ok(s.system.publicState(a).recoveryAt <= s.now() + 8);
  const saved = s.system.snapshot(); assert.ok(validEncounters(saved, SIZE));
  const restored = new EncounterSystem(s.world, { clock: s.now, saved, recover: () => ({ x: 32.5, y: 1.01, z: 32.5 }) });
  assert.deepEqual(restored.snapshot(), saved);
  s.advance(8, [a]); assert.equal(s.system.downed(a), false); assert.equal(a.pose.x, 32.5);
  const group = setup(); group.system.knockDown(group.players[0], group.players); group.system.knockDown(group.players[1], group.players); group.advance(.2); group.advance(8.1);
  assert.equal(group.system.downed(group.players[0]), false); assert.equal(group.system.downed(group.players[1]), false);
  assert.equal(b.pose.x, 22.5);
});

test('Listener telegraphs contact, cancels when the player escapes, and retreats after a successful touch', () => {
  const s = setup(), clock = { elapsedSeconds: 200, phase: .65 }; let contacts = 0;
  const listener = new ListenerSystem(s.world, { clock: () => clock, contact: () => { contacts++; return true; } });
  const a = s.players[0];
  listener.director.setPhase('peak', clock.elapsedSeconds, 'Test contact clearance'); listener.mind.burstReadyAt = 300;
  Object.assign(listener.entity, { state: 'stalk', x: 21.5, y: 1.01, z: 20.5, target: { ...a.pose }, home: { x: 30.5, y: 1.01, z: 20.5 }, interestUntil: 250, encounterUntil: 275 });
  const tick = () => { clock.elapsedSeconds += .2; listener.advance(.2, [a]); };
  tick(); assert.equal(listener.publicState().winding, true); assert.equal(contacts, 0);
  a.pose.x = 17.5; tick(); assert.equal(listener.publicState().winding, false);
  a.pose.x = listener.entity.x - 1;
  for (let i = 0; i < 7; i++) tick();
  assert.equal(contacts, 1); assert.equal(listener.entity.state, 'retreat');
});

test('no contact crosses glass, a floor, verified protection, or recovery immunity', () => {
  for (const barrier of ['glass', 'floor', 'ward', 'immune']) {
    const s = setup(), clock = { elapsedSeconds: 200, phase: .65 }; let contacts = 0;
    const listener = new ListenerSystem(s.world, { clock: () => clock, shelters: { status: () => ({ state: barrier === 'ward' ? 'protected' : 'exposed' }) }, contact: () => { contacts++; return true; } });
    const a = s.players[0]; a.pose.x = 21.1;
    Object.assign(listener.entity, { state: 'stalk', x: 20.1, y: 1.01, z: 20.5, target: { ...a.pose }, home: { x: 15.5, y: 1.01, z: 20.5 }, interestUntil: 250, encounterUntil: 275 });
    if (barrier === 'glass') { s.world.set(21, 1, 20, GLASS); s.world.set(21, 2, 20, GLASS); }
    if (barrier === 'floor') a.pose.y = 4.01;
    if (barrier === 'immune') a.vulnerable = false;
    for (let i = 0; i < 7; i++) { clock.elapsedSeconds += .2; listener.advance(.2, [a]); }
    assert.equal(contacts, 0, barrier);
  }
});

test('structural pressure uses progressive damage, removes both door halves, and never awards materials', () => {
  for (const block of [REINFORCED_PANEL, doorBlock(1), doorBlock(1, false, false, SECURITY_DOOR)]) {
    const s = setup(), events = [], infrastructure = new Infrastructure(s.world);
    s.world.set(21, 1, 20, block);
    if (block !== REINFORCED_PANEL) s.world.set(21, 2, 20, doorBlock(1, false, true, block === doorBlock(1) ? undefined : SECURITY_DOOR));
    const pressure = new ListenerPressure(s.world, { infrastructure, shelters: { status: () => ({ state: 'exposed' }) }, onResult: r => events.push(r) });
    const e = { x: 20.5, y: 1.01, z: 20.5 }, target = { x: 24.5, y: 1.01, z: 20.5 };
    pressure.advance(e, target, 0); pressure.advance(e, target, PRESSURE_INTERVAL - .1); assert.equal(events.length, 0);
    for (let i = 1; i <= strength(block); i++) {
      pressure.advance(e, target, PRESSURE_INTERVAL * i + .01);
      if (i < strength(block)) assert.equal(events.at(-1).damage.remaining, strength(block) - i);
    }
    assert.equal(s.world.get(21, 1, 20), AIR);
    if (block !== REINFORCED_PANEL) assert.equal(s.world.get(21, 2, 20), AIR);
    assert.equal(infrastructure.snapshot().construction.length, 0);
  }
});

test('powered boundary wards, unknown shelter, unrelated stone, and open doorways resist pressure', () => {
  for (const state of ['protected', 'checking']) {
    const s = setup(), infrastructure = new Infrastructure(s.world);
    s.world.set(21, 1, 20, REINFORCED_PANEL);
    const pressure = new ListenerPressure(s.world, { infrastructure, shelters: { status: p => ({ state: p.x > 21 ? state : 'exposed' }) } });
    for (let i = 0; i < 10; i++) pressure.advance({ x: 20.5, y: 1.01, z: 20.5 }, { x: 24.5, y: 1.01, z: 20.5 }, i * 4);
    assert.equal(infrastructure.damage.size, 0); assert.equal(s.world.get(21, 1, 20), REINFORCED_PANEL);
  }
  const s = setup(), infrastructure = new Infrastructure(s.world), pressure = new ListenerPressure(s.world, { infrastructure });
  for (const block of [STONE, doorBlock(1, true)]) {
    s.world.set(21, 1, 20, block);
    for (let i = 0; i < 4; i++) pressure.advance({ x: 20.5, y: 1.01, z: 20.5 }, { x: 24.5, y: 1.01, z: 20.5 }, i * 4);
    assert.equal(s.world.get(21, 1, 20), block);
  }
});

test('a real enclosed, powered ward protects a boundary until power switches off', () => {
  const s = setup(), infrastructure = new Infrastructure(s.world); let powered = true;
  for (let x = 21; x <= 25; x++) for (let z = 18; z <= 22; z++) for (let y = 1; y <= 3; y++) if (x === 21 || x === 25 || z === 18 || z === 22 || y === 3) s.world.set(x, y, z, REINFORCED_PANEL);
  s.world.set(23, 1, 20, WARD_LANTERN);
  const shelters = new ShelterSystem(s.world, { timeBudgetMs: 100, wardPower: () => ({ powered }) });
  const point = { x: 22.5, y: 1.01, z: 20.5 };
  for (let i = 0; i < 100 && shelters.status(point).state === 'checking'; i++) shelters.advance(.2);
  assert.equal(shelters.status(point).state, 'protected');
  const pressure = new ListenerPressure(s.world, { infrastructure, shelters });
  const e = { x: 20.5, y: 1.01, z: 20.5 }, target = { x: 23.5, y: 1.01, z: 20.5 };
  for (let i = 0; i < 50; i++) { pressure.advance(e, target, i * .2); shelters.advance(.2); }
  assert.equal(infrastructure.damage.size, 0);
  powered = false;
  for (let i = 50; i < 90; i++) { pressure.advance(e, target, i * .2); shelters.advance(.2); }
  assert.ok(infrastructure.damage.size > 0);
});

test('recovery searches for body clearance without modifying construction and retries a fully blocked starting area', () => {
  const s = setup();
  for (let y = 1; y <= 5; y++) s.world.set(32, y, 32, STONE);
  const blocks = s.world.blocks.slice(), p = recoveryPoint(s.world, null);
  assert.ok(p); assert.deepEqual(s.world.blocks, blocks);
  for (let x = 28; x <= 36; x++) for (let z = 28; z <= 36; z++) for (let y = 1; y < 24; y++) s.world.set(x, y, z, STONE);
  assert.equal(recoveryPoint(s.world, null), null);
});

test('recovery uses actual lower and upper slab surfaces while preserving body clearance and construction', () => {
  for (const [block, height] of [[SLAB, 1.51], [UPPER_SLAB, 2.01]]) {
    const s = setup();
    for (let x = 28; x <= 36; x++) for (let z = 28; z <= 36; z++) s.world.set(x, 1, z, block);
    const before = s.world.blocks.slice(), point = recoveryPoint(s.world, null);
    assert.ok(point); assert.equal(point.y, height); assert.ok(clearBody(s.world, point));
    assert.deepEqual(s.world.blocks, before);
  }
});

test('a downed player in water can automatically recover onto a clear slab-floored outpost', () => {
  const s = setup(), player = s.players[0];
  for (let x = 28; x <= 36; x++) for (let z = 28; z <= 36; z++) s.world.set(x, 1, z, SLAB);
  s.world.set(20, 1, 20, WATER); s.system.recover = () => recoveryPoint(s.world, null);
  assert.equal(clearBody(s.world, player.pose), false);
  s.system.knockDown(player, [player]); s.advance(8.1, [player]);
  assert.equal(s.system.downed(player), false); assert.equal(player.pose.y, 1.51);
  assert.ok(clearBody(s.world, player.pose)); assert.ok(s.system.publicState(player).immuneUntil > s.now());
});

test('teammate help can stand a player up in water without moving them or losing recovery grace', () => {
  const s = setup(), [player, helper] = s.players, position = { x: player.pose.x, y: player.pose.y, z: player.pose.z };
  s.world.set(20, 1, 20, WATER); s.system.knockDown(player, s.players);
  for (let i = 0; i < 20 && s.system.downed(player); i++) { assert.equal(s.system.rescue(helper, player).ok, true); s.advance(.2); }
  assert.equal(s.system.downed(player), false);
  assert.deepEqual({ x: player.pose.x, y: player.pose.y, z: player.pose.z }, position);
  assert.equal(s.system.vulnerable(player), false); assert.ok(clearBody(s.world, player.pose, { allowWater: true }));
});

test('a blocked outpost cannot keep a player down in otherwise clear water', () => {
  const s = setup(), player = s.players[0];
  for (let x = 28; x <= 36; x++) for (let z = 28; z <= 36; z++) for (let y = 1; y < 24; y++) s.world.set(x, y, z, STONE);
  s.world.set(20, 1, 20, WATER); const blocks = s.world.blocks.slice();
  s.system.recover = () => recoveryPoint(s.world, null);
  s.system.knockDown(player, [player]); s.advance(8.1, [player]);
  assert.equal(s.system.downed(player), false); assert.equal(player.pose.x, 20.5); assert.equal(player.pose.y, 1.01);
  assert.equal(s.system.vulnerable(player), false); assert.deepEqual(s.world.blocks, blocks);
});

test('failed automatic return checks retry on simulation seconds and release disconnected retry entries', () => {
  const s = setup(), player = s.players[0]; let attempts = 0;
  s.system.recover = () => { attempts++; return null; };
  s.world.chunks = new Map(); s.world.getChunk = (_x, _z, create) => { assert.equal(create, false); return undefined; };
  s.system.knockDown(player, [player]); s.advance(8.1, [player]); assert.equal(attempts, 1);
  for (let i = 0; i < 100; i++) s.system.advance([player]);
  assert.equal(attempts, 1); s.advance(.5, [player]); assert.equal(attempts, 1);
  s.system.forget(player.id); s.system.advance([]); s.system.advance([player]); assert.equal(attempts, 2);
  s.advance(1, [player]); assert.equal(attempts, 3);
  s.world.chunks = null; s.advance(1, [player]); assert.equal(attempts, 4); assert.equal(s.system.downed(player), false);
  for (let i = 0; i < 100; i++) s.system.advance([player]);
  assert.equal(attempts, 4);
});

test('an obstructed return point falls back to recovery in place with grace', () => {
  const s = setup(), a = s.players[0]; s.system.recover = () => null;
  s.system.knockDown(a, [a]); s.advance(8.1, [a]);
  assert.equal(s.system.downed(a), false); assert.equal(a.pose.x, 20.5);
  assert.ok(s.system.publicState(a).immuneUntil > s.now());
});

test('shared encounter records are profile-bound, reject movement/actions while down, and persist offline', () => {
  const room = new GameRoom(), a = room.join('A'), b = room.join('B'); room.clock.elapsedSeconds = 200;
  const supplies = a.inventory.snapshot(); room.encounters.knockDown({ ...a, key: a.token }, room.encounterPlayers());
  assert.equal(room.move(a.id, { ...a.pose, x: a.pose.x + 2 }), false);
  assert.equal(room.command(a.id, { method: 'craft', block: REINFORCED_PANEL }).reason, 'downed');
  const saved = room.toSave(); validateSave(saved);
  const restored = GameRoom.fromSave(saved), state = restored.encounters.snapshot(); restored.advance(10000);
  assert.deepEqual(restored.encounters.snapshot(), state);
  const returning = restored.join('A', a.token);
  assert.equal(restored.publicPlayer(returning).encounter.state, 'downed');
  assert.deepEqual(returning.inventory.snapshot(), supplies);
  assert.notEqual(restored.publicPlayer(restored.join('Other')).encounter.state, 'downed');
  const bad = structuredClone(saved); bad.encounters.players[0].key = 'unknown-profile'; assert.throws(() => validateSave(bad));
  assert.ok(b);
});

test('saved encounter records reject invalid state, coordinates, timers, duplicates, and revisions', () => {
  const s = setup(); s.system.knockDown(s.players[0], s.players);
  for (const mutate of [r => { r.state = 'dead'; }, r => { r.position.x = -1; }, r => { r.recoveryAt = NaN; }, r => { r.revision = 0; }]) {
    const saved = s.system.snapshot(); mutate(saved.players[0]); assert.equal(validEncounters(saved, SIZE), false);
  }
  const saved = s.system.snapshot(); saved.players.push(structuredClone(saved.players[0])); assert.equal(validEncounters(saved, SIZE), false);
});
