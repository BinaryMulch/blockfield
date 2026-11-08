import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../server/room.js';
import { STONE, WOOD, PLANKS, STONE_BRICKS, BRACED_TIMBER, WOODEN_CHEST, BRACED_DOOR, WOODEN_PEGS, CHARCOAL, STONE_HAMMER, CONCRETE, REINFORCED_PANEL, STORAGE_CABINET, SECURITY_DOOR, SCRAP, BIOFUEL, REPAIR_TOOL, doorState, buildBlock, cabinetFacing } from '../src/world.js';
import { MATERIALS, Inventory, RECIPES } from '../src/inventory.js';
import { strength } from '../src/infrastructure.js';
import { validateSave } from '../src/saves.js';
import { soundRecipe } from '../src/audio-catalog.js';
import { supplySiteName } from '../src/horror.js';

const itemName = id => MATERIALS.find(item => item.id === id).name;

test('traditional materials replace old item IDs without changing durability or save meaning', () => {
  assert.deepEqual([STONE_BRICKS, BRACED_TIMBER, WOODEN_CHEST, BRACED_DOOR, WOODEN_PEGS, CHARCOAL, STONE_HAMMER], [34, 35, 36, 37, 60, 61, 62]);
  assert.deepEqual([CONCRETE, REINFORCED_PANEL, STORAGE_CABINET, SECURITY_DOOR, SCRAP, BIOFUEL, REPAIR_TOOL], [34, 35, 36, 37, 60, 61, 62]);
  assert.deepEqual([STONE_BRICKS, BRACED_TIMBER, WOODEN_CHEST, BRACED_DOOR].map(strength), [2, 4, 2, 5]);
  assert.deepEqual([34, 35, 36, 37, 60, 61, 62].map(itemName), ['Stone bricks', 'Braced timber', 'Wooden chest', 'Braced wooden door', 'Wooden pegs', 'Charcoal', 'Stone hammer']);
  assert.ok(MATERIALS.every(item => !/concrete|metal|steel|security|cabinet|cartridge|emitter/i.test(item.name)));
});

test('stronger timber and stone, storage and repair tools are craftable from traditional resources', () => {
  const inv = new Inventory(); inv.stacks[0] = { block: WOOD, count: 5 }; inv.stacks[1] = { block: STONE, count: 6 };
  assert.equal(inv.craft(STONE_BRICKS).ok, true); assert.equal(inv.count(STONE_BRICKS), 4);
  for (let i = 0; i < 3; i++) assert.equal(inv.craft(PLANKS).ok, true);
  assert.equal(inv.craft(WOODEN_PEGS).ok, true); assert.equal(inv.count(WOODEN_PEGS), 4);
  assert.equal(inv.craft(BRACED_TIMBER).ok, true); assert.equal(inv.count(BRACED_TIMBER), 2);
  assert.equal(inv.craft(STONE_HAMMER).ok, true); assert.equal(inv.count(STONE_HAMMER), 1);
  assert.deepEqual(RECIPES.find(recipe => recipe.block === WOODEN_CHEST).needs, [[PLANKS, 8]]);
  assert.deepEqual(RECIPES.find(recipe => recipe.block === BRACED_DOOR).needs, [[BRACED_TIMBER, 6]]);
});

test('legacy world blocks, oriented shared storage, damage, doors and item stacks survive a save round trip', () => {
  const room = new GameRoom(), player = room.join('Legacy builder'), c = room.horror.cabin;
  const chest = { x: c.x + 5, y: c.y + 1, z: c.z + 1 };
  room.world.set(chest.x, chest.y, chest.z, 54);
  const stacks = Array(27).fill(null); stacks[0] = { block: 60, count: 8 }; stacks[1] = { block: 61, count: 3 }; stacks[2] = { block: 62, count: 1 };
  room.infrastructure.containers.set(`${chest.x},${chest.y},${chest.z}`, { ...chest, id: 'legacy-cabinet', revision: 7, stacks });
  const wall = { x: c.x + 6, y: c.y + 1, z: c.z + 2 };
  room.world.set(wall.x, wall.y, wall.z, 35); room.infrastructure.setDamage({ ...wall, block: 35, remaining: 2 });
  const door = { x: c.x + 3, y: c.y + 1, z: c.z + 6 };
  room.world.set(door.x, door.y, door.z, 41); room.world.set(door.x, door.y + 1, door.z, 49);
  player.inventory.stacks[0] = { block: 34, count: 12 }; player.inventory.stacks[1] = { block: 35, count: 9 };
  const save = room.toSave(); validateSave(save);
  const restored = GameRoom.fromSave(JSON.parse(JSON.stringify(save)));
  assert.equal(restored.world.get(chest.x, chest.y, chest.z), 54); assert.equal(cabinetFacing(54), 2);
  assert.deepEqual(restored.infrastructure.containers.get(`${chest.x},${chest.y},${chest.z}`).stacks, stacks);
  assert.equal(restored.infrastructure.damage.get(`${wall.x},${wall.y},${wall.z}`).remaining, 2);
  assert.equal(buildBlock(restored.world.get(wall.x, wall.y, wall.z)), BRACED_TIMBER);
  assert.equal(buildBlock(restored.world.get(door.x, door.y + 1, door.z)), BRACED_DOOR);
  assert.deepEqual(doorState(restored.world.get(door.x, door.y, door.z)), { facing: 2, open: false, upper: false });
  assert.deepEqual(restored.toSave().profiles[0][1].stacks.slice(0, 2), [{ block: 34, count: 12 }, { block: 35, count: 9 }]);
});

test('wooden upgrades use wood recordings, masonry uses stone, and legacy landmarks have traditional display names', () => {
  for (const id of [BRACED_TIMBER, WOODEN_CHEST, BRACED_DOOR, WOODEN_PEGS]) {
    for (const action of ['step', 'place', 'break', 'hit', 'repair']) {
      const recipe = soundRecipe(id, action);
      assert.ok(recipe.length); assert.ok(recipe.every(layer => !/metal/.test(layer.file)));
      assert.ok(recipe[0].file.includes('wood'));
    }
  }
  assert.ok(soundRecipe(STONE_BRICKS, 'hit')[0].file.includes('stones'));
  assert.ok(soundRecipe(BRACED_DOOR, 'open')[0].file.includes('wood-door-close'));
  assert.ok(soundRecipe(WOODEN_CHEST, 'close')[0].file.includes('wood-door-close'));
  assert.equal(supplySiteName('Maintenance yard'), 'Woodcutter’s camp');
  assert.equal(supplySiteName('Roadside station'), 'Wayside camp');
  assert.equal(supplySiteName('Abandoned worksite'), 'Old quarry');
  assert.equal(supplySiteName('My old camp'), 'My old camp');
});
