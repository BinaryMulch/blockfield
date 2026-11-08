import test from 'node:test';
import assert from 'node:assert/strict';
import { TensionDirector, ENCOUNTER_BUDGET, MAX_PRESSURE_HITS, validDirector } from '../src/director.js';
import { ListenerMemory, validMemory, MAX_MEMORIES, MAX_SEARCHED, MAX_FAILED_ROUTES } from '../src/listener-memory.js';
import { chooseListenerAction } from '../src/listener-decisions.js';
import { ListenerSystem, NAV_NODE_BUDGET, NAV_READ_BUDGET, validListener } from '../src/listener.js';
import { World, SIZE, STONE, AIR } from '../src/world.js';
import { ListenerPressure } from '../src/listener-pressure.js';
import { Infrastructure } from '../src/infrastructure.js';
import { REINFORCED_PANEL } from '../src/world.js';
import { GameRoom } from '../server/room.js';
import { validateSave } from '../src/saves.js';

const position = { x: 32.5, y: 1.01, z: 32.5 };
const people = [{ id: 'a', key: 'profile-a', vulnerable: true, exposed: true, distance: 10 }];
const context = { night: true, grace: false, active: true, retiring: false, evidence: true, seen: true, distance: 10 };
function fixture() {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  const clock = { elapsedSeconds: 200, phase: .65 }, players = [{ id: 'a', key: 'profile-a', pose: { ...position, yaw: 0, pitch: 0, active: true } }];
  const listener = new ListenerSystem(world, { clock: () => clock, shelters: { status: () => ({ state: 'exposed' }) } });
  const tick = (dt = .2) => { clock.elapsedSeconds += dt; listener.advance(dt, players); };
  const active = (phase = 'pressure', x = 42.5) => {
    listener.director.setPhase(phase, clock.elapsedSeconds, 'Test encounter');
    Object.assign(listener.entity, { state: 'investigate', x, y: 1.01, z: 32.5, home: { x, y: 1.01, z: 32.5 }, target: { ...position }, interestUntil: 250, encounterUntil: 275 });
    listener.memory.remember('sound', position, clock.elapsedSeconds, .9, 'profile-a');
  };
  return { world, clock, players, listener, tick, active };
}

test('director builds unease, pressure, a brief peak, release, and actual rest after the threat ends', () => {
  const d = new TensionDirector();
  d.advance(19, people, { ...context, active: false }); assert.equal(d.state.phase, 'unease');
  d.advance(24, people, context); assert.equal(d.state.phase, 'pressure');
  d.advance(28, people, context); assert.equal(d.state.phase, 'peak');
  d.advance(43, people, context); assert.equal(d.state.phase, 'release');
  d.advance(60, people, { ...context, retiring: true }); assert.equal(d.state.phase, 'release');
  d.advance(61, people, { ...context, active: false }); assert.equal(d.state.phase, 'quiet');
  assert.ok(d.state.quietUntil >= 106 && d.state.quietUntil <= 126);
  assert.equal(d.permissions(61).pursue, false);
});

test('pacing updates once a second and uses the most pressured teammate instead of averaging them away', () => {
  const d = new TensionDirector(); d.setPhase('pressure', 20, 'Test');
  const team = Array.from({ length: 8 }, (_, i) => ({ ...people[0], key: `p-${i}`, distance: 40 }));
  d.player('p-0', 20).pressure = .99;
  d.advance(20, team, context); assert.equal(d.state.phase, 'release'); assert.equal(d.updates, 1);
  for (let i = 1; i <= 4; i++) d.advance(20 + i * .2, team, context);
  assert.equal(d.updates, 1);
});

test('knockdown immediately overrides pacing and immunity prevents permission to start another encounter', () => {
  const d = new TensionDirector(); d.setPhase('peak', 20, 'Test'); d.advance(20, people, context);
  d.advance(20.2, [{ ...people[0], downed: true, vulnerable: false }], context);
  assert.equal(d.state.phase, 'release'); assert.equal(d.permissions(20.2).breach, false);
  d.advance(40, [{ ...people[0], vulnerable: false }], { ...context, active: false });
  assert.equal(d.permissions(40).presence, false);
});

