import test from 'node:test';
import assert from 'node:assert/strict';
import { World, AIR, DIRT, STONE, WOOD, LEAVES, SAND, CONCRETE, REINFORCED_PANEL, WARD_LANTERN, SALVAGE_CRATE, SAPLING, SCRAP, BIOFUEL, REPAIR_TOOL, doorBlock, SECURITY_DOOR, isBlock, isSolid } from '../src/world.js';
import { Inventory } from '../src/inventory.js';
import { EditHistory } from '../src/history.js';
import { Infrastructure } from '../src/infrastructure.js';
import { UpkeepSystem, GROWTH_STAGE_SECONDS, GROWTH_BUDGET, MAX_PLANTS, WARD_CAPACITY, FUEL_SECONDS, SALVAGE_INTERVAL, validUpkeep } from '../src/upkeep.js';
import { ShelterSystem } from '../src/shelter.js';
import { GameRoom } from '../server/room.js';
import { validateSave } from '../src/saves.js';
import { buildItemGeometry } from '../src/terrain.js';
import { synthesizeSound } from '../src/sound.js';

const p = { x: 10, y: 4, z: 10 }, pose = { x: 12.5, y: 4, z: 12.5, yaw: 0 };
const k = '10,4,10';
function setup() {
  const world = new World({ generate: false }), inventory = new Inventory(), infrastructure = new Infrastructure(world);
  const state = { now: 0 };
  const upkeep = new UpkeepSystem(world, { clock: () => state.now, infrastructure }), history = new EditHistory(world);
  history.inventory = inventory; history.upkeep = upkeep; history.infrastructure = infrastructure;
  world.set(10, 3, 10, DIRT);
  return { world, inventory, infrastructure, upkeep, history, state };
}
function plant(s, position = p) {
  s.world.set(position.x, position.y - 1, position.z, DIRT);
  s.inventory.stacks[0] = { block: SAPLING, count: 1 };
  return s.history.edit(position.x, position.y, position.z, SAPLING);
}
function ward(s) {
  s.world.set(10, 3, 10, CONCRETE); s.inventory.stacks[0] = { block: WARD_LANTERN, count: 1 };
  assert.equal(s.history.placeLantern(10, 4, 10, null, WARD_LANTERN).ok, true);
}
function site(s) {
  s.world.set(10, 4, 10, SALVAGE_CRATE);
  s.upkeep.salvage.set(k, { ...p, name: 'Worksite', stock: [8, 16, 8], updatedAt: 0 });
}
const action = (s, method, args = p) => s.upkeep.command(method, args, s.inventory, pose);

test('renewable recipes conserve ingredients and upkeep items cannot become terrain blocks', () => {
  const s = setup(); s.inventory.stacks[0] = { block: LEAVES, count: 2 };
  assert.equal(s.inventory.craft(SAPLING).ok, true); assert.equal(s.inventory.count(LEAVES), 1); assert.equal(s.inventory.count(SAPLING), 1);
  s.inventory.stacks[2] = { block: WOOD, count: 1 };
  assert.equal(s.inventory.craft(BIOFUEL).ok, true); assert.equal(s.inventory.count(WOOD), 0); assert.equal(s.inventory.count(BIOFUEL), 2);
  for (const item of [SCRAP, BIOFUEL, REPAIR_TOOL]) {
    assert.equal(isBlock(item), false); assert.equal(s.world.set(10, 4, 10, item), false);
    const geometry = buildItemGeometry(item); assert.ok(geometry.attributes.position.count > 0); geometry.dispose();
    assert.ok(synthesizeSound(item, 'place', 16000).some(value => value !== 0));
  }
});

