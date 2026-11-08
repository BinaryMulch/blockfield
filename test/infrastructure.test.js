import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../server/room.js';
import { ChunkWorld } from '../src/chunks.js';
import { World, AIR, WOOD, PLANKS, STONE, SAND, GLASS, CONCRETE, SCRAP, REINFORCED_PANEL, STORAGE_CABINET, SECURITY_DOOR, isDoor, isBlock, isCabinet, cabinetFacing, cabinetBlock, cabinetBlockFromYaw, doorBlock, doorState, buildBlock } from '../src/world.js';
import { Infrastructure, STORAGE_SLOTS, strength, validInfrastructure } from '../src/infrastructure.js';
import { Inventory, RECIPES } from '../src/inventory.js';
import { EditHistory } from '../src/history.js';
import { validateSave } from '../src/saves.js';
import { buildTerrainGeometry } from '../src/terrain.js';
import { TILE_SIZE, TILES, generateTextureTiles, faceTile, tileUVs } from '../src/textures.js';

const p = { x: 10, y: 4, z: 10 }, pose = { x: 12.5, y: 4, z: 12.5 };
function setup() {
  const world = new World({ generate: false }); world.set(p.x, p.y, p.z, STORAGE_CABINET);
  return { world, infrastructure: new Infrastructure(world), inventory: new Inventory() };
}
const open = (s, id = 'cabinet-1') => s.infrastructure.storage('openStorage', p, s.inventory, pose, id).storage;
const transfer = (s, c, source, index, amount, inv = s.inventory) => s.infrastructure.storage('storage', { ...p, containerId: c.id, revision: c.revision, source, index, amount,
  expectedSource: { ...(source === 'player' ? inv.stacks[index] : c.stacks[index]) } }, inv, pose);

test('placed cabinets face the player from all four directions and render their fronts on that side', () => {
  const placements = [
    { yaw: 0, x: 10.5, z: 13.5, front: [0, 0, 1] },
    { yaw: -Math.PI / 2, x: 7.5, z: 10.5, front: [-1, 0, 0] },
    { yaw: Math.PI, x: 10.5, z: 7.5, front: [0, 0, -1] },
    { yaw: Math.PI / 2, x: 13.5, z: 10.5, front: [1, 0, 0] },
  ];
  for (const [facing, placement] of placements.entries()) {
    const world = new World({ generate: false }), inventory = new Inventory(), h = new EditHistory(world);
    h.inventory = inventory; inventory.stacks[0] = { block: STORAGE_CABINET, count: 1 };
    assert.equal(h.edit(p.x, p.y, p.z, STORAGE_CABINET, { ...placement, y: p.y }).ok, true);
    const block = world.get(p.x, p.y, p.z);
    assert.equal(block, cabinetBlock(facing)); assert.equal(cabinetFacing(block), facing);
    assert.ok(isBlock(block) && isCabinet(block) && !isDoor(block));
    assert.equal(buildBlock(block), STORAGE_CABINET); assert.equal(strength(block), 2); assert.equal(inventory.count(STORAGE_CABINET), 0);
    assert.equal(faceTile(block, 0), TILES.CHEST_FRONT, 'inventory icons always show the front');
    const geometry = buildTerrainGeometry(world), normals = geometry.getAttribute('normal'), uvs = geometry.getAttribute('uv');
    let frontFaces = 0;
    for (let i = 0; i < normals.count; i += 4) {
      const normal = [normals.getX(i), normals.getY(i), normals.getZ(i)];
      const front = normal.every((value, axis) => value === placement.front[axis]);
      const tile = front ? TILES.CHEST_FRONT : normal[1] ? TILES.CHEST_TOP : TILES.CHEST_SIDE;
      if (front) frontFaces++;
      assert.deepEqual([uvs.getX(i), uvs.getY(i)], tileUVs(tile)[0]);
    }
    assert.equal(frontFaces, 1); geometry.dispose();
    assert.equal(cabinetBlockFromYaw(placement.yaw + .1), block, 'slight look changes snap to the same direction');
    assert.equal(cabinetBlockFromYaw(placement.yaw + Math.PI * 4), block, 'full rotations preserve placement');
  }
});

