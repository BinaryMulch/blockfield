import test from 'node:test';
import assert from 'node:assert/strict';
import { World, SIZE, GRASS, DIRT, STONE, WOOD, LEAVES, SAND, WATER, PLANKS, BRICKS, GLASS, DOOR, LANTERN, SLAB, RED_FLOWER, doorBlock, stepPlayer } from '../src/world.js';
import { FootstepTracker, GameSounds, synthesizeSound } from '../src/sound.js';

test('all material sounds are distinct, bounded, repeatable, and fade out', () => {
  for (const action of ['step', 'place', 'break']) {
    const signatures = new Set();
    for (const material of [GRASS, DIRT, STONE, WOOD, LEAVES, SAND, WATER, PLANKS, BRICKS, GLASS, DOOR, LANTERN, SLAB, RED_FLOWER]) {
      const sound = synthesizeSound(material, action, 44100);
      assert.deepEqual(sound, synthesizeSound(material, action, 44100));
      assert.ok(sound.length > 2000 && sound.length < 15000);
      assert.equal(Math.abs(sound[0]), 0);
      let energy = 0;
      let tailEnergy = 0;
      for (let i = 0; i < sound.length; i++) {
        assert.ok(Number.isFinite(sound[i]) && Math.abs(sound[i]) < 1, 'sound must not clip');
        energy += sound[i] ** 2;
        if (i > sound.length * 0.75) tailEnergy += sound[i] ** 2;
      }
      assert.ok(energy > 0.1, 'effect must be audible');
      assert.ok(tailEnergy < energy * 0.02, 'effect should fade smoothly');
      signatures.add(Buffer.from(sound.buffer).toString('base64'));
    }
    assert.equal(signatures.size, 14);
  }
});

test('door states share material sounds with distinct opening and closing effects', () => {
  assert.deepEqual(synthesizeSound(doorBlock(3, true, true), 'open', 44100), synthesizeSound(DOOR, 'open', 44100));
  assert.notDeepEqual(synthesizeSound(DOOR, 'open', 44100), synthesizeSound(DOOR, 'close', 44100));
});

function ground() {
  const world = new World({ generate: false });
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) world.set(x, 0, z, GRASS);
  }
  return world;
}

function move(world, player, tracker, frames, input = {}) {
  let steps = 0;
  for (let frame = 0; frame < frames; frame++) {
    const before = { ...player };
    stepPlayer(player, world, input, 1 / 120);
    if (tracker.update(before, player)) steps++;
  }
  return steps;
}

test('footstep cadence follows ground distance and speeds up when sprinting', () => {
  const world = ground();
  const player = { x: 30.5, y: 1, z: 30.5, vy: 0, grounded: true };
  const walk = move(world, { ...player }, new FootstepTracker(), 120, { forward: 1 });
  const sprint = move(world, { ...player }, new FootstepTracker(), 120, { forward: 1, sprint: true });
  assert.equal(walk, 2);
  assert.equal(sprint, 4);
});

test('idle movement, blocked movement, and airborne motion stay quiet', () => {
  const world = ground();
  const tracker = new FootstepTracker();
  const player = { x: 8.5, y: 1, z: 6.3, vy: 0, grounded: true };
  assert.equal(move(world, player, tracker, 120), 0);
  world.set(8, 1, 5, WOOD);
  world.set(8, 2, 5, WOOD);
  assert.equal(move(world, player, tracker, 120, { forward: 1, sprint: true }), 0);
  assert.equal(move(world, player, tracker, 30, { jump: true }), 0);
  assert.equal(move(world, player, tracker, 120), 1, 'landing produces just one impact');
  assert.equal(move(world, player, tracker, 120), 0);
});

test('pause resets unfinished steps and unavailable audio does not block the game', async () => {
  const tracker = new FootstepTracker();
  tracker.update({ x: 0, z: 0, grounded: true }, { x: 1.6, z: 0, grounded: true });
  tracker.reset();
  assert.equal(tracker.update({ x: 1.6, z: 0, grounded: true }, { x: 1.8, z: 0, grounded: true }), false);
  const audio = new GameSounds();
  await audio.resume(); // Node has no AudioContext; the game should still be usable.
  assert.doesNotThrow(() => audio.play(STONE, 'break'));
  assert.doesNotThrow(() => audio.setEnabled(false));
  assert.equal(audio.active.size, 0);
});

test('flight stays quiet while moving and when touching the ground', () => {
  const world = ground();
  const tracker = new FootstepTracker();
  const player = { x: 20.5, y: 1, z: 20.5, vy: 0, grounded: false, flying: true };
  assert.equal(move(world, player, tracker, 120, { forward: 1, sprint: true }), 0);
  assert.equal(move(world, player, tracker, 120, { rise: -1 }), 0);
});