test('saplings require soil, remain non-solid, and grow through three saved stages into renewable wood', () => {
  const s = setup(); s.world.set(10, 3, 10, STONE); s.inventory.stacks[0] = { block: SAPLING, count: 1 };
  assert.equal(s.history.edit(10, 4, 10, SAPLING).ok, false); assert.equal(s.inventory.count(SAPLING), 1);
  s.world.set(10, 3, 10, DIRT); assert.equal(plant(s).ok, true); assert.equal(isSolid(SAPLING), false);
  s.state.now = GROWTH_STAGE_SECONDS - 1; assert.deepEqual(s.upkeep.step(), []);
  for (let stage = 1; stage <= 2; stage++) {
    s.state.now = stage * GROWTH_STAGE_SECONDS; assert.equal(s.upkeep.step().length, 1);
    assert.equal(s.world.get(10, 4, 10), SAPLING + stage); assert.equal(s.upkeep.snapshot().plants[0].stage, stage);
  }
  s.state.now = GROWTH_STAGE_SECONDS * 3;
  assert.ok(s.upkeep.step().length > 4); assert.equal(s.upkeep.plants.size, 0); assert.equal(s.upkeep.queue.heap.length, 0);
  assert.equal(s.world.get(10, 4, 10), WOOD); assert.equal(s.world.get(11, 6, 10), LEAVES);
  assert.equal(s.history.edit(11, 6, 10, AIR).ok, true); assert.equal(s.inventory.craft(SAPLING).ok, true);
  assert.equal(s.inventory.count(SAPLING), 1); assert.equal(s.history.edit(10, 4, 10, AIR).ok, true); assert.equal(s.inventory.count(WOOD), 1);
});

test('mature trees wait for buildings and players to clear without overwriting them', () => {
  const s = setup(); plant(s); s.state.now = GROWTH_STAGE_SECONDS * 3;
  s.world.set(11, 6, 10, REINFORCED_PANEL);
  s.upkeep.step(); assert.equal(s.upkeep.inspect(p).blocked, 'space'); assert.equal(s.world.get(11, 6, 10), REINFORCED_PANEL);
  assert.equal(s.world.get(10, 4, 10), SAPLING + 2);
  s.world.set(11, 6, 10, AIR); s.state.now += 10;
  s.upkeep.step([{ x: 10.5, y: 4, z: 10.5 }]); assert.equal(s.upkeep.inspect(p).blocked, 'player');
  s.state.now += 10; s.upkeep.step([]); assert.equal(s.world.get(10, 4, 10), WOOD);
});

test('removing saplings or their soil removes their scheduled jobs and returns one seedling', () => {
  const s = setup(); plant(s); s.state.now = GROWTH_STAGE_SECONDS; s.upkeep.step();
  assert.equal(s.history.edit(10, 3, 10, AIR).ok, true);
  assert.equal(s.world.get(10, 4, 10), AIR); assert.equal(s.upkeep.plants.size, 0); assert.equal(s.upkeep.queue.heap.length, 0);
  assert.equal(s.inventory.count(SAPLING), 1);
  for (let i = 0; i < 30; i++) { s.world.set(10, 3, 10, DIRT); plant(s); assert.equal(s.history.edit(10, 4, 10, AIR).ok, true); }
  assert.equal(s.upkeep.queue.heap.length, 0); assert.equal(s.upkeep.queue.indices.size, 0);
});

test('growth work is bounded and unloaded terrain cannot be overwritten or generated', () => {
  const s = setup();
  for (let i = 0; i < 20; i++) assert.equal(plant(s, { x: 2 + i * 3 % 60, y: 4, z: 20 + Math.floor(i / 20) * 3 }).ok, true);
  s.state.now = GROWTH_STAGE_SECONDS; s.upkeep.step(); assert.equal(s.upkeep.lastWork, GROWTH_BUDGET);
  assert.ok(s.upkeep.hasDue()); assert.equal(s.upkeep.queue.heap.length, 20);
  s.world.chunks = new Map(); s.world.getChunk = () => { throw new Error('Must only check loaded chunks'); };
  // A chunk lookup is explicitly non-generating; simulate a missing chunk.
  s.world.getChunk = (_x, _z, generate) => { assert.equal(generate, false); return undefined; };
  s.upkeep.step(); assert.ok([...s.upkeep.plants.values()].some(p => p.blocked === 'unloaded'));
  assert.equal(s.upkeep.guard([{ from: AIR, to: SAPLING }]).ok, true);
  s.upkeep.plants = { size: MAX_PLANTS };
  assert.equal(s.upkeep.guard([{ from: AIR, to: SAPLING }]).reason, 'capacity');
});

test('unloaded saplings retain growth deadlines and catch up safely when their terrain returns', () => {
  const s = setup(); plant(s);
  let loaded = false; s.world.chunks = new Map();
  s.world.getChunk = (_cx, _cz, create) => { assert.equal(create, false); return loaded ? {} : undefined; };
  s.state.now = GROWTH_STAGE_SECONDS; s.upkeep.step();
  assert.equal(s.upkeep.inspect(p).dueAt, GROWTH_STAGE_SECONDS);
  assert.equal(s.upkeep.inspect(p).blocked, 'unloaded');
  s.state.now = GROWTH_STAGE_SECONDS * 3; loaded = true; s.upkeep.step();
  assert.equal(s.world.get(p.x, p.y, p.z), WOOD); assert.equal(s.upkeep.plants.size, 0);
  assert.ok(s.upkeep.lastWork <= GROWTH_BUDGET);
});