test('all cabinet orientations retain storage protection, durability, and a single canonical item when broken', () => {
  for (let facing = 0; facing < 4; facing++) {
    const s = setup(); s.world.set(p.x, p.y, p.z, cabinetBlock(facing));
    s.inventory.stacks[0] = { block: WOOD, count: 7 };
    let c = transfer(s, open(s), 'player', 0, 7).storage;
    const h = new EditHistory(s.world); h.infrastructure = s.infrastructure; h.inventory = s.inventory;
    assert.equal(h.edit(p.x, p.y, p.z, AIR).reason, 'storage_not_empty');
    c = transfer(s, c, 'storage', 0, 7).storage;
    assert.equal(c.stacks[0], null);
    assert.equal(h.edit(p.x, p.y, p.z, AIR).remaining, 1);
    assert.equal(s.infrastructure.snapshot().construction[0].block, STORAGE_CABINET);
    h.attackTime = 1; assert.equal(h.edit(p.x, p.y, p.z, AIR).ok, true);
    assert.equal(s.inventory.count(STORAGE_CABINET), 1); assert.equal(s.inventory.count(WOOD), 7);
    assert.equal(s.infrastructure.containers.size, 0); assert.equal(s.infrastructure.damage.size, 0);
  }
});

test('cabinet transfers conserve supplies, merge stacks, split one, and reject stale revisions', () => {
  const s = setup(), c = open(s); assert.equal(c.stacks.length, STORAGE_SLOTS);
  s.inventory.stacks[0] = { block: WOOD, count: 64 };
  let result = transfer(s, c, 'player', 0, 64);
  assert.equal(result.moved, 64); assert.equal(s.inventory.count(WOOD), 0);
  assert.equal(transfer(s, c, 'storage', 0, 64).reason, 'changed');
  result = transfer(s, result.storage, 'storage', 0, 1);
  assert.equal(s.inventory.count(WOOD), 1); assert.equal(result.storage.stacks[0].count, 63);
  s.inventory.stacks[1] = { block: WOOD, count: 10 };
  result = transfer(s, result.storage, 'player', 1, 10);
  assert.deepEqual(result.storage.stacks.slice(0, 2), [{ block: WOOD, count: 64 }, { block: WOOD, count: 9 }]);
  assert.equal(s.inventory.count(WOOD), 1);
});

test('two players using the same cabinet snapshot cannot take the same items twice', () => {
  const s = setup(), second = new Inventory(); s.inventory.stacks[0] = { block: STONE, count: 19 };
  const c = transfer(s, open(s), 'player', 0, 19).storage;
  assert.equal(transfer(s, c, 'storage', 0, 19).ok, true);
  const stale = transfer(s, c, 'storage', 0, 19, second);
  assert.equal(stale.reason, 'changed'); assert.equal(stale.storage.stacks[0], null);
  assert.equal(second.count(STONE), 0); assert.equal(s.inventory.count(STONE), 19);
});

test('full destinations and forged source, amount, cabinet identity, and remote access never lose items', () => {
  const s = setup(); s.inventory.stacks[0] = { block: WOOD, count: 5 };
  const c = open(s), record = s.infrastructure.containers.values().next().value;
  record.stacks.fill(null); for (let i = 0; i < 27; i++) record.stacks[i] = { block: STONE, count: 64 };
  const before = s.infrastructure.snapshot();
  assert.equal(transfer(s, c, 'player', 0, 5).reason, 'inventory_full');
  const args = { ...p, containerId: c.id, revision: c.revision, source: 'player', index: 0, amount: 5, expectedSource: { block: WOOD, count: 5 } };
  for (const bad of [{ amount: -1 }, { amount: 65 }, { amount: 1.5 }, { source: 'anything' }, { index: 36 }, { expectedSource: { block: WOOD, count: 6 } }, { containerId: 'different-cabinet' }]) {
    assert.equal(s.infrastructure.storage('storage', { ...args, ...bad }, s.inventory, pose).ok, false);
    assert.deepEqual(s.infrastructure.snapshot(), before); assert.equal(s.inventory.count(WOOD), 5);
  }
  assert.equal(s.infrastructure.storage('openStorage', p, s.inventory, { x: 50, y: 4, z: 50 }, 'remote').reason, 'reach');
});

test('partial destination capacity moves only what fits and leaves the remainder in its source', () => {
  const s = setup(); const c = open(s), record = s.infrastructure.containers.values().next().value;
  record.stacks = Array.from({ length: 27 }, () => ({ block: WOOD, count: 64 })); record.stacks[0].count = 61;
  s.inventory.stacks[0] = { block: WOOD, count: 10 };
  const result = transfer(s, c, 'player', 0, 10);
  assert.equal(result.moved, 3); assert.equal(s.inventory.count(WOOD), 7); assert.equal(result.storage.stacks[0].count, 64);
});