test('encounter allowance caps destruction and bursts, tracks repeat targeting, and round-trips seeded decisions', () => {
  const d = new TensionDirector(); d.setPhase('unease', 20, 'Test'); d.setPhase('pressure', 24, 'Test');
  for (let i = 0; i < MAX_PRESSURE_HITS; i++) assert.equal(d.spend('hit', 24 + i, people[0].key), true);
  assert.equal(d.spend('hit', 31, people[0].key), false); assert.equal(d.permissions(31).breach, false);
  assert.equal(d.state.budget, ENCOUNTER_BUDGET - MAX_PRESSURE_HITS * 2);
  d.focus(people[0].key, 31); assert.ok(d.targetPenalty(people[0].key, 32) > d.targetPenalty('other', 32));
  const restored = new TensionDirector({ saved: d.snapshot() });
  assert.deepEqual(Array.from({ length: 12 }, () => restored.random()), Array.from({ length: 12 }, () => d.random()));
  assert.ok(validDirector(d.snapshot()));
});

test('long quiet can introduce a distant presence but protected teams do not trigger ambient escalation', () => {
  const d = new TensionDirector();
  d.advance(90, [{ ...people[0], exposed: false }], { ...context, active: false, evidence: false, seen: false }); assert.equal(d.state.phase, 'quiet');
  d.advance(91, people, { ...context, active: false, evidence: false, seen: false }); assert.equal(d.state.phase, 'unease');
});

test('utility selection filters forbidden actions before commitment and preserves a valid short commitment', () => {
  const candidates = [{ action: 'stalk', allowed: false, score: 100, reason: 'Forbidden' }, { action: 'search', allowed: true, score: .7 }, { action: 'investigate', allowed: true, score: .8 }];
  assert.equal(chooseListenerAction(candidates, 'stalk', .1, () => .5).action, 'investigate');
  assert.equal(chooseListenerAction(candidates, 'search', .5, () => .5).action, 'search');
  assert.equal(chooseListenerAction(candidates, 'search', 2, () => .5).action, 'investigate');
});

test('perception memory decays without refreshing repeated sound and keeps bounded checked/failed positions', () => {
  const m = new ListenerMemory(); m.remember('sound', position, 10, .8, 'a');
  m.remember('sound', { ...position, x: 40 }, 10, 1, 'a'); assert.equal(m.best(11).point.x, position.x);
  const confidence = m.confidence(m.best(11), 11); assert.ok(m.confidence(m.best(15), 15) < confidence);
  for (let i = 0; i < 30; i++) {
    m.remember('sound', { ...position, x: i + .5 }, 20 + i, .5, `source-${i}`);
    m.visit({ ...position, x: i + .5 }); m.fail({ ...position, x: i + .5 }, 20 + i);
  }
  assert.ok(m.state.facts.length <= MAX_MEMORIES && m.state.searched.length <= MAX_SEARCHED && m.state.failed.length <= MAX_FAILED_ROUTES);
  m.advance(100); assert.equal(m.best(100), null); assert.equal(m.state.failed.length, 0); assert.ok(validMemory(m.snapshot(), SIZE));
});

test('losing sight creates a search around remembered evidence without tracking the hidden player position', () => {
  const s = fixture(); s.active(); s.tick(); assert.equal(s.listener.entity.state, 'shadow');
  const known = structuredClone(s.listener.memory.state.facts.find(f => f.kind === 'sight'));
  for (let z = 0; z < SIZE; z++) for (let y = 1; y <= 4; y++) s.world.set(38, y, z, STONE);
  s.players[0].pose.x = 12.5; s.players[0].pose.active = false;
  for (let i = 0; i < 15; i++) s.tick();
  assert.equal(s.listener.entity.state, 'search');
  assert.deepEqual(s.listener.memory.state.facts.find(f => f.kind === 'sight'), known);
  assert.ok(Math.hypot(s.listener.entity.target.x - known.point.x, s.listener.entity.target.z - known.point.z) <= 11);
  assert.notEqual(s.listener.entity.target.x, s.players[0].pose.x);
});

