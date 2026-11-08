import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, SIZE, STONE, AIR, WOOD, GLASS, LEAVES, WATER, DOOR, SLAB, UPPER_SLAB, doorBlock } from '../src/world.js';
import { ListenerSystem, MAX_NOISE_EVENTS, NAV_NODE_BUDGET, NAV_READ_BUDGET, LISTENER_GRACE, LISTENER_STANDING_HEIGHT, validListener } from '../src/listener.js';
import { loadedBlock, traceBarriers, soundTransmission, TRACE_BUDGET } from '../src/perception.js';
import { ListenerRenderer } from '../src/listener-renderer.js';
import { ShelterSystem } from '../src/shelter.js';
import { GameRoom } from '../server/room.js';
import { validateSave } from '../src/saves.js';

function setup() {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  const clock = { elapsedSeconds: 200, phase: .65 }, shelter = { state: 'exposed' };
  const listener = new ListenerSystem(world, { clock: () => clock, shelters: { status: () => shelter } });
  listener.director.state.quietUntil = 0;
  const players = [{ id: 'p', pose: { x: 32.5, y: 1.01, z: 32.5, yaw: 0, active: true } }];
  const tick = (dt = .2) => { clock.elapsedSeconds += dt; listener.advance(dt, players); };
  return { world, clock, shelter, listener, players, tick };
}

function arrive(s) {
  s.listener.noise(s.players[0].pose, 32);
  // Arrival requires a completed bounded proof, which may yield under load.
  for (let i = 0; i < 12 && s.listener.entity.state === 'dormant'; i++) {
    s.tick();
    assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET && s.listener.lastReads <= NAV_READ_BUDGET);
  }
  assert.equal(s.listener.entity.state, 'investigate');
}

test('voxel traces respect full walls, thin doors, unknown chunks, and bounded work', () => {
  const { world } = setup(), a = { x: 8.5, y: 1.7, z: 8.5 }, b = { x: 8.5, y: 1.7, z: 12.5 };
  assert.equal(traceBarriers(world, a, b).barriers, 0);
  world.set(8, 1, 10, doorBlock(0)); assert.equal(traceBarriers(world, a, b).barriers, 1);
  assert.ok(soundTransmission(world, a, b).gain < 1);
  world.set(8, 1, 10, doorBlock(0, true)); assert.equal(traceBarriers(world, a, b).barriers, 0);
  world.set(8, 1, 10, WOOD); assert.equal(traceBarriers(world, a, b).barriers, 1);
  world.set(8, 1, 10, GLASS); assert.equal(traceBarriers(world, a, b, { sight: true }).barriers, 0); assert.equal(traceBarriers(world, a, b).barriers, 1);
  world.set(8, 1, 10, LEAVES); assert.equal(traceBarriers(world, a, b, { sight: true }).barriers, 1); assert.equal(traceBarriers(world, a, b).barriers, 0);
  world.chunks = new Map(); world.getChunk = (_x, _z, create) => { assert.equal(create, false); return undefined; };
  assert.equal(loadedBlock(world, 8, 1, 8), undefined); assert.equal(traceBarriers(world, a, b).unloaded, true);
  assert.ok(traceBarriers(world, a, { ...b, z: 100000 }).steps <= TRACE_BUDGET);
});

test('first-night grace and quiet footsteps do not spawn a creature; loud work draws one from a distance', () => {
  const s = setup(); s.clock.elapsedSeconds = LISTENER_GRACE - 10;
  s.listener.noise(s.players[0].pose, 32); s.tick(); assert.equal(s.listener.entity.state, 'dormant');
  s.clock.elapsedSeconds = 200; s.listener.noises = []; s.clock.phase = .18;
  s.listener.noise(s.players[0].pose, 32); s.tick(); assert.equal(s.listener.entity.state, 'dormant');
  s.clock.phase = .65; s.listener.noises = []; s.listener.noise(s.players[0].pose, 8); s.tick(); assert.equal(s.listener.entity.state, 'dormant');
  s.listener.director.state.nextAt = 0; arrive(s);
  assert.ok(Math.hypot(s.listener.entity.x - s.players[0].pose.x, s.listener.entity.z - s.players[0].pose.z) >= 15);
  assert.ok(s.listener.lastReads <= NAV_READ_BUDGET); assert.equal(s.listener.entity.cueSeq, 1);
});

test('spawn distance includes downed and recovering teammates even though they cannot be targeted', () => {
  const s = setup();
  s.players.push({ id: 'recovering', vulnerable: false, pose: { x: 56.5, y: 1.01, z: 32.5 } });
  arrive(s);
  for (const player of s.players) assert.ok(Math.hypot(s.listener.entity.x - player.pose.x, s.listener.entity.z - player.pose.z) >= 15);
});