test('stocked cabinets refuse dismantling; replacement cabinet identities reject stale windows', () => {
  const s = setup(); s.inventory.stacks[0] = { block: WOOD, count: 1 };
  const c = transfer(s, open(s), 'player', 0, 1).storage;
  const history = new EditHistory(s.world); history.infrastructure = s.infrastructure;
  assert.equal(history.edit(p.x, p.y, p.z, AIR).reason, 'storage_not_empty');
  assert.equal(s.infrastructure.damage.size, 0);
  assert.equal(transfer(s, c, 'storage', 0, 1).ok, true);
  assert.equal(history.edit(p.x, p.y, p.z, AIR).remaining, 1);
  history.attackTime = .31; assert.equal(history.edit(p.x, p.y, p.z, AIR).ok, true);
  assert.equal(s.infrastructure.containers.size, 0); assert.equal(s.infrastructure.damage.size, 0);
  s.world.set(p.x, p.y, p.z, STORAGE_CABINET);
  const replacement = open(s, 'cabinet-2');
  assert.notEqual(replacement.id, c.id); assert.equal(transfer(s, c, 'player', 0, 1).reason, 'changed');
});

test('reinforced blocks share persistent strength across players and yield a single item on the final strike', () => {
  const world = new ChunkWorld({ seed: 'strength' }), room = new GameRoom({ world }), a = room.join('A'), b = room.join('B');
  world.set(p.x, p.y, p.z, REINFORCED_PANEL);
  for (const player of [a, b]) Object.assign(player.pose, pose);
  const hit = player => room.command(player.id, { method: 'edit', ...p, block: AIR, expected: room.expected(p.x, p.y, p.z) });
  assert.equal(hit(a).remaining, 3); assert.equal(hit(a).reason, 'cooldown'); assert.equal(hit(b).remaining, 2);
  assert.equal(a.inventory.count(REINFORCED_PANEL), 0); assert.equal(room.revision, 0);
  const restored = GameRoom.fromSave(room.toSave()), c = restored.join('C'); Object.assign(c.pose, pose);
  const next = () => restored.command(c.id, { method: 'edit', ...p, block: AIR, expected: restored.expected(p.x, p.y, p.z) });
  assert.equal(next().remaining, 1); restored.advance(.31); assert.equal(next().ok, true);
  assert.equal(world.get(p.x, p.y, p.z), REINFORCED_PANEL, 'restoring a save does not mutate the old world');
  assert.equal(restored.world.get(p.x, p.y, p.z), AIR); assert.equal(c.inventory.count(REINFORCED_PANEL), 0);
  assert.equal(restored.drops.items.filter(item => item.block === REINFORCED_PANEL).length, 1);
  assert.equal(restored.infrastructure.damage.size, 0);
});

test('a full player inventory never removes a reinforced block on the final strike', () => {
  const s = setup(); s.world.set(p.x, p.y, p.z, CONCRETE);
  const h = new EditHistory(s.world); h.infrastructure = s.infrastructure; h.inventory = s.inventory;
  assert.equal(h.edit(p.x, p.y, p.z, AIR).remaining, 1);
  s.inventory.stacks = Array.from({ length: 36 }, () => ({ block: WOOD, count: 64 }));
  h.attackTime = 1; assert.equal(h.edit(p.x, p.y, p.z, AIR).reason, 'inventory_full');
  assert.equal(s.world.get(p.x, p.y, p.z), CONCRETE); assert.equal(s.infrastructure.damage.get('10,4,10').remaining, 1);
  s.inventory.stacks[0] = null;
  assert.equal(h.edit(p.x, p.y, p.z, AIR).ok, true); assert.equal(s.inventory.count(CONCRETE), 1);
});

test('security doors preserve their type and damage when toggled, and remove both halves for one item', () => {
  const world = new World({ generate: false }), infra = new Infrastructure(world), inventory = new Inventory(), h = new EditHistory(world);
  h.infrastructure = infra; h.inventory = inventory; world.set(10, 3, 10, CONCRETE);
  inventory.stacks[0] = { block: SECURITY_DOOR, count: 1 };
  assert.equal(h.placeDoor(10, 4, 10, 3, null, SECURITY_DOOR).ok, true); assert.equal(inventory.count(SECURITY_DOOR), 0);
  assert.equal(world.doorAt(10, 5, 10).bottom, doorBlock(3, false, false, SECURITY_DOOR));
  assert.equal(h.edit(10, 5, 10, AIR).remaining, 4);
  assert.equal(h.toggleDoor(10, 5, 10).ok, true); assert.equal(doorState(world.get(10, 4, 10)).open, true);
  assert.equal(infra.damage.get('10,4,10').remaining, 4);
  for (let i = 1; i <= 4; i++) { h.attackTime = i; assert.equal(h.edit(10, 5, 10, AIR).ok, true); }
  assert.equal(world.get(10, 4, 10), AIR); assert.equal(world.get(10, 5, 10), AIR);
  assert.equal(inventory.count(SECURITY_DOOR), 1); assert.equal(infra.damage.size, 0);
  for (let facing = 0; facing < 4; facing++) for (const open of [true, false]) for (const upper of [true, false]) {
    const b = doorBlock(facing, open, upper, SECURITY_DOOR);
    assert.ok(isDoor(b)); assert.equal(buildBlock(b), SECURITY_DOOR); assert.equal(strength(b), 5);
    assert.deepEqual(doorState(b), { facing, open, upper });
  }
});