test('shadowing cannot make contact, and a pursuit burst has a distinct warning before faster movement', () => {
  const s = fixture(); let contacts = 0; s.listener.contact = () => { contacts++; return true; }; s.active('unease', 33.5);
  for (let i = 0; i < 10; i++) s.tick(); assert.equal(contacts, 0); assert.equal(s.listener.entity.state, 'shadow');
  Object.assign(s.listener.entity, { x: 42.5, z: 32.5 }); s.listener.director.setPhase('peak', s.clock.elapsedSeconds, 'Test pursuit'); s.listener.mind.decideAt = 0;
  s.tick(); assert.equal(s.listener.entity.cueKind, 'pursuit'); assert.equal(s.listener.publicState().sprinting, false); assert.equal(contacts, 0);
  for (let i = 0; i < 7; i++) s.tick(); assert.equal(s.listener.publicState().sprinting, true);
  assert.ok(s.listener.mind.burstUntil - s.listener.mind.warningUntil <= 5.01);
  for (let i = 0; i < 15 && !contacts; i++) s.tick(); assert.equal(contacts, 1); assert.equal(s.listener.director.state.phase, 'release');
});

test('spawns stay out of every player view and provide a loaded route without changing terrain', () => {
  const s = fixture(); s.listener.director.state.quietUntil = 0;
  const blocks = s.world.blocks.slice(); s.listener.noise(position, 32, 'a');
  for (let i = 0; i < 12 && s.listener.entity.state === 'dormant'; i++) {
    s.tick();
    assert.ok(s.listener.lastReads <= NAV_READ_BUDGET && s.listener.lastNodes <= NAV_NODE_BUDGET);
  }
  assert.notEqual(s.listener.entity.state, 'dormant');
  assert.equal(s.listener.inView(s.listener.entity, s.players[0].pose), false); assert.ok(s.listener.path.length > 0);
  assert.deepEqual(s.world.blocks, blocks); assert.ok(s.listener.lastReads <= NAV_READ_BUDGET && s.listener.lastNodes <= NAV_NODE_BUDGET);
});

test('a visible withdrawing creature remains physical and only retires once no player is watching', () => {
  const s = fixture(); s.active('pressure', 32.5); s.listener.entity.z = 12.5;
  s.listener.setState('retreat', 200); s.listener.entity.home = { x: 32.5, y: 1.01, z: 12.5 };
  for (let i = 0; i < 50; i++) s.tick(); assert.equal(s.listener.entity.state, 'retreat'); assert.equal(s.listener.publicState().alpha, 1);
  s.players[0].pose.yaw = Math.PI; s.tick(); assert.equal(s.listener.entity.state, 'dormant');
});

test('director, evidence, checked positions, burst deadlines, and random choices persist and pause offline', () => {
  const room = new GameRoom(), p = room.join('Survivor'); room.clock.elapsedSeconds = 200; room.clock.phase = .65;
  room.listener.director.setPhase('pressure', 200, 'Test persistence'); room.listener.director.focus(p.token, 200);
  room.listener.memory.remember('sight', p.pose, 200, 1, p.token); room.listener.memory.visit(p.pose); room.listener.mind.burstReadyAt = 220;
  const saved = room.toSave(); validateSave(saved); room.leave(p.id); room.advance(10000);
  assert.deepEqual(room.listener.snapshot(), saved.listener);
  const restored = GameRoom.fromSave(saved); assert.deepEqual(restored.listener.snapshot(), saved.listener);
  const diagnostics = JSON.stringify(restored.listener.diagnostics()); assert.equal(diagnostics.includes(p.token), false);
  for (const mutate of [s => { s.director.phase = 'chaos'; }, s => { s.director.budget = Infinity; }, s => { s.director.rng = 0; }, s => { s.memory.facts[0].point.x = -1; }, s => { s.mind.burstUntil = NaN; }]) {
    const bad = structuredClone(saved); mutate(bad.listener); assert.throws(() => validateSave(bad), /Listener/);
  }
});

