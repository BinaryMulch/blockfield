import test from 'node:test';
import { primeRecordedSounds, recordedPCM } from './support/audio.js';
import assert from 'node:assert/strict';
import { World, SIZE, GRASS, DIRT, STONE, WOOD, LEAVES, SAND, WATER, PLANKS, BRICKS, GLASS, DOOR, LANTERN, SLAB, RED_FLOWER, doorBlock, stepPlayer } from '../src/world.js';
import { FootstepTracker, WaterSoundTracker, GameSounds, soundRecipe, soundGain, SOUND_DISTANCE } from '../src/sound.js';

test('positional sounds fade with three-dimensional distance and stop at 32 blocks', () => {
  const listener = { x: 100, y: 10, z: 200 };
  assert.equal(soundGain(listener, listener), 1);
  assert.equal(soundGain({ ...listener, x: 102 }, listener), 1);
  const halfway = soundGain({ ...listener, x: 117 }, listener);
  assert.equal(halfway, 0.25);
  assert.equal(soundGain({ ...listener, y: 27 }, listener), halfway);
  assert.equal(soundGain({ ...listener, z: 183 }, listener), halfway);
  assert.equal(soundGain({ ...listener, x: 100 + SOUND_DISTANCE }, listener), 0);
  assert.equal(soundGain({ ...listener, y: 1000 }, listener), 0);
  assert.equal(soundGain({ x: NaN, y: 10, z: 200 }, listener), 0);
  assert.equal(soundGain(null, listener), 0);
});

test('inaudible edits allocate no audio and audible effects clean up their gain nodes', () => {
  const sounds = new GameSounds(), sources = [], gains = [];
  sounds.master = { gain: { value: 0.45 } };
  sounds.context = {
    state: 'running', currentTime: 0, sampleRate: 44100,
    createBuffer() { return { copyToChannel() {} }; },
    createBufferSource() {
      const source = { playbackRate: {}, connect(target) { this.target = target; }, start() { this.started = true; },
        stop() { this.onended(); }, disconnect() { this.disconnected = true; } };
      sources.push(source); return source;
    },
    createGain() {
      const gain = { gain: {}, connect(target) { this.target = target; }, disconnect() { this.disconnected = true; } };
      gains.push(gain); return gain;
    },
  };
  primeRecordedSounds(sounds);
  const cached = sounds.buffers.size;
  const listener = { x: 0, y: 0, z: 0 };
  sounds.playAt(STONE, 'break', { ...listener, x: 32 }, listener);
  sounds.playAt(DOOR, 'open', { ...listener, y: 50 }, listener);
  assert.equal(sources.length, 0);
  assert.equal(sounds.buffers.size, cached);
  sounds.playAt(DOOR, 'close', { ...listener, x: 17 }, listener);
  assert.equal(sources[0].started, true);
  assert.equal(sources[0].target, gains[0]);
  assert.equal(gains[0].target, sounds.master);
  assert.equal(gains[0].gain.value, 0.25 * soundRecipe(DOOR, 'close')[0].gain);
  sounds.play(WATER, 'swim');
  assert.equal(gains[1].gain.value, soundRecipe(WATER, 'swim')[0].gain, 'local wading uses its quiet recorded mix');
  sounds.stop();
  assert.equal(sounds.active.size, 0);
  assert.ok(sources.every(source => source.disconnected));
  assert.ok(gains.every(gain => gain.disconnected));
  sounds.setEnabled(false);
  sounds.playAt(STONE, 'break', listener, listener);
  assert.equal(sources.length, 2);
});

test('recorded material families use distinct samples with natural tails and no clipping', () => {
  const signatures = new Set();
  for (const material of [GRASS, STONE, WOOD, LEAVES, WATER, GLASS, LANTERN]) {
    const recipe = soundRecipe(material, 'break');
    assert.ok(recipe.length); assert.deepEqual(recipe, soundRecipe(material, 'break'));
    const sound = recordedPCM(recipe[0].file);
    assert.ok(sound.length > 2000 && sound.length < 44100 * 4);
    assert.ok(sound.every(value => Number.isFinite(value) && Math.abs(value) <= .8));
    assert.ok(sound.some(value => Math.abs(value) > .1));
    assert.equal(sound.at(-1), 0);
    signatures.add(recipe[0].file);
  }
  assert.equal(signatures.size, 7);
});

test('door states share recorded material sounds with distinct opening and closing effects', () => {
  assert.deepEqual(soundRecipe(doorBlock(3, true, true), 'open'), soundRecipe(DOOR, 'open'));
  assert.notDeepEqual(soundRecipe(DOOR, 'open'), soundRecipe(DOOR, 'close'));
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

test('water entry layers splashes while wading stays much quieter than footsteps', () => {
  const swim = soundRecipe(WATER, 'swim'), splash = soundRecipe(WATER, 'splash'), step = soundRecipe(GRASS, 'step');
  assert.equal(swim.length, 1); assert.equal(splash.length, 2);
  assert.ok(swim[0].file.includes('wet'));
  assert.ok(swim[0].gain < step[0].gain * .3);
  assert.ok(swim[0].gain < splash.reduce((sum, layer) => sum + layer.gain, 0) * .15);
});