test('the Listener investigates, pursues into contact range, and respects per-update navigation limits', () => {
  const s = setup(); arrive(s);
  let stalking = false, contacted = false;
  s.listener.contact = () => { contacted = true; return true; };
  for (let i = 0; i < 220; i++) {
    s.tick(); stalking ||= s.listener.entity.state === 'stalk';
    assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET); assert.ok(s.listener.lastReads <= NAV_READ_BUDGET);
    if (contacted) break;
  }
  assert.equal(stalking, true); assert.equal(contacted, true); assert.equal(s.listener.entity.state, 'retreat'); assert.ok(s.listener.entity.stepSeq > 0);
  assert.ok(validListener(s.listener.snapshot(), SIZE));
});

test('closed doors and tall walls remain physical barriers; navigation never edits terrain', () => {
  const s = setup();
  for (let z = 0; z < SIZE; z++) for (let y = 1; y <= 4; y++) s.world.set(31, y, z, STONE);
  s.world.set(31, 1, 32, doorBlock(0)); s.world.set(31, 2, 32, doorBlock(0, false, true));
  Object.assign(s.listener.entity, { state: 'investigate', x: 35.5, y: 1.01, z: 32.5, target: { x: 28.5, y: 1.01, z: 32.5 }, home: { x: 35.5, y: 1.01, z: 32.5 }, interestUntil: 300, encounterUntil: 300 });
  s.players[0].pose.x = 28.5; const blocks = s.world.blocks.slice();
  for (let i = 0; i < 80; i++) s.tick();
  assert.ok(s.listener.entity.x > 31); assert.deepEqual(s.world.blocks, blocks);
  assert.equal(s.listener.fits(31.5, 1.01, 32.5), false);
  s.world.set(31, 1, 32, AIR); s.world.set(31, 2, 32, AIR); s.world.set(31, 3, 32, AIR);
  s.listener.lastReads = 0; assert.equal(s.listener.fits(31.5, 1.01, 32.5), true);
});

test('replanning midway through a corner escapes a U-shaped enclosure and still reaches the player', () => {
  const s = setup(); s.players[0].pose.x = 27.5;
  for (let y = 1; y <= 4; y++) {
    for (let z = 30; z <= 34; z++) s.world.set(30, y, z, STONE);
    for (let x = 30; x <= 35; x++) for (const z of [30, 34]) s.world.set(x, y, z, STONE);
  }
  Object.assign(s.listener.entity, { state: 'investigate', x: 32.5, y: 1.01, z: 32.5, target: { ...s.players[0].pose }, home: { x: 32.5, y: 1.01, z: 32.5 }, interestUntil: 280, encounterUntil: 275 });
  for (let i = 0; i < 150 && s.listener.entity.x >= 30; i++) {
    s.clock.elapsedSeconds += .2; s.listener.lastNodes = s.listener.lastReads = 0;
    s.listener.move(s.players[0].pose, 2.6, s.clock.elapsedSeconds);
    assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET); assert.ok(s.listener.lastReads <= NAV_READ_BUDGET);
  }
  assert.ok(s.listener.entity.x < 30);

});

test('Listener navigation supports lower and upper slabs at their actual surface height', () => {
  const s = setup();
  s.world.set(32, 1, 32, SLAB);
  assert.equal(s.listener.ground(32.5, 32.5, 1.01).y, 1.51);
  s.world.set(32, 1, 32, UPPER_SLAB);
  assert.equal(s.listener.ground(32.5, 32.5, 1.51).y, 2.01);
  s.world.set(32, 1, 32, AIR);
  assert.equal(s.listener.ground(32.5, 32.5, 1.51).y, 1.01);
});

test('confirmed ward protection, dawn, or expired encounters trigger retreat', () => {
  for (const reason of ['protected', 'day', 'expired']) {
    const s = setup(); arrive(s);
    if (reason === 'protected') s.shelter.state = reason;
    if (reason === 'day') s.clock.phase = .18;
    if (reason === 'expired') s.listener.entity.encounterUntil = s.clock.elapsedSeconds;
    s.tick(); assert.equal(s.listener.entity.state, 'retreat');
    for (let i = 0; i < 50; i++) s.tick();
    assert.equal(s.listener.entity.state, 'dormant'); assert.ok(s.listener.entity.cooldownUntil > s.clock.elapsedSeconds);
  }
});