test('scored spatial searches keep bounded work across repeated lost-contact decisions', () => {
  const s = fixture(); s.active(); s.listener.memory.remember('sight', position, 200, 1, 'profile-a');
  s.players[0].pose.x = 2.5; s.players[0].pose.active = false;
  for (let i = 0; i < 40; i++) { s.tick(); assert.ok(s.listener.lastCandidates <= 12); assert.ok(s.listener.lastNodes <= NAV_NODE_BUDGET); assert.ok(s.listener.lastReads <= NAV_READ_BUDGET); }
  assert.ok(validListener(s.listener.snapshot(), SIZE));
});

test('a current target stays committed during contact instead of switching every time its recency penalty changes', () => {
  const s = fixture(); s.players.push({ id: 'b', key: 'profile-b', pose: { ...position, x: 34.5, active: true } });
  s.active('peak', 31.5); s.listener.mind.burstReadyAt = 300;
  const touched = []; s.listener.contact = id => { touched.push(id); return true; };
  for (let i = 0; i < 8; i++) s.tick();
  assert.deepEqual(touched, ['a']);
});

test('repeated navigation failures cause withdrawal without tunnelling or altering an enclosing wall', () => {
  const s = fixture(); s.active('pressure', 42.5);
  for (let x = 41; x <= 43; x++) for (let z = 31; z <= 33; z++) for (let y = 1; y <= 4; y++) if (x === 41 || x === 43 || z === 31 || z === 33) s.world.set(x, y, z, STONE);
  const blocks = s.world.blocks.slice();
  for (let i = 0; i < 70; i++) s.tick();
  assert.equal(s.listener.entity.state, 'retreat'); assert.deepEqual(s.world.blocks, blocks);
  assert.equal(s.listener.director.state.phase, 'release');
});

test('a cheaper loaded detour is used instead of damaging a reinforced barrier', () => {
  const s = fixture(), infrastructure = new Infrastructure(s.world); let hits = 0;
  s.listener.pressure = new ListenerPressure(s.world, { infrastructure, shelters: s.listener.shelters, onHit: () => hits++ });
  s.players[0].pose.x = 36.5; s.active('pressure', 32.5);
  s.listener.memory.remember('sound', s.players[0].pose, 200.01, 1, 'profile-a');
  for (let y = 1; y <= 3; y++) s.world.set(34, y, 32, REINFORCED_PANEL);
  for (let i = 0; i < 35; i++) s.tick();
  assert.equal(hits, 0); assert.equal(infrastructure.damage.size, 0);
  assert.ok(s.listener.entity.x > 34); assert.equal(s.world.get(34, 1, 32), REINFORCED_PANEL);
});

test('a visible head above a low wall prevents arrival or retirement even if the torso is obscured', () => {
  const s = fixture(); s.players[0].pose = { x: 32.5, y: 1.01, z: 40.5, yaw: 0, pitch: 0 };
  for (let x = 31; x <= 33; x++) for (let y = 1; y <= 2; y++) s.world.set(x, y, 35, STONE);
  assert.equal(s.listener.inView({ x: 32.5, y: 1.01, z: 30.5 }, s.players[0].pose), false);
  // At a higher surface the head clears the barrier while the lower body does not.
  assert.equal(s.listener.inView({ x: 32.5, y: 2.01, z: 30.5 }, s.players[0].pose), true);
});

test('actual rest starts after withdrawal during daylight and remains elapsed at the next night', () => {
  const d = new TensionDirector({ now: 200 }); d.setPhase('release', 200, 'Dawn');
  d.advance(210, people, { ...context, night: false, active: false });
  assert.equal(d.state.phase, 'quiet'); assert.ok(d.state.quietUntil >= 255 && d.state.quietUntil <= 275);
  d.advance(300, people, { ...context, active: false });
  assert.equal(d.state.phase, 'unease');
});

test('recovery immunity permits the rest timer to begin but cannot start a new encounter', () => {
  const d = new TensionDirector({ now: 200 }); d.setPhase('release', 200, 'Recovery');
  d.advance(210, [{ ...people[0], vulnerable: false }], { ...context, active: false });
  assert.equal(d.state.phase, 'quiet');
  d.advance(300, [{ ...people[0], vulnerable: false }], { ...context, active: false });
  assert.equal(d.state.phase, 'quiet'); assert.equal(d.permissions(300).presence, false);
});
