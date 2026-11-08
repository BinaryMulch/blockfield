import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { GameRoom } from '../server/room.js';
import { ChunkWorld } from '../src/chunks.js';
import { AIR, DIRT, STONE, GLASS, SAPLING, REINFORCED_PANEL, SECURITY_DOOR, WARD_LANTERN, BIOFUEL, REPAIR_TOOL, isSolid, blockBounds, doorBlock, stepPlayer } from '../src/world.js';
import { NAV_NODE_BUDGET, NAV_READ_BUDGET, validListener } from '../src/listener.js';
import { MAX_MEMORIES, MAX_SEARCHED, MAX_FAILED_ROUTES } from '../src/listener-memory.js';
import { MAX_DIRECTOR_PLAYERS } from '../src/director.js';
import { MAX_CACHED_ZONES } from '../src/shelter.js';
import { GROWTH_BUDGET } from '../src/upkeep.js';
import { traceBarriers } from '../src/perception.js';

const ward = { x: 242, y: 8, z: 250 }, door = { x: 246, y: 8, z: 251 };
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function assertClear(world, entity) {
  const height = entity.crouched ? 1.85 : 2.35;
  for (let x = Math.floor(entity.x - .26); x <= Math.floor(entity.x + .26); x++) for (let z = Math.floor(entity.z - .26); z <= Math.floor(entity.z + .26); z++) {
    if (!world.getChunk(Math.floor(x / 16), Math.floor(z / 16), false)) continue;
    for (let y = Math.floor(entity.y); y <= Math.floor(entity.y + height); y++) {
      const block = world.get(x, y, z); if (!isSolid(block)) continue;
      const b = blockBounds(block, x, y, z);
      assert.ok(!(entity.x + .26 > b.minX && entity.x - .26 < b.maxX && entity.z + .26 > b.minZ && entity.z - .26 < b.maxZ
        && entity.y + height > b.minY && entity.y < b.maxY), `Listener overlaps block ${x},${y},${z} at ${JSON.stringify(entity)}`);
    }
  }
}

function makeRoom(seed) {
  const world = new ChunkWorld({ seed });
  for (let x = 224; x < 288; x++) for (let z = 224; z < 288; z++) for (let y = 1; y < 24; y++) world.set(x, y, z, y <= 7 ? STONE : AIR);
  for (let x = 240; x <= 246; x++) for (let z = 248; z <= 254; z++) for (let y = 8; y <= 12; y++) {
    if (x === 240 || x === 246 || z === 248 || z === 254 || y === 12) world.set(x, y, z, y === 9 && z === 248 ? GLASS : REINFORCED_PANEL);
  }
  world.set(door.x, door.y, door.z, doorBlock(1, false, false, SECURITY_DOOR));
  world.set(door.x, door.y + 1, door.z, doorBlock(1, false, true, SECURITY_DOOR));
  world.set(ward.x, ward.y, ward.z, WARD_LANTERN);
  world.set(250, 7, 254, DIRT);
  const room = new GameRoom({ world });
  for (let i = 0; i < 3; i++) {
    const p = room.join(`Survivor ${i}`);
    Object.assign(p.pose, { x: [256.5, 243.5, 271.5][i], y: 8.01, z: [256.5, 251.5, 246.5][i], yaw: 0, pitch: 0, vy: 0, grounded: true });
    p.inventory.stacks[0] = { block: REINFORCED_PANEL, count: 64 };
    p.inventory.stacks[1] = { block: STONE, count: 64 };
    p.inventory.stacks[2] = { block: BIOFUEL, count: 64 };
    p.inventory.stacks[3] = { block: REPAIR_TOOL, count: 1 };
    p.inventory.stacks[4] = { block: SAPLING, count: 4 };
  }
  const planter = [...room.players.values()][0];
  assert.equal(room.command(planter.id, { method: 'edit', x: 250, y: 8, z: 254, block: SAPLING, slot: 4, expected: room.expected(250, 8, 254) }).ok, true);
  return room;
}

