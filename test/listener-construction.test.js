import test from 'node:test';
import assert from 'node:assert/strict';
import { World, SIZE, STONE, AIR, REINFORCED_PANEL, SECURITY_DOOR, DIRT, SAPLING, WOOD, doorBlock } from '../src/world.js';
import { ListenerSystem } from '../src/listener.js';
import { EditHistory } from '../src/history.js';
import { Infrastructure } from '../src/infrastructure.js';
import { Inventory, emptyGatherInventory } from '../src/inventory.js';
import { UpkeepSystem, validUpkeep } from '../src/upkeep.js';
import { GameRoom } from '../server/room.js';

function fixture() {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  const listener = new ListenerSystem(world); Object.assign(listener.entity, { state: 'investigate', x: 20.5, y: 1.01, z: 20.5 });
  const history = new EditHistory(world); history.creature = listener;
  history.infrastructure = new Infrastructure(world); history.inventory = new Inventory(emptyGatherInventory());
  history.inventory.stacks[0] = { block: REINFORCED_PANEL, count: 4 }; history.spendSlot = 0;
  const player = { x: 24.5, y: 1.01, z: 20.5, yaw: 0 };
  return { world, listener, history, player };
}

test('construction cannot place material inside an active creature or consume supplies on rejection', () => {
  const s = fixture(), supplies = s.history.inventory.snapshot();
  const result = s.history.edit(20, 1, 20, REINFORCED_PANEL, s.player);
  assert.equal(result.reason, 'creature'); assert.equal(s.world.get(20, 1, 20), AIR);
  assert.deepEqual(s.history.inventory.snapshot(), supplies); assert.equal(s.history.undoStack.length, 0);
});

test('occupancy follows the creature standing/crouched height and ignores dormant actors', () => {
  const s = fixture();
  assert.equal(s.history.edit(20, 3, 20, REINFORCED_PANEL, s.player).reason, 'creature');
  s.listener.entity.crouched = true;
  assert.equal(s.history.edit(20, 3, 20, REINFORCED_PANEL, s.player).ok, true);
  s.listener.entity.state = 'dormant';
  assert.equal(s.history.edit(20, 1, 20, REINFORCED_PANEL, s.player).ok, true);
});

test('closing an occupied door frame is rejected atomically while preserving its damage', () => {
  const s = fixture(), bottom = doorBlock(0, true, false, SECURITY_DOOR), top = doorBlock(0, true, true, SECURITY_DOOR);
  s.world.set(20, 1, 20, bottom); s.world.set(20, 2, 20, top);
  s.history.infrastructure.setDamage({ x: 20, y: 1, z: 20, block: SECURITY_DOOR, remaining: 3 });
  const infrastructure = s.history.infrastructure.snapshot();
  assert.equal(s.history.toggleDoor(20, 2, 20, s.player).reason, 'creature');
  assert.equal(s.world.get(20, 1, 20), bottom); assert.equal(s.world.get(20, 2, 20), top);
  assert.deepEqual(s.history.infrastructure.snapshot(), infrastructure);
  s.listener.entity.x = 22.5;
  assert.equal(s.history.toggleDoor(20, 1, 20, s.player).ok, true);
});

test('the shared command path enforces creature occupancy before changing world or inventory', () => {
  const room = new GameRoom(), player = room.join('Builder');
  assert.equal(room.upkeep.creature, room.listener);
  for (let x = 250; x <= 256; x++) for (let z = 252; z <= 256; z++) for (let y = 7; y < 24; y++) room.world.set(x, y, z, y === 7 ? STONE : AIR);
  Object.assign(player.pose, { x: 254.5, y: 8.01, z: 254.5 }); player.inventory.stacks[0] = { block: REINFORCED_PANEL, count: 4 };
  Object.assign(room.listener.entity, { state: 'investigate', x: 252.5, y: 8.01, z: 254.5 });
  const result = room.command(player.id, { method: 'edit', x: 252, y: 8, z: 254, block: REINFORCED_PANEL, slot: 0, expected: room.expected(252, 8, 254) });
  assert.equal(result.reason, 'creature'); assert.equal(player.inventory.count(REINFORCED_PANEL), 4); assert.equal(room.world.get(252, 8, 254), AIR);
});

test('tree maturation waits for the creature to move clear instead of embedding it in wood', () => {
  const s = fixture(); let now = 100;
  s.world.set(20, 0, 20, DIRT); s.world.set(20, 1, 20, SAPLING + 2);
  const upkeep = new UpkeepSystem(s.world, { clock: () => now, infrastructure: s.history.infrastructure,
    saved: { version: 1, plants: [{ x: 20, y: 1, z: 20, stage: 2, dueAt: 100 }], wards: [], salvage: [] } });
  upkeep.creature = s.listener;
  assert.deepEqual(upkeep.step(), []); assert.equal(s.world.get(20, 1, 20), SAPLING + 2);
  assert.equal(upkeep.inspect({ x: 20, y: 1, z: 20 }).blocked, 'space'); assert.ok(validUpkeep(upkeep.snapshot(), SIZE, now));
  s.listener.entity.x = 24.5; now += 10;
  assert.ok(upkeep.step().length > 0); assert.equal(s.world.get(20, 1, 20), WOOD);
});

test('shared floor removal is allowed and the authoritative creature falls onto the remaining ground', () => {
  const room = new GameRoom(), player = room.join('Builder');
  room.clock.elapsedSeconds = 200; room.clock.phase = .65;
  for (let x = 250; x <= 256; x++) for (let z = 252; z <= 256; z++) for (let y = 0; y < 24; y++) room.world.set(x, y, z, y === 0 || y === 7 ? STONE : AIR);
  Object.assign(player.pose, { x: 254.5, y: 8.01, z: 254.5 });
  Object.assign(room.listener.entity, { state: 'investigate', x: 252.5, y: 8.01, z: 254.5, encounterUntil: 275 });
  let result;
  for (let hit = 0; hit < 3; hit++) {
    room.clock.elapsedSeconds += .31;
    result = room.command(player.id, { method: 'edit', x: 252, y: 7, z: 254, block: AIR, expected: room.expected(252, 7, 254) });
  }
  assert.equal(result.ok, true); assert.equal(room.world.get(252, 7, 254), AIR);
  room.advance(.2); assert.ok(room.listener.entity.y < 8.01);
  for (let i = 0; i < 10; i++) room.advance(.2);
  assert.ok(Math.abs(room.listener.entity.y - 1.01) < 1e-8);
});
