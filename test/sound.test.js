import test from 'node:test';
import assert from 'node:assert/strict';
import { World, SIZE, GRASS, DIRT, STONE, WOOD, LEAVES, SAND, WATER, PLANKS, BRICKS, GLASS, DOOR, LANTERN, SLAB, RED_FLOWER, doorBlock, stepPlayer } from '../src/world.js';
import { FootstepTracker, WaterSoundTracker, GameSounds, synthesizeSound } from '../src/sound.js';

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

test('water entry splashes before landing and movement makes swimming sounds without ground contact', () => {
  const world = ground(), tracker = new WaterSoundTracker();
  for (let z = 8; z < 12; z++) for (let y = 1; y < 4; y++) world.set(8, y, z, WATER);
  const above = { x: 8.5, y: 4, z: 10.5, vy: -8, grounded: false };
  const wet = { ...above, y: 3.7 };
  assert.equal(tracker.update(above, wet, world, 1 / 120), 'splash');
  assert.equal(tracker.wet, true);
  assert.equal(tracker.update(wet, wet, world, 0.3), null, 'floating still stays quiet');
  const moved = { ...wet, z: 8.7 };
  assert.equal(tracker.update(wet, moved, world, 0.3), 'swim');
  assert.equal(tracker.update(moved, { ...moved, y: 1.8 }, world, 0.1), null, 'movement sounds have a cooldown');
  tracker.reset();
  assert.equal(tracker.update(wet, wet, world, 0.3), null, 'resuming underwater does not invent a splash');
});

test('water audio ignores dry banks and flight, and does not splash at submerged cell boundaries', () => {
  const world = ground(), tracker = new WaterSoundTracker();
  world.set(8, 1, 8, WATER); world.set(8, 2, 8, WATER);
  const dry = { x: 9.5, y: 1, z: 8.5, grounded: true };
  assert.equal(tracker.update(dry, { ...dry, z: 7 }, world, 0.5), null);
  const top = { ...dry, x: 8.5, y: 2.8 };
  assert.equal(tracker.update(dry, top, world, 0.5), null, 'visible air above the water surface is dry');
  const wet = { ...top, y: 2.5 };
  assert.equal(tracker.update(top, { ...wet, flying: true }, world, 0.5), null);
  tracker.reset();
  assert.equal(tracker.update({ ...wet, y: 1.85 }, { ...wet, y: 1.75 }, world, 0.5), null, 'deep water has no air gaps between voxels');
  assert.equal(tracker.wet, true);
});

test('splash and swimming effects are audible, distinct, bounded, and fade out', () => {
  const sounds = ['splash', 'swim'].map(action => synthesizeSound(WATER, action, 44100));
  assert.notDeepEqual(sounds[0], sounds[1]);
  for (const samples of sounds) {
    assert.equal(Math.abs(samples[0]), 0);
    assert.ok(samples.every(sample => Number.isFinite(sample) && Math.abs(sample) < 1));
    const energy = samples.reduce((sum, sample) => sum + sample * sample, 0);
    const tail = samples.slice(Math.floor(samples.length * 0.75)).reduce((sum, sample) => sum + sample * sample, 0);
    assert.ok(energy > 0.01);
    assert.ok(tail < energy * 0.02);
  }
});

test('water movement is a soft background sound compared with footsteps and entry splashes', () => {
  const rms = samples => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  for (let variant = 0; variant < 3; variant++) {
    const swim = rms(synthesizeSound(WATER, 'swim', 44100, variant));
    const step = rms(synthesizeSound(GRASS, 'step', 44100, variant));
    const splash = rms(synthesizeSound(WATER, 'splash', 44100, variant));
    assert.ok(swim > 0, 'water movement remains audible');
    assert.ok(swim < step * 0.3, 'wading should sit well below regular footsteps');
    assert.ok(swim < splash * 0.15, 'entry splashes remain distinct from quiet wading');
  }
});
