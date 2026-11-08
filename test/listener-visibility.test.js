import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, SIZE, STONE, UPPER_SLAB, EYE_HEIGHT } from '../src/world.js';
import { ListenerSystem, NAV_NODE_BUDGET, NAV_READ_BUDGET } from '../src/listener.js';
import { ListenerRouteSearch } from '../src/listener-navigation.js';
import { traceBarriers } from '../src/perception.js';
import { GameRoom } from '../server/room.js';

function fixture() {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  const clock = { elapsedSeconds: 200, phase: .65 }, player = { id: 'p', pose: { x: 32.5, y: 1.01, z: 32.5, yaw: 0, pitch: 0 } };
  const listener = new ListenerSystem(world, { clock: () => clock });
  Object.assign(listener.entity, { state: 'retreat', x: 32.5, y: 1.01, z: 16.5, stateUntil: 199, encounterUntil: 275 });
  const tick = () => { clock.elapsedSeconds += .2; listener.advance(.2, [player]); };
  return { world, clock, player, listener, tick };
}

function assertOnScreen(point, observer, height) {
  // Use the game's actual camera projection to establish visible geometry,
  // independently of the host's conservative visibility cone.
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, .05, 100);
  camera.position.set(observer.x, observer.y + height, observer.z);
  camera.rotation.set(observer.pitch, observer.yaw, 0, 'YXZ'); camera.updateMatrixWorld();
  const projected = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  assert.ok(Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z >= -1 && projected.z <= 1);
}

test('a retreating Listener cannot disappear when its feet remain visible at steep downward pitch', () => {
  const s = fixture(); s.player.pose.pitch = -89 * Math.PI / 180; s.listener.entity.z = 31.55;
  assertOnScreen({ ...s.listener.entity, y: 1.26 }, s.player.pose, EYE_HEIGHT);
  s.tick(); assert.equal(s.listener.entity.state, 'retreat');
});

test('a downed player watching through a low gap prevents visible retirement from the actual camera height', () => {
  const s = fixture(); s.player.downed = true; s.player.vulnerable = false;
  s.world.set(32, 1, 24, UPPER_SLAB); s.world.set(32, 2, 24, STONE);
  const feet = { ...s.listener.entity, y: 1.26 };
  assertOnScreen(feet, s.player.pose, .65);
  assert.equal(traceBarriers(s.world, { ...s.player.pose, y: 1.66 }, feet, { sight: true }).barriers, 0);
  s.tick(); assert.equal(s.listener.entity.state, 'retreat');
});

test('arrival rechecks the low camera of downed observers after a complete route proof', () => {
  const s = fixture(); s.player.downed = true; s.player.vulnerable = false;
  s.listener.entity.state = 'dormant';
  s.world.set(32, 1, 24, UPPER_SLAB); s.world.set(32, 2, 24, STONE);
  const point = { x: 32.5, y: 1.01, z: 16.5 }, noise = { ...s.player.pose, radius: 32, at: 200 };
  const search = new ListenerRouteSearch(point, noise, { guarded: true });
  for (let i = 0; i < 12 && search.status === 'pending'; i++) {
    s.listener.lastNodes = s.listener.lastReads = 0; search.step(s.listener);
    assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET && s.listener.lastReads <= NAV_READ_BUDGET);
  }
  assert.equal(search.status, 'reached');
  const standing = { id: 'other', pose: { x: 8.5, y: 1.01, z: 48.5, yaw: Math.PI, pitch: 0 } };
  s.listener.lastReads = 0;
  assert.equal(s.listener.finishSpawn({ point, noise, search, ambient: true }, [s.player, standing], 200), false);
  assert.equal(s.listener.entity.state, 'dormant');
});

test('fully occluded observers still allow retirement', () => {
  const s = fixture(); s.player.downed = true; s.player.vulnerable = false;
  for (let y = 1; y <= 4; y++) s.world.set(32, y, 24, STONE);
  s.tick(); assert.equal(s.listener.entity.state, 'dormant');
});

test('a visible torso edge beside a narrow post prevents retirement even when the center line is hidden', () => {
  const s = fixture(); s.listener.entity.x = 32.9;
  for (let y = 1; y <= 4; y++) s.world.set(32, y, 17, STONE);
  const edge = { x: 33.13, y: 2.21, z: 16.5 }, eye = { ...s.player.pose, y: 2.61 };
  assertOnScreen(edge, s.player.pose, EYE_HEIGHT);
  assert.equal(traceBarriers(s.world, eye, edge, { sight: true }).barriers, 0);
  s.tick(); assert.equal(s.listener.entity.state, 'retreat');
});

test('arrival cannot expose a torso edge beside a post after a complete route proof', () => {
  const s = fixture(); s.listener.entity.state = 'dormant';
  for (let y = 1; y <= 4; y++) s.world.set(32, y, 17, STONE);
  const point = { x: 32.9, y: 1.01, z: 16.5 }, noise = { ...s.player.pose, radius: 32, at: 200 };
  const search = new ListenerRouteSearch(point, noise, { guarded: true });
  for (let i = 0; i < 12 && search.status === 'pending'; i++) { s.listener.lastReads = s.listener.lastNodes = 0; search.step(s.listener); }
  assert.equal(search.status, 'reached'); s.listener.lastReads = 0;
  assert.equal(s.listener.finishSpawn({ point, noise, search, ambient: true }, [s.player], 200), false);
  assert.equal(s.listener.entity.state, 'dormant');
});

test('shared downed players can update their view while position, activity, and encounter revision stay authoritative', () => {
  const room = new GameRoom(), player = room.join('Survivor');
  room.encounters.knockDown({ ...player, key: player.token }, room.encounterPlayers());
  const encounter = room.encounters.publicState({ key: player.token }), before = { ...player.pose };
  const pose = { ...before, yaw: 1.4, pitch: -.8, active: true, encounterRevision: encounter.revision };
  assert.equal(room.move(player.id, pose), true);
  assert.equal(player.pose.yaw, 1.4); assert.equal(player.pose.pitch, -.8); assert.equal(player.pose.active, false);
  assert.deepEqual({ x: player.pose.x, y: player.pose.y, z: player.pose.z }, encounter.position);
  assert.equal(room.move(player.id, { ...pose, x: pose.x + 1 }), false);
  assert.equal(room.move(player.id, { ...pose, yaw: 2, encounterRevision: encounter.revision - 1 }), false);
  assert.equal(player.pose.yaw, 1.4);
});
