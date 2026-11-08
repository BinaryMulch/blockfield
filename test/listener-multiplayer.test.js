import test from 'node:test';
import assert from 'node:assert/strict';
import { World, SIZE, STONE } from '../src/world.js';
import { ListenerSystem, NAV_NODE_BUDGET, NAV_READ_BUDGET } from '../src/listener.js';

function fixture(state = 'protected', vulnerable = true, source = 'home') {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  const clock = { elapsedSeconds: 200, phase: .65 }, players = [
    { id: 'home', key: 'profile-home', vulnerable, pose: { x: 16.5, y: 1.01, z: 16.5, yaw: 0 } },
    { id: 'outside', key: 'profile-outside', pose: { x: 48.5, y: 1.01, z: 48.5, yaw: 0 } },
  ];
  let homeState = state, ticks = 0, workPoint = players[0].pose;
  const shelters = { status: p => ({ state: p.x < 30 && p.z < 30 ? homeState : 'exposed' }) };
  const listener = new ListenerSystem(world, { clock: () => clock, shelters }); listener.director.state.quietUntil = 0;
  const tick = () => {
    clock.elapsedSeconds += .2;
    if (ticks++ % 3 === 0) { listener.noise(workPoint, 32, source); listener.noise(players[1].pose, 22, 'outside'); }
    listener.advance(.2, players);
    assert.ok(listener.lastNodes <= NAV_NODE_BUDGET && listener.lastReads <= NAV_READ_BUDGET && listener.lastCandidates <= 12);
  };
  const awaitArrival = () => {
    for (let i = 0; i < 65 && listener.entity.state === 'dormant'; i++) tick();
    assert.notEqual(listener.entity.state, 'dormant');
    assert.equal(listener.memory.best(clock.elapsedSeconds).key, 'profile-outside');
    for (const player of players) {
      assert.ok(Math.hypot(listener.entity.x - player.pose.x, listener.entity.z - player.pose.z) >= 15);
      assert.equal(listener.inPlayerView(listener.entity, player), false);
    }
  };
  return { world, clock, players, listener, tick, awaitArrival, setHomeState: value => { homeState = value; }, setWorkPoint: point => { workPoint = point; } };
}

for (const [label, state, vulnerable, source] of [
  ['protected teammate', 'protected', true, 'home'],
  ['unverified teammate', 'checking', true, 'home'],
  ['recovering teammate', 'exposed', false, 'home'],
  ['anonymous protected activity', 'protected', true, 'world'],
]) test(`louder ${label} activity cannot starve an exposed teammate's arrival`, () => {
  fixture(state, vulnerable, source).awaitArrival();
});

test('a pending arrival changes anchors when its source becomes protected', () => {
  const s = fixture('exposed'); s.listener.mind.spawnOffset = 0; s.listener.mind.spawnOffsetAt = 200;
  s.listener.lastNodes = NAV_NODE_BUDGET - 1;
  const noise = { ...s.players[0].pose, radius: 32, at: 200, source: 'home' };
  assert.equal(s.listener.spawn(noise, s.players, 200), false);
  const probe = s.listener.spawnProbe; assert.ok(probe); const expanded = probe.search.expanded;
  s.setHomeState('protected'); s.tick();
  assert.equal(probe.search.expanded, expanded);
  s.awaitArrival();
});

test('protected activity remains audible to an existing creature instead of being muted by arrival selection', () => {
  const s = fixture();
  Object.assign(s.listener.entity, { state: 'investigate', x: 31.5, y: 1.01, z: 16.5, encounterUntil: 275 });
  s.listener.director.setPhase('pressure', 200, 'Test live hearing');
  s.listener.noise(s.players[0].pose, 32, 'home'); s.clock.elapsedSeconds += .2;
  s.listener.advance(.2, s.players);
  assert.equal(s.listener.memory.best(s.clock.elapsedSeconds).key, 'profile-home');
  assert.ok(s.listener.noises.some(n => n.source === 'home'));
});

test('exposed work outside a ward can still draw an arrival when its worker is standing safely inside', () => {
  const s = fixture(); s.players.splice(1);
  s.listener.shelters = { status: p => ({ state: p.x < 20 ? 'protected' : 'exposed' }) };
  const work = { x: 21.5, y: 1.5, z: 16.5 };
  for (let i = 0; i < 65 && s.listener.entity.state === 'dormant'; i++) {
    s.clock.elapsedSeconds += .2; if (i % 3 === 0) s.listener.noise(work, 32, 'home');
    s.listener.advance(.2, s.players);
    assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET && s.listener.lastReads <= NAV_READ_BUDGET);
  }
  assert.notEqual(s.listener.entity.state, 'dormant');
  assert.equal(s.listener.memory.best(s.clock.elapsedSeconds).key, 'profile-home');
  assert.ok(s.listener.entity.x >= 20);
});

test('an exposed teammate takes arrival priority over louder exposed work from a sheltered teammate', () => {
  const s = fixture();
  s.listener.shelters = { status: p => ({ state: p.x < 20 && p.z < 30 ? 'protected' : 'exposed' }) };
  s.setWorkPoint({ x: 21.5, y: 1.5, z: 16.5 }); s.awaitArrival();
});