// Uses the real room, physics, shelter worker, command validation, director,
// encounters, checkpoint validation and restore paths. No browser or server.
export function runListenerSoak({ seed = 'Blockfield', seconds = 3600 } = {}) {
  let room = makeRoom(seed), rng = [...seed].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const tokens = [...room.players.values()].map(p => p.token), lastStrike = new Map();
  const states = new Set(), phases = new Set(), stats = { updates: 0, arrivals: 0, knockdowns: 0, recoveries: 0, rescues: 0, strikes: 0, growthTransitions: 0, reloads: 0 };
  const due = new Map();
  const every = (key, interval, now) => { if (now < (due.get(key) || 0)) return false; due.set(key, now + interval); return true; };
  while (room.clock.elapsedSeconds < seconds) {
    const now = room.clock.elapsedSeconds, dt = [.05, .15, .3, .2, .1, .4][stats.updates % 6], players = [...room.players.values()];
    const records = new Map(players.map(p => [p.token, room.encounters.publicState({ key: p.token })]));
    for (const [i, p] of players.entries()) {
      if (room.encounters.downed({ key: p.token })) { p.pose.vy = 0; continue; }
      const downed = i === 2 && players.find(q => q.id !== p.id && room.encounters.downed({ key: q.token }));
      const doorway = { x: 247.5, z: 251.5 };
      const target = i === 0 ? { x: 256.5 + Math.sin(now / 30) * 4, z: 256.5 + Math.cos(now / 30) * 4 }
        : i === 1 ? p.pose.x > 247 && distance(p.pose, doorway) > .6 ? doorway : { x: 243.5, z: 251.5 }
          : downed ? { x: downed.pose.x + 1.2, z: downed.pose.z } : { x: 271.5 + Math.sin(now / 20) * 3, z: 246.5 + Math.cos(now / 20) * 3 };
      const moving = (i === 1 || downed || now % 90 >= 45) && distance(p.pose, target) > .5;
      const yaw = moving ? Math.atan2(p.pose.x - target.x, p.pose.z - target.z) : Math.sin(now / 7 + i) * Math.PI;
      for (let left = dt; left > 1e-8; left -= .05) stepPlayer(p.pose, room.world, { forward: Number(moving), yaw, sprint: i === 2 && now % 15 < 5 }, Math.min(.05, left));
      room.move(p.id, { ...p.pose, yaw, pitch: Math.sin(now / 11) * .7, active: true, encounterRevision: room.encounters.publicState({ key: p.token }).revision });
      if (every(`noise-${p.token}`, i === 1 ? 2.5 : 3, now)) room.listener.noise(p.pose, i === 1 ? 32 : 22, p.id);
    }
    const builder = players[0], keeper = players[1];
    if (every('edit', 4, now)) {
      const x = Math.floor(builder.pose.x) + 2 + Math.floor(random() * 2), z = Math.floor(builder.pose.z) + (random() < .5 ? -2 : 2), y = 8;
      const block = room.world.get(x, y, z);
      room.command(builder.id, { method: 'edit', x, y, z, block: block === AIR ? REINFORCED_PANEL : AIR, slot: 0, expected: room.expected(x, y, z) });
    }
    if (every('door', 17, now)) room.command(keeper.id, { method: 'toggleDoor', ...door, expected: room.expected(door.x, door.y, door.z) });
    if (every('ward', 45, now)) room.command(keeper.id, { method: 'setWardPower', ...ward, enabled: Math.floor(now / 45) % 2 === 0 });
    if (every('fuel', 120, now)) room.command(keeper.id, { method: 'refuelWard', ...ward });
    if (every('repair', 19, now)) room.command(keeper.id, { method: 'repair', ...door });
    if (every('support', 83, now) && room.listener.entity.state !== 'dormant') {
      const e = room.listener.entity, x = Math.floor(e.x), y = Math.floor(e.y - .05), z = Math.floor(e.z);
      room.command(builder.id, { method: 'edit', x, y, z, block: AIR, expected: room.expected(x, y, z) });
    }
    for (const helper of players) {
      if (room.encounters.downed({ key: helper.token })) continue;
      const target = players.find(p => p.id !== helper.id && room.encounters.downed({ key: p.token }) && distance(helper.pose, p.pose) <= 2.5);
      if (target && room.command(helper.id, { method: 'rescue', targetId: target.id }).ok && !room.encounters.downed({ key: target.token })) stats.rescues++;
    }
    const before = room.listener.snapshot(), oldStrike = room.listener.strikeTarget, strikeAt = room.listener.strikeAt;
    const supplies = players.map(p => JSON.stringify(p.inventory.snapshot()));
    room.advance(dt); stats.updates++;
    const e = room.listener.entity, current = room.clock.elapsedSeconds;
    states.add(e.state); phases.add(room.listener.director.state.phase);
    assert.ok(validListener(room.listener.snapshot(), room.world.size, current));
    assert.ok(room.listener.lastNodes <= NAV_NODE_BUDGET && room.listener.lastReads <= NAV_READ_BUDGET && room.listener.lastCandidates <= 12);
    assert.ok(room.listener.memory.state.facts.length <= MAX_MEMORIES && room.listener.memory.state.searched.length <= MAX_SEARCHED && room.listener.memory.state.failed.length <= MAX_FAILED_ROUTES);
    assert.ok(room.listener.director.state.players.length <= MAX_DIRECTOR_PLAYERS);
    assert.ok(room.shelters.lastWork <= room.shelters.workBudget && room.shelters.sections.size <= room.shelters.maxSections && room.shelters.zones.size <= MAX_CACHED_ZONES);
    if (e.state !== 'dormant') assertClear(room.world, e);
    for (const [i, p] of players.entries()) {
      assert.equal(JSON.stringify(p.inventory.snapshot()), supplies[i], 'AI changed player supplies');
      const previous = records.get(p.token), record = room.encounters.publicState({ key: p.token });
      if (previous.state !== 'downed' && record.state === 'downed') {
        stats.knockdowns++; assert.ok(current >= previous.immuneUntil); assert.equal(oldStrike, p.id); assert.ok(current >= strikeAt);
        assert.ok(distance(e, p.pose) <= 1.25 && Math.abs(e.y - p.pose.y) < 1.2);
        const ray = traceBarriers(room.world, { ...e, y: e.y + .9 }, { ...p.pose, y: p.pose.y + .9 }, { physical: true });
        assert.ok(!ray.unloaded && !ray.barriers);
      }
      if (previous.state === 'downed' && record.state === 'ready') { stats.recoveries++; assert.ok(record.immuneUntil > current); }
    }
    if (before.state === 'dormant' && e.state !== 'dormant') {
      stats.arrivals++;
      for (const p of players) {
        assert.ok(distance(e, p.pose) >= 15);
        assert.equal(room.listener.inPlayerView(e, { ...p, downed: room.encounters.downed({ key: p.token }) }), false);
      }
    }
    for (const event of room.drainEncounters()) {
      const p = event.damage || event.change; assert.ok(p); const key = `${p.x},${p.y},${p.z}`;
      assert.ok(current - (lastStrike.get(key) ?? -Infinity) >= 3 - 1e-7); lastStrike.set(key, current); stats.strikes++;
    }
    if (room.processUpkeep().length) stats.growthTransitions++;
    assert.ok(room.upkeep.lastWork <= GROWTH_BUDGET);
    if (current >= (stats.reloads + 1) * 600) {
      const saved = room.toSave(), poses = players.map(p => ({ token: p.token, name: p.name, pose: { ...p.pose } }));
      players.forEach(p => room.leave(p.id)); room.advance(3600);
      assert.equal(room.clock.elapsedSeconds, saved.clock.elapsedSeconds); assert.deepEqual(room.listener.snapshot(), saved.listener);
      assert.deepEqual(room.encounters.snapshot(), saved.encounters); assert.deepEqual(room.upkeep.snapshot(), saved.upkeep);
      room = GameRoom.fromSave(saved); assert.deepEqual(room.listener.snapshot(), saved.listener);
      assert.deepEqual(room.encounters.snapshot(), saved.encounters); assert.deepEqual(room.upkeep.snapshot(), saved.upkeep);
      for (let cx = 14; cx <= 17; cx++) for (let cz = 14; cz <= 17; cz++) room.world.getChunk(cx, cz, true);
      for (const previous of poses) {
        const p = room.join(previous.name, previous.token), record = room.encounters.publicState({ key: p.token });
        if (record.state !== 'downed') Object.assign(p.pose, previous.pose);
      }
      assert.deepEqual([...room.profiles.keys()], tokens); stats.reloads++;
    }
  }
  room.toSave();
  assert.ok(stats.arrivals > 0 && stats.knockdowns > 0 && stats.recoveries > 0, `Insufficient encounter coverage: ${JSON.stringify(stats)}`);
  return { seed, seconds: Math.round(room.clock.elapsedSeconds), ...stats, states: [...states].sort(), phases: [...phases].sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const seconds = Number(process.env.BLOCKFIELD_SOAK_SECONDS || 3600);
  assert.ok(Number.isFinite(seconds) && seconds >= 600 && seconds <= 86400, 'Use 600–86400 simulated seconds');
  for (const seed of ['Blockfield', 'family-night', 'listener-soak']) console.log(JSON.stringify(runListenerSoak({ seed, seconds })));
}