test('unverified shelter pauses entry without falsely triggering ward retreat', () => {
  const s = setup(); arrive(s);
  const before = s.listener.snapshot(); s.shelter.state = 'checking'; s.tick();
  assert.equal(s.listener.entity.state, 'investigate');
  assert.equal(s.listener.entity.x, before.x); assert.equal(s.listener.entity.z, before.z);
  assert.equal(s.listener.entity.cueSeq, before.cueSeq); assert.equal(s.listener.diagnostics().activity, 'Checking shelter');
  s.shelter.state = 'exposed'; for (let i = 0; i < 8; i++) s.tick();
  assert.notEqual(s.listener.entity.state, 'retreat');
  assert.ok(Math.hypot(s.listener.entity.x - before.x, s.listener.entity.z - before.z) > 0);
});

test('a real unwarded roof can finish enclosure verification without scaring the Listener away', () => {
  const s = setup(), shelters = new ShelterSystem(s.world);
  for (let x = 20; x <= 28; x++) for (let z = 20; z <= 28; z++) s.world.set(x, 3, z, STONE);
  const listener = new ListenerSystem(s.world, { clock: () => s.clock, shelters });
  listener.director.setPhase('pressure', s.clock.elapsedSeconds, 'Test active encounter');
  Object.assign(listener.entity, { state: 'investigate', x: 24.5, y: 1.01, z: 24.5, target: { x: 32.5, y: 1.01, z: 24.5 }, home: { x: 35.5, y: 1.01, z: 24.5 }, interestUntil: 240, encounterUntil: 275 });
  s.players[0].pose = { x: 32.5, y: 1.01, z: 24.5, active: true };
  listener.memory.remember('sound', listener.entity.target, s.clock.elapsedSeconds, .9);
  assert.equal(shelters.status(listener.entity).state, 'checking');
  let crouched = false;
  for (let i = 0; i < 50; i++) { s.clock.elapsedSeconds += .2; shelters.advance(.2); listener.advance(.2, s.players); crouched ||= listener.entity.crouched; assert.notEqual(listener.entity.state, 'retreat'); }
  assert.ok(listener.entity.x > 24.5); assert.equal(crouched, true);
});

test('the Listener crouches through an ordinary open two-block door and stands up after clearing it', () => {
  const s = setup();
  for (let z = 0; z < SIZE; z++) for (let y = 1; y <= 4; y++) s.world.set(31, y, z, STONE);
  s.world.set(31, 1, 32, doorBlock(1, true)); s.world.set(31, 2, 32, doorBlock(1, true, true));
  Object.assign(s.listener.entity, { state: 'investigate', x: 35.5, y: 1.01, z: 32.5, home: { x: 35.5, y: 1.01, z: 32.5 }, target: { x: 24.5, y: 1.01, z: 32.5 }, interestUntil: 300, encounterUntil: 300 });
  s.players[0].pose.x = 24.5;
  s.listener.director.setPhase('peak', s.clock.elapsedSeconds, 'Test active pursuit');
  s.listener.memory.remember('sound', s.players[0].pose, s.clock.elapsedSeconds, .9);
  assert.equal(s.listener.fits(31.5, 1.01, 32.5), true);
  assert.equal(s.listener.fits(31.5, 1.01, 32.5, LISTENER_STANDING_HEIGHT), false);
  let crouched = false, crossed = false, stood = false;
  for (let i = 0; i < 100; i++) { s.tick(); crouched ||= s.listener.entity.crouched; crossed ||= s.listener.entity.x < 31; stood ||= s.listener.entity.x < 30.5 && !s.listener.entity.crouched; }
  assert.equal(crouched, true); assert.equal(crossed, true); assert.equal(stood, true);
  assert.ok(validListener(s.listener.snapshot(), SIZE));
});

test('short shelter/visibility interruptions preserve stalking instead of replaying discovery cues', () => {
  const s = setup();
  Object.assign(s.listener.entity, { state: 'stalk', x: 39.5, y: 1.01, z: 32.5, target: { x: 32.5, y: 1.01, z: 32.5 }, home: { x: 44.5, y: 1.01, z: 32.5 }, interestUntil: 240, encounterUntil: 275 });
  s.listener.director.setPhase('peak', s.clock.elapsedSeconds, 'Test active pursuit');
  s.listener.mind.burstReadyAt = 300;
  s.tick(); const cues = s.listener.entity.cueSeq;
  s.shelter.state = 'checking'; s.tick(); assert.equal(s.listener.entity.state, 'stalk');
  s.shelter.state = 'exposed'; s.tick(); assert.equal(s.listener.entity.cueSeq, cues);
});