test('ward charge is finite, power-off preserves it, and refuelling spends one cartridge atomically', () => {
  const s = setup(); ward(s); assert.equal(s.upkeep.wardPower(p).powered, false);
  assert.equal(action(s, 'refuelWard').reason, 'supplies');
  s.inventory.stacks[0] = { block: BIOFUEL, count: 5 };
  assert.equal(action(s, 'refuelWard').ok, true); assert.equal(s.inventory.count(BIOFUEL), 4);
  s.state.now = 100; assert.equal(s.upkeep.wardPower(p).remainingSeconds, FUEL_SECONDS - 100);
  assert.equal(action(s, 'setWardPower', { ...p, enabled: false }).ok, true);
  s.state.now = 1000; assert.equal(s.upkeep.wardPower(p).remainingSeconds, FUEL_SECONDS - 100);
  assert.equal(s.upkeep.wardPower(p).powered, false);
  assert.equal(action(s, 'setWardPower', { ...p, enabled: true }).ok, true);
  s.state.now += FUEL_SECONDS; assert.equal(s.upkeep.wardPower(p).remainingSeconds, 0);
  for (let i = 0; i < 3; i++) assert.equal(action(s, 'refuelWard').ok, true);
  assert.equal(s.upkeep.wardPower(p).remainingSeconds, WARD_CAPACITY);
  assert.equal(action(s, 'refuelWard').reason, 'fuel_full'); assert.equal(s.inventory.count(BIOFUEL), 1);
  assert.equal(s.history.edit(10, 4, 10, AIR).ok, true);
  assert.equal(s.upkeep.wards.size, 0);
  assert.equal(s.history.placeLantern(10, 4, 10, null, WARD_LANTERN).ok, true);
  assert.equal(s.upkeep.wardPower(p).remainingSeconds, 0, 'breaking/replacing a ward cannot mint fuel');
});

test('cached rooms lose protection as fuel expires and recover without rebuilding their enclosure', () => {
  const s = setup();
  for (let x = 5; x <= 11; x++) for (let y = 1; y <= 5; y++) for (let z = 5; z <= 11; z++) s.world.set(x, y, z, x === 5 || x === 11 || y === 1 || y === 5 || z === 5 || z === 11 ? CONCRETE : AIR);
  s.world.set(6, 2, 6, WARD_LANTERN);
  s.upkeep.changed([{ x: 6, y: 2, z: 6, from: AIR, to: WARD_LANTERN }]);
  const target = { x: 6, y: 2, z: 6 }, player = { x: 8.5, y: 2, z: 8.5 }, shelter = new ShelterSystem(s.world, { wardPower: p => s.upkeep.wardPower(p) });
  const status = () => { for (let i = 0; i < 100; i++) { const value = shelter.status(player); if (value.state !== 'checking') return value; shelter.update(); } throw new Error('Shelter did not settle'); };
  assert.equal(status().reason, 'no_power'); s.inventory.stacks[0] = { block: BIOFUEL, count: 2 };
  assert.equal(s.upkeep.command('refuelWard', target, s.inventory, player).ok, true); assert.equal(status().state, 'protected');
  const builds = shelter.sectionBuilds, serial = s.world.serial;
  s.state.now = FUEL_SECONDS; assert.equal(status().reason, 'no_power'); assert.equal(s.world.serial, serial); assert.equal(shelter.sectionBuilds, builds);
  assert.equal(s.upkeep.command('refuelWard', target, s.inventory, player).ok, true); assert.equal(status().state, 'protected');
});

