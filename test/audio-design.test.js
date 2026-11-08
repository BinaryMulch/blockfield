import test from 'node:test';
import { primeRecordedSounds } from './support/audio.js';
import { EFFECT_FILES, soundRecipe, cueRecipe, pickupRecipe } from '../src/audio-catalog.js';
import assert from 'node:assert/strict';
import { World, STONE, GRASS, WOOD, LEAVES, SAPLING, DOOR, CONCRETE, REINFORCED_PANEL, SECURITY_DOOR, WARD_LANTERN, WATER } from '../src/world.js';
import { GameSounds, soundPan, MAX_SOUND_VOICES, MAX_SOUND_BUFFERS } from '../src/sound.js';

function audio() {
  const sound = new GameSounds(), sources = [], nodes = [];
  const node = type => { const n = { type, gain: {}, pan: {}, frequency: {}, connect(target) { this.target = target; }, disconnect() { this.disconnected = true; } }; nodes.push(n); return n; };
  sound.master = node('master');
  sound.context = { state: 'running', currentTime: 0, sampleRate: 16000,
    createBuffer: () => ({ copyToChannel() {} }), createGain: () => node('gain'), createStereoPanner: () => node('pan'), createBiquadFilter: () => node('filter'),
    createBufferSource() { const n = node('source'); n.playbackRate = {}; n.start = (...args) => { n.startArgs = args; }; n.stop = () => { n.onended(); }; sources.push(n); return n; },
  };
  primeRecordedSounds(sound);
  return { sound, sources, nodes };
}

test('effects use physical recordings with material and action specific layers', () => {
  assert.notDeepEqual(soundRecipe(CONCRETE, 'hit'), soundRecipe(REINFORCED_PANEL, 'hit'));
  assert.notDeepEqual(soundRecipe(WOOD, 'break', 0), soundRecipe(WOOD, 'break', 1));
  assert.ok(soundRecipe(WOOD, 'open').length === 0, 'a log cannot emit a door creak');
  assert.ok(soundRecipe(SECURITY_DOOR, 'open').some(layer => layer.file.includes('door')));
  assert.deepEqual(soundRecipe(255, 'break'), []);
  assert.deepEqual(soundRecipe(STONE, 'unknown'), []);
});

test('leaves and saplings play short clipped rustles and opening doors uses the closing latch family', () => {
  const { sound, sources } = audio();
  for (const block of [LEAVES, SAPLING]) for (const action of ['hit', 'place', 'break']) {
    const recipe = soundRecipe(block, action); assert.equal(recipe.length, 1); assert.ok(recipe[0].duration <= .18);
    sound.play(block, action);
    const source = sources.at(-1); assert.ok(source.startArgs[2] <= .18); assert.ok(source.startArgs[2] > 0);
  }
  for (const block of [DOOR, SECURITY_DOOR]) {
    assert.ok(soundRecipe(block, 'open')[0].file.includes('wood-door-close'));
    assert.ok(soundRecipe(block, 'close')[0].file.includes('wood-door-close'));
  }
});

test('pickup uses its own short rising cue and respects mute and effects volume', () => {
  const { sound, sources, nodes } = audio();
  assert.ok(pickupRecipe().every(layer => EFFECT_FILES.includes(layer.file) && layer.duration <= .18));
  assert.equal(pickupRecipe()[0].file, '/audio/sfx/pickup.wav');
  assert.equal(EFFECT_FILES[0], pickupRecipe()[0].file, 'preload pickup feedback first');
  sound.playPickup(); assert.equal(sources.length, 1);
  assert.ok(sources[0].startArgs[2] / sources[0].playbackRate.value <= .18);
  assert.ok(nodes.find(node => node.type === 'gain').gain.value >= .9, 'pickup must remain clear over normal gameplay sounds');
  sound.setEnabled(false); sound.playPickup(); assert.equal(sources.length, 1);
  sound.setEnabled(true); sound.setEffectsVolume(0); sound.playPickup(); assert.equal(sources.length, 1);
});