test('storage and structural damage round trip together and malformed or orphaned records are rejected', () => {
  const room = new GameRoom(), player = room.join('Builder'), { x, y, z } = room.horror.cabin;
  const position = { x: x + 5, y: y + 1, z: z + 1 }; Object.assign(player.pose, { x: x + 4.5, y: y + 1, z: z + 3.5 });
  player.inventory.stacks[0] = { block: WOOD, count: 23 };
  const c = room.command(player.id, { method: 'openStorage', ...position }).storage;
  assert.equal(room.command(player.id, { method: 'storage', ...position, containerId: c.id, revision: 0, source: 'player', index: 0, amount: 23, expectedSource: { block: WOOD, count: 23 } }).ok, true);
  assert.equal(room.command(player.id, { method: 'edit', x: x + 6, y: y + 1, z: z + 2, block: AIR, expected: room.expected(x + 6, y + 1, z + 2) }).remaining, 3);
  const save = room.toSave(), restored = GameRoom.fromSave(JSON.parse(JSON.stringify(save)));
  assert.deepEqual(restored.infrastructure.snapshot(), room.infrastructure.snapshot());
  for (const mutate of [s => s.containers[0].stacks.pop(), s => s.containers[0].stacks[0].count = 65, s => s.containers.push(s.containers[0]), s => s.containers[0].x++, s => s.construction[0].remaining = 4, s => s.construction[0].block = CONCRETE]) {
    const bad = structuredClone(save); mutate(bad); assert.throws(() => validateSave(bad), /storage|construction|damage/i);
  }
  assert.equal(validInfrastructure([{ ...c, stacks: Array(27) }]), false);
});

test('traditional reinforced recipes consume wood and stone ingredients', () => {
  const inv = new Inventory(); inv.stacks[0] = { block: STONE, count: 4 }; inv.stacks[1] = { block: SAND, count: 1 };
  assert.equal(inv.craft(CONCRETE).ok, true); assert.equal(inv.count(CONCRETE), 4);
  inv.stacks[0] = { block: PLANKS, count: 4 }; inv.stacks[1] = { block: SCRAP, count: 1 }; assert.equal(inv.craft(REINFORCED_PANEL).ok, true);
  assert.equal(inv.count(PLANKS), 0); assert.equal(inv.count(SCRAP), 0); assert.equal(inv.count(REINFORCED_PANEL), 2);
  assert.ok(RECIPES.some(r => r.block === STORAGE_CABINET)); assert.ok(RECIPES.some(r => r.block === SECURITY_DOOR));
  inv.stacks[0] = { block: REINFORCED_PANEL, count: 6 }; inv.stacks[1] = { block: GLASS, count: 1 };
  assert.equal(inv.craft(SECURITY_DOOR).ok, true); assert.equal(inv.count(SECURITY_DOOR), 1);
});

test('classic 16px textures retain distinct infrastructure faces and valid mesh UVs', () => {
  assert.equal(TILE_SIZE, 16); const tiles = generateTextureTiles();
  for (const id of [TILES.STONE_BRICKS, TILES.BRACED_TIMBER, TILES.CHEST_FRONT, TILES.BRACED_DOOR_TOP]) {
    let varied = 0;
    for (let y = 0; y < TILE_SIZE; y += 2) for (let x = 0; x < TILE_SIZE; x += 2) if (tiles[id][(x + y * TILE_SIZE) * 4] !== tiles[id][(x + 1 + y * TILE_SIZE) * 4]) varied++;
    assert.ok(varied > 32, 'infrastructure must retain visible pixel detail on the 16px grid');
  }
  assert.equal(faceTile(STORAGE_CABINET, 0, 0, 1), TILES.CHEST_FRONT);
  assert.equal(faceTile(STORAGE_CABINET, 0, 1, 0), TILES.CHEST_SIDE);
  assert.equal(faceTile(STORAGE_CABINET, 1), TILES.CHEST_TOP);
  const world = new World({ generate: false });
  world.set(10, 4, 10, STORAGE_CABINET); world.set(12, 4, 10, REINFORCED_PANEL);
  const geometry = buildTerrainGeometry(world);
  assert.ok(geometry.getAttribute('position').count > 0);
  for (const uv of geometry.getAttribute('uv').array) assert.ok(uv >= 0 && uv <= 1);
  for (const id of Object.values(TILES)) for (const uv of tileUVs(id).flat()) assert.ok(uv >= 0 && uv <= 1);
  geometry.dispose();
});