test('noise queues and movement observations are bounded and independent of client audio', () => {
  const s = setup();
  for (let i = 0; i < 100; i++) s.listener.noise(s.players[0].pose, 32);
  assert.equal(s.listener.noises.length, MAX_NOISE_EVENTS);
  s.listener.noises = []; s.listener.observe(s.players, 1);
  s.players[0].pose.x += 1.8; s.listener.observe(s.players, 1.25);
  assert.equal(s.listener.noises[0].radius, 22);
  s.listener.noises = []; s.players[0].pose.active = false; s.players[0].pose.x += 2; s.listener.observe(s.players, 2);
  assert.equal(s.listener.noises.length, 0);
  s.players[0].pose.active = true; s.players[0].pose.x = 60; s.listener.observe(s.players, 2.01); assert.equal(s.listener.noises.length, 0);
  s.listener.observe([], 3); assert.equal(s.listener.motion.size, 0);
  s.listener.action('p', 'edit', { x: 32, y: 1, z: 32, block: AIR }, { ok: false }, s.players[0].pose); assert.equal(s.listener.noises.length, 0);
});

test('unknown terrain cannot spawn or move a creature and never generates chunks', () => {
  const s = setup(); s.world.chunks = new Map(); let reads = 0;
  s.world.getChunk = (_cx, _cz, create) => { reads++; assert.equal(create, false); return undefined; };
  s.listener.noise(s.players[0].pose, 32); s.tick(); assert.equal(s.listener.entity.state, 'dormant'); assert.ok(reads <= NAV_READ_BUDGET);
  assert.ok(s.listener.lastReads >= reads && s.listener.lastReads <= NAV_READ_BUDGET);
});

test('saved Listener state and timers freeze offline and restore without catchup', () => {
  const room = new GameRoom(), p = room.join('Survivor'); room.clock.elapsedSeconds = 200; room.clock.phase = .65;
  const saved = room.toSave(); assert.ok(saved.listener); room.leave(p.id); room.advance(10000);
  assert.deepEqual(room.toSave().listener, saved.listener);
  const restored = GameRoom.fromSave(JSON.parse(JSON.stringify(saved))); assert.deepEqual(restored.listener.snapshot(), saved.listener);
  for (const change of [v => v.state = 'attack', v => v.x = -1, v => v.interestUntil = NaN, v => v.stepSeq = -1, v => v.home = { x: Infinity, y: 1, z: 1 }]) {
    const bad = structuredClone(saved); change(bad.listener); assert.throws(() => validateSave(bad), /Listener/);
  }
  assert.throws(() => validateSave({ ...saved, listener: { ...saved.listener, version: 2 } }), e => e.code === 'SAVE_INCOMPATIBLE');
});

test('renderer uses a lit silhouette, suppresses replayed cues, and hides unloaded creatures', () => {
  const s = setup(), scene = new THREE.Scene(), renderer = new ListenerRenderer(scene);
  const state = { state: 'investigate', x: 38.5, y: 1.01, z: 32.5, yaw: 0, cueSeq: 1, cueKind: 'alert', stepSeq: 0, alpha: 1 };
  assert.deepEqual(renderer.sync(state), []); renderer.update(.1, s.world, s.players[0].pose); assert.equal(renderer.group.visible, true);
  assert.deepEqual(renderer.sync(state), []);
  assert.equal(renderer.sync({ ...state, cueSeq: 2, stepSeq: 1 }).length, 2);
  s.world.chunks = new Map(); s.world.getChunk = () => undefined; renderer.update(.1, s.world, s.players[0].pose); assert.equal(renderer.group.visible, false);
  renderer.sync(null); assert.equal(renderer.sequence, null); renderer.dispose(); assert.equal(scene.children.length, 0);
});

test('the rendered crouched silhouette fits a two-block opening and returns to standing height', () => {
  const s = setup(), scene = new THREE.Scene(), renderer = new ListenerRenderer(scene);
  const state = { state: 'investigate', x: 38.5, y: 1.01, z: 32.5, yaw: 0, cueSeq: 1, cueKind: 'alert', stepSeq: 0, alpha: 1, crouched: true };
  renderer.sync(state);
  for (let i = 0; i < 30; i++) renderer.update(.1, s.world, s.players[0].pose);
  renderer.group.updateMatrixWorld(true);
  const crouched = new THREE.Box3().setFromObject(renderer.group).getSize(new THREE.Vector3()).y;
  assert.ok(crouched < 2);
  renderer.sync({ ...state, crouched: false });
  for (let i = 0; i < 30; i++) renderer.update(.1, s.world, s.players[0].pose);
  renderer.group.updateMatrixWorld(true);
  const standing = new THREE.Box3().setFromObject(renderer.group).getSize(new THREE.Vector3()).y;
  assert.ok(standing > 2.2 && standing <= LISTENER_STANDING_HEIGHT);
  assert.ok(renderer.limbs.every(limb => Math.abs(limb.leg.rotation.x) < .001));
  renderer.dispose();
});