test('a first pickup still plays during a short decode delay and never replays after a pause', async t => {
  const { sound, sources } = audio(); sound.buffers.clear();
  let finish;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  sound.context.decodeAudioData = () => new Promise(resolve => { finish = resolve; });
  sound.playPickup(); await new Promise(setImmediate);
  sound.context.currentTime += .25; finish({ duration: .21 }); await new Promise(setImmediate);
  assert.equal(sources.length, 1, 'a short first-use load must not swallow pickup feedback');
  sound.buffers.clear(); sound.playPickup(); await new Promise(setImmediate);
  sound.stop(); finish({ duration: .21 }); await new Promise(setImmediate);
  assert.equal(sources.length, 1, 'pausing cancels pending pickup audio');
});

test('Listener impacts add louder priority thumps and scraping to every structural hit', () => {
  const { sound, sources, nodes } = audio(), position = { x: 5, y: 2, z: 5 };
  sound.playAt(REINFORCED_PANEL, 'hit', position, position);
  const ordinary = nodes.find(n => n.type === 'gain').gain.value;
  sound.stop(); const start = nodes.length;
  sound.playListenerImpact(REINFORCED_PANEL, 'hit', position, position);
  const impacts = nodes.slice(start).filter(n => n.type === 'gain').map(n => n.gain.value);
  assert.ok(Math.max(...impacts) > ordinary); assert.ok(impacts.length >= 4);
  assert.ok(sources.at(-1).buffer.file.includes('breath'));
});

test('Listener cues use breathing, cloth, footsteps and scraping recordings', () => {
  const signatures = new Set();
  for (const kind of ['step', 'alert', 'notice', 'search', 'pursuit', 'pressure', 'breath', 'retreat']) {
    const recipe = cueRecipe(kind); assert.deepEqual(recipe, cueRecipe(kind)); assert.ok(recipe.length);
    for (const layer of recipe) { assert.ok(EFFECT_FILES.includes(layer.file)); assert.ok(layer.gain > 0 && layer.gain < 1); }
    signatures.add(JSON.stringify(recipe));
  }
  assert.equal(signatures.size, 8);
  assert.ok(cueRecipe('breath')[0].file.includes('breath'));
  assert.ok(cueRecipe('pressure')[0].file.includes('scrape'));
  assert.deepEqual(cueRecipe('unknown'), []);
  assert.ok(soundRecipe(WARD_LANTERN, 'ward_on')[0].file.includes('switch'));
  assert.notDeepEqual(soundRecipe(WARD_LANTERN, 'ward_on'), soundRecipe(WARD_LANTERN, 'ward_off'));
});

test('stereo direction follows camera yaw and walls attenuate and filter spatial sound', () => {
  assert.equal(soundPan({ x: 10, z: 0 }, { x: 0, z: 0, yaw: 0 }), 1);
  assert.equal(soundPan({ x: -10, z: 0 }, { x: 0, z: 0, yaw: 0 }), -1);
  assert.ok(soundPan({ x: 0, z: -10 }, { x: 0, z: 0, yaw: Math.PI / 2 }) > .99);
  const { sound, nodes } = audio(), world = new World({ generate: false });
  const ear = { x: 5.5, y: 2.5, z: 5.5, yaw: 0 }, source = { x: 9.5, y: 2.5, z: 5.5 };
  sound.setListener(ear, world); const clear = sound.position(source);
  world.set(7, 2, 5, STONE); const muffled = sound.position(source);
  assert.ok(muffled.gain < clear.gain); assert.equal(muffled.cutoff, 850);
  sound.playAt(CONCRETE, 'break', source, ear);
  assert.ok(nodes.some(n => n.type === 'pan' && n.pan.value > .99)); assert.ok(nodes.some(n => n.type === 'lowpass' && n.frequency.value === 850));
  sound.stop(); assert.equal(sound.active.size, 0); assert.ok(nodes.filter(n => n.type !== 'master').every(n => n.disconnected));
});

test('voice count stays bounded during repeated construction and priority creature cues', () => {
  const { sound } = audio();
  for (let i = 0; i < 100; i++) sound.play(STONE, 'break'); assert.equal(sound.active.size, MAX_SOUND_VOICES);
  sound.playCueAt('alert', { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 0 }); assert.equal(sound.active.size, MAX_SOUND_VOICES);
  sound.stop(); assert.equal(sound.active.size, 0);
  assert.ok(sound.buffers.size <= MAX_SOUND_BUFFERS);
});