test('salvage is capped, shared, renewable, and cannot be removed or forged as construction', () => {
  const s = setup(); site(s);
  for (let i = 0; i < 4; i++) assert.equal(action(s, 'gatherSalvage').ok, true);
  assert.equal(s.inventory.count(SCRAP), 8); assert.equal(s.inventory.count(STONE), 16); assert.equal(s.inventory.count(SAND), 8);
  assert.equal(action(s, 'gatherSalvage').reason, 'replenishing');
  assert.equal(s.history.edit(10, 4, 10, AIR).reason, 'landmark');
  assert.equal(s.history.edit(15, 4, 15, SALVAGE_CRATE).reason, 'landmark');
  s.state.now = SALVAGE_INTERVAL; assert.equal(action(s, 'gatherSalvage').ok, true); assert.equal(action(s, 'gatherSalvage').reason, 'replenishing');
  s.state.now = SALVAGE_INTERVAL * 10000; assert.deepEqual(s.upkeep.inspect(p).stock, [8, 16, 8]);
  s.inventory.stacks = Array.from({ length: 36 }, () => ({ block: WOOD, count: 64 }));
  const stock = s.upkeep.snapshot().salvage; assert.equal(action(s, 'gatherSalvage').reason, 'inventory_full'); assert.deepEqual(s.upkeep.snapshot().salvage, stock);
  assert.equal(s.upkeep.command('gatherSalvage', p, s.inventory, { x: 60, y: 4, z: 60 }).reason, 'reach');
});

test('repairs restore strength once using a reusable tool and matching material, including upper door halves', () => {
  const s = setup(); s.world.set(10, 4, 10, REINFORCED_PANEL);
  assert.equal(s.history.edit(10, 4, 10, AIR).remaining, 3);
  assert.equal(action(s, 'repair').reason, 'tool');
  s.inventory.stacks[0] = { block: REPAIR_TOOL, count: 1 }; assert.equal(action(s, 'repair').reason, 'supplies');
  s.inventory.stacks[1] = { block: SCRAP, count: 1 }; assert.equal(action(s, 'repair').ok, true);
  assert.equal(action(s, 'repair').reason, 'undamaged'); assert.equal(s.inventory.count(REPAIR_TOOL), 1); assert.equal(s.inventory.count(SCRAP), 0);
  s.world.set(10, 4, 10, CONCRETE); s.history.attackTime = 1; assert.equal(s.history.edit(10, 4, 10, AIR).remaining, 1);
  s.inventory.stacks[1] = { block: STONE, count: 1 }; assert.equal(action(s, 'repair').ok, true); assert.equal(s.inventory.count(STONE), 0);
  s.world.set(10, 4, 10, doorBlock(0, false, false, SECURITY_DOOR)); s.world.set(10, 5, 10, doorBlock(0, false, true, SECURITY_DOOR));
  s.history.attackTime = 2; assert.equal(s.history.edit(10, 5, 10, AIR).remaining, 4);
  s.inventory.stacks[1] = { block: SCRAP, count: 1 }; assert.equal(action(s, 'repair', { ...p, y: 5 }).ok, true); assert.equal(s.infrastructure.damage.size, 0);
});

test('world saves preserve upkeep and offline time freezes fuel, growth, and replenishment', () => {
  const room = new GameRoom(), player = room.join('Gardener'), c = room.horror.cabin;
  const p = { x: c.x - 1, y: c.y + 1, z: c.z + 2 };
  Object.assign(player.pose, { x: p.x - 2, y: p.y, z: p.z });
  player.inventory.stacks[0] = { block: SAPLING, count: 1 };
  assert.equal(room.command(player.id, { method: 'edit', ...p, block: SAPLING, slot: 0, expected: room.expected(p.x, p.y, p.z) }).ok, true);
  room.advance(100); room.leave(player.id);
  const saved = room.toSave(); room.advance(100000); assert.deepEqual(room.toSave().upkeep, saved.upkeep);
  const restored = GameRoom.fromSave(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.upkeep.snapshot(), saved.upkeep); assert.equal(restored.clock.elapsedSeconds, 100);
  for (const mutate of [s => s.upkeep.plants[0].stage = 3, s => s.upkeep.plants[0].dueAt = -1, s => s.upkeep.wards[0].chargeSeconds = WARD_CAPACITY + 1, s => s.upkeep.wards[0].updatedAt++, s => s.upkeep.salvage[0].stock[0] = 999, s => s.upkeep.salvage[0].x++, s => s.upkeep.plants.push(s.upkeep.plants[0])]) {
    const bad = structuredClone(saved); mutate(bad); assert.throws(() => validateSave(bad), /upkeep/);
  }
  assert.throws(() => validateSave({ ...saved, upkeep: { ...saved.upkeep, version: 2 } }), e => e.code === 'SAVE_INCOMPATIBLE');
  assert.equal(validUpkeep({ version: 1, plants: [], wards: [], salvage: [{ ...p, name: 'Bad', stock: Array(3), updatedAt: 0 }] }), false);
});
