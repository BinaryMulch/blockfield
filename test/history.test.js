import test from 'node:test';
import assert from 'node:assert/strict';
import { World, AIR, GRASS, STONE, WATER, PLANKS, BRICKS } from '../src/world.js';
import { EditHistory } from '../src/history.js';

test('multiple material edits undo and redo in order', () => {
  const world = new World({ generate: false });
  const history = new EditHistory(world);
  world.set(4, 3, 4, GRASS);
  assert.equal(history.edit(4, 3, 4, AIR).ok, true);
  assert.equal(history.edit(4, 3, 4, PLANKS).ok, true);
  assert.equal(history.edit(5, 3, 4, BRICKS).ok, true);
  for (const [position, block] of [[[5, 3, 4], AIR], [[4, 3, 4], AIR], [[4, 3, 4], GRASS]]) {
    assert.equal(history.undo().ok, true);
    assert.equal(world.get(...position), block);
  }
  assert.equal(history.undo().reason, 'empty');
  for (const [position, block] of [[[4, 3, 4], AIR], [[4, 3, 4], PLANKS], [[5, 3, 4], BRICKS]]) {
    assert.equal(history.redo().ok, true);
    assert.equal(world.get(...position), block);
  }
  assert.equal(history.redo().reason, 'empty');
});

test('undoing a filled pond restores water and redo restores the building block', () => {
  const world = new World({ generate: false });
  const history = new EditHistory(world);
  world.set(4, 3, 4, WATER);
  history.edit(4, 3, 4, BRICKS);
  const undone = history.undo({ x: 4.5, y: 3, z: 4.5 });
  assert.equal(undone.ok, true, 'restoring water may overlap the player');
  assert.equal(world.get(4, 3, 4), WATER);
  assert.equal(history.redo({ x: 4.5, y: 3, z: 4.5 }).reason, 'blocked');
  assert.equal(world.get(4, 3, 4), WATER);
  assert.equal(history.redo({ x: 10, y: 3, z: 10 }).ok, true);
  assert.equal(world.get(4, 3, 4), BRICKS);
});

test('blocked restores keep their history entry available until the player moves', () => {
  const world = new World({ generate: false });
  const history = new EditHistory(world);
  world.set(4, 3, 4, STONE);
  history.edit(4, 3, 4, AIR);
  const player = { x: 4.5, y: 3, z: 4.5 };
  assert.equal(history.undo(player).reason, 'blocked');
  assert.equal(history.undoStack.length, 1);
  assert.equal(history.redoStack.length, 0);
  assert.equal(world.get(4, 3, 4), AIR);
  player.x = 8;
  assert.equal(history.undo(player).ok, true);
  assert.equal(world.get(4, 3, 4), STONE);
});

test('only successful new edits clear redo; bounds and the foundation stay protected', () => {
  const world = new World({ generate: false });
  const history = new EditHistory(world);
  world.set(4, 0, 4, STONE);
  history.edit(4, 3, 4, PLANKS);
  history.undo();
  assert.equal(history.edit(4, 3, 4, AIR).ok, false);
  assert.equal(history.edit(4, 0, 4, AIR).ok, false);
  assert.equal(history.edit(-1, 3, 4, BRICKS).ok, false);
  assert.equal(history.redoStack.length, 1);
  assert.equal(world.get(4, 0, 4), STONE);
  history.edit(5, 3, 4, BRICKS);
  assert.equal(history.redo().reason, 'empty');
});

test('history is bounded and replay does not overwrite an unexpectedly changed cell', () => {
  const world = new World({ generate: false });
  const history = new EditHistory(world, 3);
  for (let x = 1; x <= 5; x++) history.edit(x, 3, 4, BRICKS);
  assert.equal(history.undoStack.length, 3);
  world.set(5, 3, 4, STONE);
  assert.equal(history.undo().reason, 'changed');
  assert.equal(world.get(5, 3, 4), STONE);
  assert.equal(history.undoStack.length, 3);
  world.set(5, 3, 4, BRICKS);
  for (let i = 0; i < 3; i++) assert.equal(history.undo().ok, true);
  assert.equal(history.undo().reason, 'empty');
  assert.equal(world.get(1, 3, 4), BRICKS);
  assert.equal(world.get(2, 3, 4), BRICKS);
});