test('mute allocates no audio while audibility remains available for equivalent captions', () => {
  const { sound, sources } = audio(); sound.setEnabled(false);
  const p = { x: 12, y: 2, z: 12 };
  assert.ok(sound.playCueAt('breath', p, { ...p, x: 14 }) > 0); assert.equal(sources.length, 0);
  sound.play(CONCRETE, 'hit'); assert.equal(sources.length, 0);
});

test('remote footsteps follow actual travel and ignore self, idle motion, and teleports', () => {
  const { sound, sources } = audio(), world = new World({ generate: false });
  for (let x = 0; x < 20; x++) world.set(x, 0, 5, GRASS);
  sound.setListener({ x: 5.5, y: 2.6, z: 5.5 }, world);
  const p = { id: 'other', x: 8.5, y: 1.01, z: 5.5, active: true };
  sound.trackPlayers([p], 'self'); sound.trackPlayers([p], 'self'); assert.equal(sources.length, 0);
  sound.trackPlayers([{ ...p, x: 10.3 }], 'self'); assert.equal(sources.length, 1);
  sound.trackPlayers([{ ...p, x: 18.5 }], 'self'); assert.equal(sources.length, 1);
  sound.trackPlayers([{ ...p, id: 'self' }], 'self'); assert.equal(sound.remoteSteps.size, 0); sound.stop();
});

test('recorded sample requests deduplicate, retry failures after cooldown, and bound decoded memory', async t => {
  const { sound } = audio(); sound.buffers.clear();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; });
  sound.context.decodeAudioData = async () => ({ duration: 1 });
  await Promise.all(Array.from({ length: 10 }, () => sound.loadSample('/audio/sfx/test.wav')));
  assert.equal(requests, 1); assert.equal(sound.loading.size, 0);
  for (let i = 0; i < 100; i++) await sound.loadSample(`/audio/sfx/test-${i}.wav`);
  assert.equal(sound.buffers.size, MAX_SOUND_BUFFERS);
  globalThis.fetch.mock.mockImplementation(() => { throw new Error('Offline'); });
  assert.equal(await sound.loadSample('/audio/sfx/fail.wav'), null);
  assert.equal(sound.loading.size, 0);
  assert.equal(await sound.loadSample('/audio/sfx/fail.wav'), null);
  sound.failed.set('/audio/sfx/fail.wav', 0);
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  assert.ok(await sound.loadSample('/audio/sfx/fail.wav'));
});

test('late decodes never replay effects after a pause, mute, or an old movement event', async t => {
  const { sound, sources } = audio(); sound.buffers.clear();
  let finish;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  sound.context.decodeAudioData = () => new Promise(resolve => { finish = resolve; });
  sound.playRecipe(soundRecipe(GRASS, 'step'), 1, {});
  await new Promise(setImmediate);
  sound.stop(); finish({ duration: 1 });
  await new Promise(setImmediate);
  assert.equal(sources.length, 0);
  sound.playRecipe(soundRecipe(GRASS, 'step'), 1, {}); assert.equal(sources.length, 1); sound.stop();
  sound.buffers.clear(); sound.playRecipe(soundRecipe(GRASS, 'step'), 1, {});
  await new Promise(setImmediate);
  sound.context.currentTime += 1; finish({ duration: 1 });
  await new Promise(setImmediate);
  assert.equal(sources.length, 1);
  sound.setEnabled(false); sound.buffers.clear(); sound.playRecipe(soundRecipe(GRASS, 'step'), 1, {});
  assert.equal(sound.loading.size, 0);
});

test('music failures cannot interrupt gameplay, and master mute preserves independent music preferences', async () => {
  const { sound } = audio();
  let stopped = 0;
  sound.music = { update() { throw new Error('Media unavailable'); }, setEnabled(enabled) { if (!enabled) stopped++; }, stop() { stopped++; }, unlock() {} };
  assert.doesNotThrow(() => sound.updateMusic({ active: true })); assert.equal(stopped, 1);
  sound.musicEnabled = false; sound.setEnabled(false); assert.equal(stopped, 2);
  assert.equal(sound.musicEnabled, false);
  sound.setEnabled(true); await Promise.resolve(); assert.equal(sound.musicEnabled, false);
});
